
from __future__ import annotations

import asyncio
import json
import os
from datetime import date
from typing import Any, Awaitable, Callable, Dict, List, NotRequired, Optional, Tuple, TypedDict

import re

from langgraph.graph import StateGraph, END
from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool

try:
    from langgraph.types import Command
except ImportError:  # pragma: no cover - optional dependency
    Command = None

from app.logger import get_logger
from app.mcp.mcp_adapter_client import MCPAdapterClient, ResolvedMCPTool
from app.tools.web_search import web_search
from app.tools.RAG import vectordb
from app.utils import (
    ROOT_DIR,
    _get_default_model,
    _get_openai_client,
    call_llm_stream,
    States,
    ToolState,
)

try:
    from app.mcp import (
        get_mcp_tool_serving_id,
        get_mcp_tools_schemas,
        resolve_mcp_tool_name,
    )
except Exception:
    get_mcp_tool_serving_id = None
    get_mcp_tools_schemas = None
    resolve_mcp_tool_name = None

log = get_logger(__name__)


class GraphState(TypedDict):
    """State shared across the LangGraph workflow."""

    messages: List[Dict[str, str]]
    original_question: str
    search_iterations: int
    search_results_summary: List[str]
    current_search_query: str | None
    final_answer: str | None
    document_results: List[Dict[str, Any]]
    mcp_tool_inputs: NotRequired[Dict[str, Dict[str, Any]]]
    mcp_tool_results: NotRequired[Dict[str, Any]]
    workflow_trace: NotRequired[List[Dict[str, Any]]]


def _current_search_date() -> str:
    return date.today().isoformat()


def _append_search_date_to_query(query: str, search_date: str) -> str:
    if not query:
        return f"(Search date: {search_date})"
    tag = f"(Search date: {search_date})"
    if tag in query:
        return query
    return f"{query} {tag}"


Emitter = Callable[[str, Any], Awaitable[None]]


