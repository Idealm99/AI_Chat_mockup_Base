from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.mcp_chat_agent import MCPChatAgent

router = APIRouter()


class MCPChatRequest(BaseModel):
	mcp_servers: List[str] = Field(
		default_factory=list,
		description="Ordered list of MCP server names to enable for this chat run.",
	)
	message: str = Field(..., description="User message to send to the MCP-enabled assistant.")


class MCPChatResponse(BaseModel):
	answer: str
	usage: Dict[str, Any] | None = None
	cost: float | None = None
	tool_calls: List[Dict[str, Any]] = Field(default_factory=list)
	tool_outputs: List[Dict[str, Any]] = Field(default_factory=list)


class OrchestrationStreamRequest(BaseModel):
	model_config = ConfigDict(extra="allow")

	question: str | None = None
	message: str | None = None
	mcp_servers: List[str] | None = Field(default=None, alias="mcp_servers")
	mcpServers: List[str] | None = Field(default=None, alias="mcpServers")
	targetServers: List[str] | None = None
	targetServer: str | None = None
	temperature: float | None = None


@router.post("/mcp/chat", response_model=MCPChatResponse)
async def run_mcp_chat(request: MCPChatRequest) -> MCPChatResponse:
	"""Execute a single-turn MCP-enabled chat round."""

	agent = MCPChatAgent(mcp_servers=request.mcp_servers)
	try:
		result = await agent.run(request.message)
	except ValueError as exc:
		raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
	except RuntimeError as exc:
		raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

	return MCPChatResponse(**result)


def _dedupe(values: List[str] | None) -> List[str]:
	if not values:
		return []
	seen: set[str] = set()
	ordered: List[str] = []
	for value in values:
		if not value or value in seen:
			continue
		seen.add(value)
		ordered.append(value)
	return ordered


@router.post("/orchestration/stream")
async def orchestration_stream(
	payload: OrchestrationStreamRequest,
	request: Request,
) -> StreamingResponse:
	message = (payload.message or payload.question or "").strip()
	if not message:
		raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="question is required")

	server_candidates: List[str] = []
	for value in (
		payload.targetServers,
		payload.mcp_servers,
		payload.mcpServers,
	):
		if value:
			server_candidates.extend(value)
	if payload.targetServer:
		server_candidates.append(payload.targetServer)
	mcp_servers = _dedupe(server_candidates)

	queue: asyncio.Queue[str] = asyncio.Queue()
	SENTINEL = "__STREAM_DONE__"
	client_disconnected = asyncio.Event()

	async def emit(event: str, data: Any) -> None:
		if client_disconnected.is_set():
			return
		payload = {"event": event, "data": data}
		await queue.put(f"data: {json.dumps(payload, ensure_ascii=False)}\n\n")

	async def heartbeat() -> None:
		while not client_disconnected.is_set():
			await asyncio.sleep(10)
			await queue.put(": keep-alive\n\n")

	streamed_tokens = False

	async def forward_event(sse_payload: Dict[str, Any]) -> None:
		nonlocal streamed_tokens
		event_name = sse_payload.get("event") or "message"
		data = sse_payload.get("data")
		if event_name == "token":
			streamed_tokens = True
		await emit(event_name, data)

	async def runner() -> None:
		try:
			agent = MCPChatAgent(mcp_servers=mcp_servers, temperature=payload.temperature or 0.2)
			result = await agent.run(message, event_callback=forward_event)

			answer = result.get("answer", "")
			if answer and not streamed_tokens:
				await emit("token", answer)

			usage = result.get("usage")
			cost = result.get("cost")
			metadata_payload = {"usage": usage, "cost": cost}
			if usage or cost is not None:
				await emit("metadata", metadata_payload)

			await emit(
				"result",
				{
					"answer": answer,
					"usage": usage,
					"cost": cost,
					"tool_outputs": result.get("tool_outputs", []),
				},
			)
		except Exception as exc:  # pragma: no cover - runtime/infra dependent
			await emit("error", str(exc))
		finally:
			await queue.put(SENTINEL)

	async def sse():
		producer = asyncio.create_task(runner())
		pinger = asyncio.create_task(heartbeat())
		try:
			while True:
				if await request.is_disconnected():
					client_disconnected.set()
					break
				chunk = await queue.get()
				if chunk == SENTINEL:
					break
				yield chunk
		finally:
			client_disconnected.set()
			producer.cancel()
			pinger.cancel()

	return StreamingResponse(
		sse(),
		media_type="text/event-stream",
		headers={
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
			"X-Accel-Buffering": "no",
		},
	)
