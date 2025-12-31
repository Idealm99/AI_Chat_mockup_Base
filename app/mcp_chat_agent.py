from __future__ import annotations

import json
import inspect
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union, Tuple

from langchain_core.messages import (
	AIMessage,
	BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
)
from app.utils import (
    ROOT_DIR,
    _get_default_model,
    _get_openai_client,
    call_llm_stream,
    States,
    ToolState,
)

from app.logger import get_logger
from app.tools import get_tool_map, get_tools_for_llm
from app.utils import ROOT_DIR, States, ToolState, call_llm_stream, is_sse

log = get_logger(__name__)


def _load_system_prompt() -> str:
	prompt_path = ROOT_DIR / "prompts" / "system.txt"
	if prompt_path.exists():
		template = prompt_path.read_text(encoding="utf-8")
		return template
	return "You are a helpful research assistant who can call MCP tools when needed."


SYSTEM_PROMPT_TEMPLATE = _load_system_prompt()


def _format_system_prompt() -> str:
	return SYSTEM_PROMPT_TEMPLATE.format(
		current_date=datetime.now().strftime("%Y-%m-%d"),
		locale="ko-KR",
	)


def _dict_to_message(payload: Dict[str, Any]) -> BaseMessage:
	role = payload.get("role", "assistant")
	content = payload.get("content", "")
	raw_tool_calls = payload.get("tool_calls") or []
	
	# OpenAI 형식을 LangChain ToolCall 형식으로 변환
	formatted_tool_calls = []
	for tc in raw_tool_calls:
		# OpenAI의 'function' 키 내부 데이터 추출
		func_data = tc.get("function", {})
		
		# 'arguments'는 JSON 문자열이므로 딕셔너리로 파싱
		try:
			tool_args = json.loads(func_data.get("arguments", "{}"))
		except json.JSONDecodeError:
			tool_args = {}
		
		formatted_tool_calls.append({
			"id": tc.get("id"),
			"name": func_data.get("name"),  # 'function' 내부의 name을 최상위로
			"args": tool_args               # 파싱된 딕셔너리를 'args' 키로
		})
	
	if role == "assistant":
		return AIMessage(content=content, tool_calls=formatted_tool_calls if formatted_tool_calls else [])
	if role == "user":
		return HumanMessage(content=content)
	if role == "system":
		return SystemMessage(content=content)
	if role == "tool":
		return ToolMessage(content=content, tool_call_id=payload.get("tool_call_id"))
	return BaseMessage(content=content, type=role)


def _stringify(value: Any) -> str:
	if isinstance(value, str):
		return value
	try:
		return json.dumps(value, ensure_ascii=False)
	except Exception:
		return str(value)


def _chunk_text_for_streaming(text: str, *, chunk_size: int = 256) -> List[str]:
	"""Split text into reasonably sized chunks for SSE fallback streaming."""
	if chunk_size <= 0:
		chunk_size = 256
	if not text:
		return []

	chunks: List[str] = []
	start = 0
	text_length = len(text)
	while start < text_length:
		end = min(start + chunk_size, text_length)
		chunks.append(text[start:end])
		start = end
	return chunks