class LangGraphSearchAgent:
    """LangGraph-powered conversational search agent with streaming reasoning events."""

    MAX_STAGE_AGENT_STEPS = 4

    NODE_MCP_REQUIREMENTS = {
        "mcp_combined": {
            "preferred_aliases": ["alphafold", "pdb", "alphafold-server", "pdb-server","AlphaFold-MCP-Server","PDB-MCP-Server"],
            "contains_keywords": ["alphafold", "pdb", "structure", "protein"],
        }
    }

    WORKFLOW_DEFINITION: Tuple[Dict[str, Any], ...] = (
        {
            "key": "target_agent",
            "title": "TargetAgent",
            "description": "Select core gene targets associated with the disease.",
            "tool_names": ("OpenTargets-MCP-Server",),
        },
        {
            "key": "omics_agent",
            "title": "OmicsAgent",
            "description": "Validate the mutations and expression patterns of the selected targets using multi-omics data.",
            "tool_names": ("PubChem-MCP-Server", "ChEMBL-MCP-Server"),
        },
        {
            "key": "pathway_agent",
            "title": "PathwayAgent",
            "description": "Map the associated signaling pathways and biological functions.",
            "tool_names": ("KEGG-MCP-Server", "Reactome-MCP-Server", "GeneOntology-MCP-Server"),
        },
        {
            "key": "chem_agent",
            "title": "ChemAgent",
            "description": "Collect compounds acting on the pathway together with their activity data.",
            "tool_names": ("PubChem-MCP-Server", "ChEMBL-MCP-Server"),
        },
        {
            "key": "structure_agent",
            "title": "StructureAgent",
            "description": "Predict binding pockets and affinities from 3D structural information.",
            "tool_names": ("AlphaFold-MCP-Server", "PDB-MCP-Server"),
        },
        {
            "key": "clinical_agent",
            "title": "ClinicalAgent",
            "description": "Review clinical-trial and regulatory datasets.",
            "tool_names": ("ClinicalTrials-MCP-Server", "OpenFDA-MCP-Server"),
        },
    )

    def __init__(
        self,
        *,
        model: Optional[str] = None,
        emitter: Optional[Emitter] = None,
    ) -> None:
        self.model = model or _get_default_model()
        self._client = _get_openai_client()
        self._mcp_adapter = MCPAdapterClient()
        self._workflow_stage_configs = self._compile_workflow_stages()
        self._graph = self._build_graph()
        self._emitter: Optional[Emitter] = emitter
        self._vectordb: Optional[vectordb] = None
        self._node_mcp_bindings = self._initialize_node_mcp_bindings()

    def set_emitter(self, emitter: Optional[Emitter]) -> None:
        self._emitter = emitter

    async def _emit(self, event: str, data: Any) -> None:
        if self._emitter is None:
            return
        try:
            await self._emitter(event, data)
        except Exception:
            log.exception("Failed to emit LangGraph event", extra={"event": event})

    def _build_graph(self):
        graph = StateGraph(GraphState)
        graph.add_node("router", self._router_node)
        previous_node = "router"
        for stage in self._workflow_stage_configs:
            node_name = stage["key"]
            graph.add_node(node_name, self._make_workflow_stage_node(stage))
            graph.add_edge(previous_node, node_name)
            previous_node = node_name

        graph.add_node("final_answer", self._final_answer_node)

        graph.set_entry_point("router")

        graph.add_edge(previous_node, "final_answer")

        graph.add_conditional_edges(
            "final_answer",
            lambda _: END,
        )

        return graph.compile()

    def _compile_workflow_stages(self) -> List[Dict[str, Any]]:
        compiled: List[Dict[str, Any]] = []
        available_servers = set(self._mcp_adapter.available_servers())
        for blueprint in self.WORKFLOW_DEFINITION:
            requested_names: Tuple[str, ...] = blueprint.get("tool_names", tuple())
            missing_names = [name for name in requested_names if name not in available_servers]
            module_tools = [name for name in requested_names if name in available_servers]
            compiled_stage = {
                **blueprint,
                "module_tools": tuple(module_tools),
                "missing_tools": tuple(missing_names),
            }
            if missing_names:
                log.warning(
                    "Stage references unavailable MCP servers",
                    extra={
                        "stage": blueprint.get("title"),
                        "missing_tools": missing_names,
                    },
                )
            compiled.append(compiled_stage)
        return compiled

    def _make_workflow_stage_node(
        self, stage_config: Dict[str, Any]
    ) -> Callable[[GraphState], Awaitable[GraphState]]:
        stage_key = stage_config.get("key", "stage")
        stage_title = stage_config.get("title", stage_key)
        stage_description = stage_config.get("description", "")
        stage_servers: Tuple[str, ...] = stage_config.get("module_tools", tuple())
        missing_servers: Tuple[str, ...] = stage_config.get("missing_tools", tuple())

        async def _node(state: GraphState) -> GraphState:
            query = state.get("current_search_query") or state["original_question"]

            await self._emit(
                "reasoning",
                {
                    "stage": stage_key,
                    "message": f"{stage_title} 단계 실행 중: {stage_description}",
                    "query": query,
                    "tools": list(stage_servers),
                },
            )

            workflow_results = state.setdefault("mcp_tool_results", {})
            stage_results: Dict[str, Any] = {}
            workflow_results[stage_title] = stage_results

            workflow_trace = state.setdefault("workflow_trace", [])
            notes = (
                f"Missing MCP servers: {', '.join(missing_servers)}"
                if missing_servers
                else ""
            )
            trace_entry = {
                "stage": stage_title,
                "goal": stage_description,
                "tools": [],
                "status": "pending",
                "notes": notes,
            }

            if not stage_servers:
                trace_entry["status"] = "skipped"
                trace_entry["notes"] = "Skipping stage because no registered MCP server tools are available."
                workflow_trace.append(trace_entry)
                await self._emit(
                    "reasoning",
                    {
                        "stage": stage_key,
                        "message": f"{stage_title} 단계를 건너뜁니다. 사용 가능한 MCP 툴이 없습니다.",
                    },
                )
                return state

            resolved_tools: List[ResolvedMCPTool] = await self._mcp_adapter.get_stage_tools(stage_servers)
            if not resolved_tools:
                trace_entry["status"] = "skipped"
                trace_entry["notes"] = (
                    trace_entry.get("notes", "")
                    + ("; " if trace_entry.get("notes") else "")
                    + "No LangChain tools were found on the selected MCP servers."
                )
                workflow_trace.append(trace_entry)
                await self._emit(
                    "reasoning",
                    {
                        "stage": stage_key,
                        "message": f"{stage_title} 단계를 건너뜁니다. 변환된 MCP 툴이 없습니다.",
                    },
                )
                return state

            agent_outcome = await self._run_stage_agent(
                stage_key=stage_key,
                stage_title=stage_title,
                stage_description=stage_description,
                query=query,
                resolved_tools=resolved_tools,
            )

            stage_results.update(agent_outcome["results"])
            trace_entry["tools"].extend(agent_outcome["used_tools"])
            trace_entry["status"] = agent_outcome["status"]
            trace_entry["notes"] = agent_outcome["notes"]
            workflow_trace.append(trace_entry)

            await self._emit(
                "reasoning",
                {
                    "stage": stage_key,
                    "message": agent_outcome["emit_message"],
                    "results": list(stage_results.keys()),
                },
            )

            return state

        return _node

    async def _run_stage_agent(
        self,
        *,
        stage_key: str,
        stage_title: str,
        stage_description: str,
        query: str,
        resolved_tools: List[ResolvedMCPTool],
    ) -> Dict[str, Any]:
        tool_map: Dict[str, ResolvedMCPTool] = {
            resolved.tool.name: resolved for resolved in resolved_tools
        }
        scratchpad: List[Dict[str, Any]] = []
        stage_results: Dict[str, Any] = {}
        used_tools: List[str] = []
        summary = ""

        for step in range(self.MAX_STAGE_AGENT_STEPS):
            agent_instruction = self._build_stage_agent_prompt(
                stage_title=stage_title,
                stage_description=stage_description,
                query=query,
                resolved_tools=resolved_tools,
                scratchpad=scratchpad,
            )

            response_text = await self._simple_llm_call(
                system_prompt=(
                    f"You are the specialist agent for the {stage_title} stage. "
                    "Respond only with JSON that describes your next action."
                ),
                user_prompt=agent_instruction,
            )

            try:
                decision = json.loads(response_text)
            except json.JSONDecodeError:
                decision = {"action": "finish", "summary": response_text.strip()}

            action = (decision.get("action") or "").lower()
            if action == "call_tool":
                tool_name = decision.get("tool_name") or ""
                if tool_name not in tool_map:
                    scratchpad.append(
                        {
                            "type": "error",
                            "message": f"Requested tool {tool_name} was not found.",
                        }
                    )
                    continue
                arguments = decision.get("arguments") or {}
                resolved = tool_map[tool_name]
                tool_label = resolved.label
                try:
                    result = await resolved.tool.ainvoke(arguments)
                except Exception as exc:  # pragma: no cover - external service call
                    log.exception(
                        "MCP tool execution failed",
                        extra={
                            "stage": stage_title,
                            "tool": tool_label,
                            "exception": exc,
                        },
                    )
                    result = {"error": str(exc)}
                else:
                    result = self._serialize_tool_output(result)

                formatted_result = self._format_tool_result(result, max_chars=400)
                scratchpad.append(
                    {
                        "type": "tool",
                        "tool": tool_label,
                        "input": arguments,
                        "output": formatted_result,
                    }
                )
                used_tools.append(tool_label)
                existing_value = stage_results.get(tool_label)
                if existing_value is None:
                    stage_results[tool_label] = [result]
                elif isinstance(existing_value, list):
                    existing_value.append(result)
                else:
                    stage_results[tool_label] = [existing_value, result]
                await self._emit(
                    "reasoning",
                    {
                        "stage": "mcp_tool",
                        "node": stage_key,
                        "tool": tool_label,
                        "message": f"{stage_title} 단계에서 {tool_label} 실행 중",
                    },
                )
                continue

            summary = decision.get("summary", "").strip()
            break

        status = "completed" if stage_results else "skipped"
        notes_lines: List[str] = []
        if scratchpad:
            for entry in scratchpad:
                if entry.get("type") == "tool":
                    notes_lines.append(
                        f"{entry['tool']} input: {entry['input']}\noutput: {entry['output']}"
                    )
                elif entry.get("type") == "error":
                    notes_lines.append(entry.get("message", ""))
        if summary:
            notes_lines.append(f"Summary: {summary}")
        notes = "\n".join(filter(None, notes_lines)) or "Tool results are empty."

        emit_message = (
            f"{stage_title} 단계 완료 ({len(stage_results)}개 툴 실행)"
            if stage_results
            else f"{stage_title} 단계를 건너뜁니다. 실행된 툴이 없습니다."
        )

        return {
            "results": stage_results,
            "used_tools": used_tools,
            "status": status,
            "notes": notes,
            "emit_message": emit_message,
        }

    def _build_stage_agent_prompt(
        self,
        *,
        stage_title: str,
        stage_description: str,
        query: str,
        resolved_tools: List[ResolvedMCPTool],
        scratchpad: List[Dict[str, Any]],
    ) -> str:
        tool_sections = []
        for resolved in resolved_tools:
            schema = getattr(resolved.tool, "args", None)
            if not schema and hasattr(resolved.tool, "args_schema"):
                schema_model = getattr(resolved.tool, "args_schema")
                if hasattr(schema_model, "schema"):
                    schema = schema_model.schema()
            schema_text = (
                json.dumps(schema, ensure_ascii=False, indent=2)
                if schema
                else "Input schema is unavailable"
            )
            tool_sections.append(
                "\n".join(
                    [
                        f"- Tool name: {resolved.tool.name}",
                        f"  Server: {resolved.server_name}",
                        f"  Description: {getattr(resolved.tool, 'description', '')}",
                        f"  Schema: {schema_text}",
                    ]
                )
            )

        history_lines = []
        for entry in scratchpad:
            if entry.get("type") == "tool":
                history_lines.append(
                    f"[Tool Run] {entry['tool']} input={entry['input']} output={entry['output']}"
                )
            elif entry.get("type") == "error":
                history_lines.append(f"[Error] {entry.get('message')}")
        history_text = "\n".join(history_lines) if history_lines else "None"

        return (
            f"Stage: {stage_title}\nGoal: {stage_description}\n"
            f"User question: {query}\n"
            f"Available MCP tools:\n{''.join(tool_sections)}\n\n"
            "Action guidelines:\n"
            "1. If needed, call one tool at a time using a JSON command.\n"
            "2. Review each tool output before deciding on additional calls.\n"
            "3. When done, reply with action=\"finish\" and a summary.\n"
            "Output examples:\n"
            '{"action": "call_tool", "tool_name": "tool", "arguments": {"query": "..."}}\n'
            '{"action": "finish", "summary": "..."}\n'
            f"Progress so far:\n{history_text}"
        )

    # Legacy MCP tool-node helpers (removed)

    async def _router_node(self, state: GraphState) -> GraphState:
        # New structure: route every request through the MCP combined workflow
        await self._emit(
            "reasoning",
            {
                "stage": "router",
                "message": "질문을 바이오/신약개발 MCP 워크플로우 단계로 라우팅합니다.",
                "pipeline": [stage["title"] for stage in self._workflow_stage_configs],
            },
        )
        return state

    # Legacy routing logic (removed)

    # Legacy search/document nodes (removed)

    async def _direct_answer_node(self, state: GraphState) -> GraphState:
        last_messages = state["messages"]

        prompt_messages = [
            {"role": "system", "content": self._system_prompt()},
            *last_messages,
        ]

        await self._emit(
            "reasoning",
            {
                "stage": "final",
                "message": "추가 검색 없이 직접 답변을 생성합니다.",
            },
        )

        final_message = await self._stream_answer(prompt_messages)
        state["messages"].append(final_message)
        state["final_answer"] = final_message.get("content", "")
        return state

    async def _final_answer_node(self, state: GraphState) -> GraphState:
        workflow_results: Dict[str, Dict[str, Any]] = state.get("mcp_tool_results", {})

        if not any(workflow_results.values()):
            await self._emit(
                "reasoning",
                {
                    "stage": "final",
                    "message": "MCP 툴 결과가 없어 일반 답변으로 전환합니다.",
                },
            )
            return await self._direct_answer_node(state)

        overview_lines: List[str] = []
        context_blocks: List[str] = []
        for stage in self._workflow_stage_configs:
            title = stage["title"]
            description = stage.get("description", "")
            stage_payload = workflow_results.get(title)
            if not stage_payload:
                continue

            tool_names = ", ".join(stage_payload.keys()) or "툴 없음"
            overview_lines.append(f"- {title}: {description} (툴: {tool_names})")

            stage_lines = [f"[{title}] {description}"]
            for tool_name, result in stage_payload.items():
                formatted = self._format_tool_result(result)
                stage_lines.append(f"{tool_name} 결과:\n{formatted}")
            context_blocks.append("\n".join(stage_lines))

        if not context_blocks:
            await self._emit(
                "reasoning",
                {
                    "stage": "final",
                    "message": "워크플로우 결과가 비어 있어 일반 답변으로 전환합니다.",
                },
            )
            return await self._direct_answer_node(state)

        workflow_overview = "\n".join(overview_lines)
        context = "\n\n".join(context_blocks)
        user_question = state["original_question"]

        trace_notes = state.get("workflow_trace", [])
        trace_summary = "\n".join(
            f"{item.get('stage')}: {item.get('notes', '').strip()}"
            for item in trace_notes
            if item.get("notes")
        )

        messages = [
            {
                "role": "system",
                "content": (
                    "당신은 바이오/신약 개발 전문 어시스턴트입니다. "
                    "아래 단계별 MCP 데이터를 기반으로 일관된 연구 보고서를 작성하세요. "
                    "각 단계(타겟 발굴 → 오믹스 분석 → 경로 분석 → 화합물 탐색 → 구조 분석 → 임상 정보)를 모두 언급하고 "
                    "사용된 MCP 데이터의 한계나 후속 조치도 제안하세요."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"질문: {user_question}\n\n"
                    f"워크플로우 개요:\n{workflow_overview}\n\n"
                    + (f"단계별 주요 메모:\n{trace_summary}\n\n" if trace_summary else "")
                    + f"세부 데이터:\n{context}"
                ),
            },
        ]

        await self._emit(
            "reasoning",
            {
                "stage": "final",
                "message": "바이오 워크플로우 결과를 바탕으로 최종 답변을 생성합니다.",
            },
        )

        final_message = await self._stream_answer(messages)
        state["messages"].append(final_message)
        state["final_answer"] = final_message.get("content", "")
        return state

    @staticmethod
    def _format_tool_result(result: Any, *, max_chars: int = 1200) -> str:
        if isinstance(result, (dict, list)):
            text = json.dumps(result, ensure_ascii=False, indent=2)
        else:
            text = str(result)
        text = text.strip()
        if not text:
            return "Result is empty."
        if len(text) > max_chars:
            return text[:max_chars] + "... (truncated)"
        return text

    def _build_default_tool_args(self, tool: BaseTool, query: str) -> Dict[str, Any]:
        field_candidates = self._extract_tool_fields(tool)
        preferred = ("query", "text", "prompt", "input", "question")
        for field in preferred:
            if field in field_candidates:
                return {field: query}
        if field_candidates:
            return {field_candidates[0]: query}
        return {"query": query}

    @staticmethod
    def _extract_tool_fields(tool: BaseTool) -> List[str]:
        schema = getattr(tool, "args", None)
        if isinstance(schema, dict):
            if "properties" in schema:
                return list(schema["properties"].keys())
            return list(schema.keys())
        args_schema = getattr(tool, "args_schema", None)
        if hasattr(args_schema, "__fields__"):
            return list(args_schema.__fields__.keys())
        return []

    @staticmethod
    def _serialize_tool_output(result: Any) -> Any:
        if isinstance(result, ToolMessage):
            return {
                "type": "tool_message",
                "name": result.name,
                "status": result.status,
                "content": result.content,
                "artifact": getattr(result, "artifact", None),
                "tool_call_id": result.tool_call_id,
            }
        if Command is not None and isinstance(result, Command):
            return {
                "type": "command",
                "graph": result.graph,
                "update": result.update,
                "resume": result.resume,
                "goto": result.goto,
            }
        return result

    async def _stream_answer(
        self,
        messages: List[Dict[str, str]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        final_message: Optional[Dict[str, Any]] = None
        async for chunk in call_llm_stream(
            messages=messages,
            model=self.model,
            temperature=0.2,
            tools=tools,
        ):
            if isinstance(chunk, dict) and chunk.get("event") == "token":
                await self._emit("token", chunk.get("data", ""))
            else:
                final_message = chunk
        if final_message is None:
            final_message = {"role": "assistant", "content": ""}
        return final_message

    async def _simple_llm_call(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0,
    ) -> str:
        client = self._client
        response = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
        )
        return response.choices[0].message.content or ""

    def _initialize_node_mcp_bindings(self) -> Dict[str, Dict[str, Any]]:
        if resolve_mcp_tool_name is None:
            return {}
        bindings: Dict[str, Dict[str, Any]] = {}
        for node_name, config in self.NODE_MCP_REQUIREMENTS.items():
            tool_name = resolve_mcp_tool_name(
                preferred_aliases=config.get("preferred_aliases"),
                contains_keywords=config.get("contains_keywords"),
            )
            if not tool_name:
                continue
            serving_id = (
                get_mcp_tool_serving_id(tool_name)
                if get_mcp_tool_serving_id is not None
                else None
            )
            bindings[node_name] = {
                "tool_name": tool_name,
                "serving_id": serving_id,
            }
            log.info(
                "LangGraph node MCP binding configured",
                extra={
                    "node": node_name,
                    "tool": tool_name,
                    "serving_id": serving_id,
                },
            )
        return bindings

    def _get_node_tool_schemas(self, node_name: str) -> Optional[List[Dict[str, Any]]]:
        if not self._node_mcp_bindings or get_mcp_tools_schemas is None:
            return None
        binding = self._node_mcp_bindings.get(node_name)
        if not binding:
            return None
        return get_mcp_tools_schemas([binding["tool_name"]])

    async def run(
        self,
        *,
        question: str,
        history: List[Dict[str, str]] | None = None,
    ) -> GraphState:
        initial_state: GraphState = {
            "messages": [
                *(history or []),
                {"role": "user", "content": question},
            ],
            "original_question": question,
            "search_iterations": 0,
            "search_results_summary": [],
            "current_search_query": None,
            "final_answer": None,
            "document_results": [],
            "mcp_tool_results": {},
            "workflow_trace": [],
        }

        result_state: GraphState = await self._graph.ainvoke(initial_state)
        return result_state

    def _system_prompt(self) -> str:
        try:
            return (
                ROOT_DIR
                / "prompts"
                / "system.txt"
            ).read_text(encoding="utf-8")
        except Exception:
            return "You are a helpful AI assistant."

    async def _document_search(self, query: str) -> List[Dict[str, Any]]:
        db = await self._get_vectordb()
        if db is None:
            return []
        return await asyncio.to_thread(db.hybrid_search, query)

    async def _get_vectordb(self) -> Optional[vectordb]:
        if self._vectordb is not None:
            return self._vectordb

        idx = os.getenv("WEAVIATE_INDEX")
        host = os.getenv("WEAVIATE_HOST", "localhost")
        http_port = int(os.getenv("WEAVIATE_HTTP_PORT", "8080"))
        grpc_port = int(os.getenv("WEAVIATE_GRPC_PORT", "50051"))
        serving_id = int(os.getenv("EMBEDDING_SERVING_ID", "10"))
        token = os.getenv("EMBEDDING_BEARER_TOKEN", "")
        base_url = os.getenv("EMBEDDING_BASE_URL", "https://genos.genon.ai:3443")

        if not idx or not token:
            log.warning(
                "Vectordb environment variables are missing; document search will be disabled.",
                extra={"idx": idx, "has_token": bool(token)},
            )
            return None

        try:
            self._vectordb = vectordb(
                genos_ip=host,
                http_port=http_port,
                grpc_port=grpc_port,
                idx=idx,
                embedding_serving_id=serving_id,
                embedding_bearer_token=token,
                embedding_genos_url=base_url,
            )
        except Exception:
            log.exception("Failed to initialize vectordb")
            self._vectordb = None

        return self._vectordb