def _sanitize_tool_schema(tool_schema: Dict[str, Any]) -> Dict[str, Any]:
	"""
	OpenAI 함수 호출 스키마 요구사항에 맞게 도구 스키마를 정제합니다.
	- 최상위 레벨에서 type이 'object'여야 함
	- oneOf/anyOf/allOf/enum/not을 최상위에서 제거
	- properties 내부의 복잡한 스키마도 단순화
	"""
	if not isinstance(tool_schema, dict):
		return {"type": "function", "function": {"name": "unknown", "description": "", "parameters": {"type": "object", "properties": {}}}}
	
	function_block = tool_schema.get("function", {})
	if not isinstance(function_block, dict):
		return tool_schema
	
	parameters = function_block.get("parameters", {})
	if not isinstance(parameters, dict):
		parameters = {"type": "object", "properties": {}}
	
	# 재귀적으로 properties 내부도 정제
	def _clean_schema(schema: Any) -> Any:
		if not isinstance(schema, dict):
			return schema
		
		cleaned = {}
		forbidden_keys = ["oneOf", "anyOf", "allOf", "not"]
		
		for key, value in schema.items():
			if key in forbidden_keys:
				# oneOf/anyOf가 있으면 첫 번째 옵션을 사용하거나 제거
				if key in ["oneOf", "anyOf"] and isinstance(value, list) and value:
					# 첫 번째 스키마 옵션을 병합
					first_option = value[0] if isinstance(value[0], dict) else {}
					for opt_key, opt_val in first_option.items():
						if opt_key not in cleaned:
							cleaned[opt_key] = _clean_schema(opt_val)
				continue
			
			if key == "properties" and isinstance(value, dict):
				# properties 내부의 각 필드도 재귀적으로 정제
				cleaned[key] = {k: _clean_schema(v) for k, v in value.items()}
			elif key == "items" and isinstance(value, dict):
				# 배열 items도 정제
				cleaned[key] = _clean_schema(value)
			elif isinstance(value, dict):
				cleaned[key] = _clean_schema(value)
			else:
				cleaned[key] = value
		
		return cleaned
	
	sanitized_params = _clean_schema(parameters)
	
	# type이 없거나 object가 아니면 강제로 object로 설정
	if sanitized_params.get("type") != "object":
		sanitized_params["type"] = "object"
	
	# properties가 없으면 빈 객체로 설정
	if "properties" not in sanitized_params:
		sanitized_params["properties"] = {}
	
	# 정제된 parameters를 다시 할당
	sanitized_function = {**function_block, "parameters": sanitized_params}
	return {**tool_schema, "function": sanitized_function}


EventCallback = Callable[[Dict[str, Any]], Awaitable[None]]


async def _stream_text_via_callback(
	text: str,
	*,
	event_callback: Optional[EventCallback],
	chunk_size: int = 256,
) -> None:
	"""Emit text chunks via SSE token events when direct streaming isn't available."""
	if not event_callback or not text:
		return

	for chunk in _chunk_text_for_streaming(text, chunk_size=chunk_size):
		if not chunk:
			continue
		await event_callback({"event": "token", "data": chunk})


class MCPChatAgent:
	"""Lightweight agent that runs an LLM with optional MCP tool support."""

	MAX_TOOL_LOOPS = 5

	def __init__(self, mcp_servers: List[str] | None = None, temperature: float = 0.2) -> None:
		self._mcp_servers = [server for server in (mcp_servers or []) if server]
		self._temperature = temperature

	async def run(
		self,
		message: str,
		*,
		event_callback: Optional[EventCallback] = None,
	) -> Dict[str, Any]:
		user_message = (message or "").strip()
		if not user_message:
			raise ValueError("message must not be empty")

		states = States()
		states.tool_state = ToolState()
		states.messages = [
			SystemMessage(content=_format_system_prompt()),
			HumanMessage(content=user_message),
		]

		states.tools = await get_tools_for_llm(target_servers=self._mcp_servers or None)
		
		# OpenAI 호환 스키마로 정제
		sanitized_tools = [_sanitize_tool_schema(tool) for tool in (states.tools or [])]
		states.tools = sanitized_tools
		
		# 도구 정보 로깅
		log.info(
			"MCP Chat Agent started",
			extra={
				"mcp_servers": self._mcp_servers,
				"tools_count": len(states.tools) if states.tools else 0,
				"tool_names": [t.get("function", {}).get("name") for t in (states.tools or [])[:10]],
			}
		)
		
		
		allowed_tool_names = {
			tool.get("function", {}).get("name")
			for tool in (states.tools or [])
			if isinstance(tool, dict) and tool.get("function", {}).get("name")
		}

		tool_map = await get_tool_map()
		if allowed_tool_names:
			tool_map = {name: fn for name, fn in tool_map.items() if name in allowed_tool_names}

		usage_summary: Dict[str, Any] | None = None
		cost_summary: float | None = None
		tool_invocations: List[Dict[str, Any]] = []
		tool_outputs: List[Dict[str, Any]] = []
		original_user_question = user_message
		
		for turn in range(self.MAX_TOOL_LOOPS):
			final_payload = await self._invoke_llm(states, event_callback=event_callback)
			
			if final_payload is None:
				raise RuntimeError("LLM returned no response")

			usage_summary = final_payload.get("usage") or usage_summary
			cost_summary = final_payload.get("cost") if "cost" in final_payload else cost_summary

			message_obj = _dict_to_message(final_payload)
			states.messages.append(message_obj)

			tool_calls = final_payload.get("tool_calls") or []

			if tool_calls:
				await self._handle_tool_calls(
					tool_calls=tool_calls,
					tool_map=tool_map,
					states=states,
					tool_invocations=tool_invocations,
					tool_outputs=tool_outputs,
					event_callback=event_callback,
				)
				
				# 툴 실행 후, 사용자 질문과 툴 결과를 정리하여 답변 생성 요청
				tool_results_text = []
				for output in tool_outputs[-len(tool_calls):]:  # 방금 실행한 툴 결과만
					tool_name = output.get("name", "unknown")
					if "output" in output:
						result_str = str(output["output"]) # 500자까지
						tool_results_text.append(f"Tool '{tool_name}' returned:\n{result_str}")
					elif "error" in output:
						tool_results_text.append(f"Tool '{tool_name}' error: {output['error']}")
				
				# 사용자 질문 + 툴 결과 + 답변 요청 프롬프트를 System Prompt로 사용
				system_prompt = """당신은 전문적인 제약 정보 및 약학 데이터 분석 어시스턴트입니다. 
당신의 임무는 MCP 도구로부터 전달받은 '모든' 데이터를 단 하나도 누락하지 않고 객관적으로 구조화하여 전달하는 것입니다.

### 1. 응답 원칙 (Strict Rules)
- **전수 반영**: 도구 결과(Tool Results)에 포함된 모든 항목(필드)과 값을 하나도 빠짐없이 결과에 포함하십시오. 중요하지 않다고 판단하여 스스로 생략하지 마십시오.
- **객관성 유지**: 주관적 의견, 추측, 해석을 절대 배제하십시오. 오직 도구 결과에 명시된 사실(Fact)만 기술하십시오.
- **데이터 무결성**: 수치, 단위, 성분명은 도구의 결과값을 오타 없이 그대로 인용하십시오.

### 2. 응답 구조 (Response Structure)
1. **[조회 결과 상세 Table]**
   - 도구에서 반환된 모든 데이터 항목을 표(Table) 형식으로 구성하십시오. 사용자가 보기 쉽게 구성하세요 
   - 결과가 여러 개라면 각각 별도의 행이나 표로 작성하여 모든 정보를 표시하십시오.

### 3. 언어 및 톤
- 반드시 한국어로 답변하되, 불필요한 미사여구나 서술을 지양하고 건조한 전문용어를 사용하십시오."""
				
				user_prompt = f"""사용자의 질문: {original_user_question}

[MCP 도구 실행 결과 데이터]
{'=' * 60}
{chr(10).join(tool_results_text)}
{'=' * 60}

지침:
1. 위 도구 결과 데이터에 포함된 모든 정보를 누락 없이 한국어로 정리하십시오.
2. 데이터를 요약하거나 중요도를 판단하여 생략하지 말고, 제공된 모든 필드 값을 표와 리스트에 매핑하십시오.
3. 데이터에 기반하지 않은 당신의 분석이나 의견은 절대 포함하지 마십시오."""
				
				# 간단한 LLM 호출로 답변 생성 (스트리밍)
				answer = await self._simple_llm_call(
					system_prompt=system_prompt,
					user_prompt=user_prompt,
					temperature=0.3,
					event_callback=event_callback,
				)
				
				return {
					"answer": answer,
					"usage": usage_summary,
					"cost": cost_summary,
					"tool_calls": tool_invocations,
					"tool_outputs": tool_outputs,
				}

			# tool_calls가 없으면 직접 답변
			answer = getattr(message_obj, "content", "")
			if isinstance(answer, list):
				answer = "\n".join(str(part) for part in answer)
			
			return {
				"answer": answer,
				"usage": usage_summary,
				"cost": cost_summary,
				"tool_calls": tool_invocations,
				"tool_outputs": tool_outputs,
			}

		raise RuntimeError("Exceeded maximum tool loops without reaching a final answer")
	
	async def _simple_llm_call(
		self,
		system_prompt: str,
		user_prompt: str,
		temperature: float = 0.3,
		event_callback: Optional[EventCallback] = None,
	) -> str:
		"""Simple LLM call without tools for generating final answers with streaming support."""
		from langchain_core.messages import SystemMessage, HumanMessage
		
		messages = [
			SystemMessage(content=system_prompt),
			HumanMessage(content=user_prompt),
		]
		
		final_message: Dict[str, Any] | None = None
		streamed_tokens = False
		async for chunk in call_llm_stream(
			messages=messages,
			tools=None,  # No tools for this call
			temperature=temperature,
		):
			# SSE 이벤트를 클라이언트로 스트리밍
			if is_sse(chunk):
				if chunk.get("event") == "token" and chunk.get("data"):
					streamed_tokens = True
				if event_callback:
					await event_callback(chunk)
				continue
			
			# 최종 메시지 저장
			final_message = chunk
		
		if final_message is None:
			return "Failed to generate answer."

		final_content = final_message.get("content", "")
		if isinstance(final_content, list):
			answer_text = "".join(str(part) for part in final_content)
		else:
			answer_text = str(final_content) if final_content is not None else ""

		if not streamed_tokens:
			await _stream_text_via_callback(answer_text, event_callback=event_callback)

		return answer_text
	
	async def _invoke_llm(
		self,
		states: States,
		*,
		event_callback: Optional[EventCallback] = None,
	) -> Dict[str, Any] | None:
		final_message: Dict[str, Any] | None = None
		streamed_tokens = False
		async for chunk in call_llm_stream(
			messages=states.messages,
			tools=states.tools,
			temperature=self._temperature,
		):
			if is_sse(chunk):
				if chunk.get("event") == "token" and chunk.get("data"):
					streamed_tokens = True
				if event_callback:
					await event_callback(chunk)
				continue
			final_message = chunk
		
		# 디버깅: LLM 응답 로깅
		if final_message:
			if not streamed_tokens:
				final_content = final_message.get("content")
				if isinstance(final_content, list):
					text_to_stream = "".join(str(part) for part in final_content)
				else:
					text_to_stream = str(final_content) if final_content is not None else ""
				if text_to_stream:
					await _stream_text_via_callback(
						text_to_stream,
						event_callback=event_callback,
					)
			log.info(
				"LLM response received",
				extra={
					"has_tool_calls": "tool_calls" in final_message,
					"tool_calls_count": len(final_message.get("tool_calls", [])),
					"tool_calls": final_message.get("tool_calls"),
					"content_preview": str(final_message.get("content", ""))[:200],
				}
			)
		
		return final_message

	async def _handle_tool_calls(
		self,
		*,
		tool_calls: List[Dict[str, Any]],
		tool_map: Dict[str, Any],
		states: States,
		tool_invocations: List[Dict[str, Any]],
		tool_outputs: List[Dict[str, Any]],
		event_callback: Optional[EventCallback] = None,
	) -> None:
		if not tool_calls:
			return
		
		log.info(
			"Handling tool calls",
			extra={
				"tool_calls_count": len(tool_calls),
				"tool_names": [tc.get("function", {}).get("name") for tc in tool_calls],
			}
		)

		for tool_call in tool_calls:
			function_block = tool_call.get("function") or {}
			tool_name = function_block.get("name")
			raw_arguments = function_block.get("arguments")
			tool_call_id = tool_call.get("id", "")
			if not tool_call_id:
				tool_call_id = f"tool-{len(tool_invocations) + 1}-{datetime.now(timezone.utc).timestamp()}"

			try:
				parsed_arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) and raw_arguments else {}
			except json.JSONDecodeError:
				parsed_arguments = {}
			
			# OpenAI 예약 키워드 필터링 (LLM이 실수로 포함할 수 있음)
			reserved_keys = {"function", "type", "id", "name"}
			filtered_arguments = {k: v for k, v in parsed_arguments.items() if k not in reserved_keys}
			
			# 원본 arguments 로깅 (디버깅용)
			if len(filtered_arguments) != len(parsed_arguments):
				removed_keys = set(parsed_arguments.keys()) - set(filtered_arguments.keys())
				log.warning(
					"Removed reserved keys from tool arguments",
					extra={
						"tool": tool_name,
						"removed_keys": list(removed_keys),
						"original_args": list(parsed_arguments.keys()),
					}
				)

			tool_invocations.append(
				{
					"name": tool_name,
					"arguments": parsed_arguments,
					"tool_call_id": tool_call_id,
				}
			)
			timestamp = datetime.now(timezone.utc).isoformat()
			
			log.info(
				"Tool invocation prepared",
				extra={
					"tool_name": tool_name,
					"tool_call_id": tool_call_id,
					"filtered_args_keys": list(filtered_arguments.keys()),
				}
			)
			
			if event_callback:
				await event_callback(
					{
						"event": "tool",
						"data": {
							"id": tool_call_id,
							"name": tool_name,
							"arguments": parsed_arguments,
							"status": "started",
							"timestamp": timestamp,
						},
					}
				)

			if not tool_name:
				error_message = "Tool call missing name."
				tool_outputs.append({"name": None, "error": error_message})
				states.messages.append(ToolMessage(content=error_message, tool_call_id=tool_call_id))
				if event_callback:
					await event_callback(
						{
							"event": "tool",
							"data": {
								"id": tool_call_id,
								"name": None,
								"arguments": parsed_arguments,
								"status": "error",
								"error": error_message,
								"timestamp": datetime.now(timezone.utc).isoformat(),
							},
						}
					)
				continue

			tool_fn = tool_map.get(tool_name)
			if not tool_fn:
				error_message = f"Requested tool '{tool_name}' is not available."
				log.warning(
					"Tool not found in tool_map",
					extra={
						"tool_name": tool_name,
						"available_tools": list(tool_map.keys())[:10],
					}
				)
				tool_outputs.append({"name": tool_name, "error": error_message})
				states.messages.append(ToolMessage(content=error_message, tool_call_id=tool_call_id))
				if event_callback:
					await event_callback(
						{
							"event": "tool",
							"data": {
								"id": tool_call_id,
								"name": tool_name,
								"arguments": parsed_arguments,
								"status": "error",
								"error": error_message,
								"timestamp": datetime.now(timezone.utc).isoformat(),
							},
						}
					)
				continue

			tool_error = False
			try:
				log.info(
					"Executing tool",
					extra={
						"tool_name": tool_name,
						"is_coroutine": inspect.iscoroutinefunction(tool_fn),
					}
				)
				# 도구 함수 시그니처 확인
				if inspect.iscoroutinefunction(tool_fn):
					result = await tool_fn(states, **filtered_arguments)
				else:
					result = tool_fn(states, **filtered_arguments)
					if inspect.isawaitable(result):
						result = await result
				
				log.info(
					"Tool execution completed",
					extra={
						"tool_name": tool_name,
						"result_type": type(result).__name__,
						"result_preview": str(result)[:200] if result else None,
					}
				)
			except TypeError as exc:
				# 파라미터 불일치 에러를 더 자세히 로깅
				log.exception(
					"Tool call parameter mismatch",
					extra={
						"tool": tool_name,
						"filtered_arguments": filtered_arguments,
						"original_parsed_arguments": parsed_arguments,
						"error": str(exc),
					}
				)
				result = f"Tool {tool_name} parameter error: {exc}"
				tool_error = True
			except Exception as exc:  # pragma: no cover - tool execution may depend on infra
				log.exception("Tool call failed", extra={"tool": tool_name})
				result = f"Tool {tool_name} failed: {exc}"
				tool_error = True

			tool_outputs.append({"name": tool_name, "output": result})
			states.messages.append(
				ToolMessage(
					content=_stringify(result),
					tool_call_id=tool_call_id,
				)
			)
			if event_callback:
				status = "error" if tool_error else "completed"
				await event_callback(
					{
						"event": "tool",
						"data": {
							"id": tool_call_id,
							"name": tool_name,
							"arguments": parsed_arguments,
							"status": status,
							"output": result,
							"timestamp": datetime.now(timezone.utc).isoformat(),
						},
					}
				)
