
from __future__ import annotations

import asyncio
import json
import os
from datetime import date, datetime
from typing import Any, Awaitable, Callable, Dict, List, NotRequired, Optional, Tuple, TypedDict, Union

import re

from langgraph.graph import StateGraph, END
from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool


try:
    from langgraph.types import Command
except ImportError:  # pragma: no cover - optional dependency
    Command = None
from rapidfuzz import fuzz
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
    history: List[Dict[str, str]]
    next: str
    step_count: int
    rationale: str
    _classify_is_mcp: NotRequired[bool]
    _classify_llm_result: NotRequired[str]
    _classify_keyword_match: NotRequired[bool]
    _stage_visit_counts: NotRequired[Dict[str, int]]


def _current_search_date() -> str:
    return date.today().isoformat()


def _append_search_date_to_query(query: str, search_date: str) -> str:
    if not query:
        return f"(Search date: {search_date})"
    tag = f"(Search date: {search_date})"
    if tag in query:
        return query
    return f"{query} {tag}"


def _make_history_entry(role: str, content: str) -> Dict[str, str]:
    return {"role": role, "content": content or ""}



Emitter = Callable[[str, Any], Awaitable[None]]


class LangGraphSearchAgent:

    """LangGraph-powered conversational search agent with streaming reasoning events."""

    MAX_STAGE_AGENT_STEPS = 4
    MAX_WORKFLOW_ITERATIONS = 8
    MAX_STAGE_AGENT_TOOLS = 3
    FALLBACK_TOOL_LIMIT = 1

    # NOTE: NODE_MCP_REQUIREMENTS는 레거시 설정으로, 현재 워크플로우에서는 사용되지 않음
    # 실제 MCP 서버 바인딩은 WORKFLOW_DEFINITION의 tool_names를 통해 이루어짐
    # NODE_MCP_REQUIREMENTS = {
    #     "mcp_combined": {
    #         "preferred_aliases": ["alphafold", "pdb", "alphafold-server", "pdb-server","AlphaFold-MCP-Server","PDB-MCP-Server"],
    #         "contains_keywords": ["alphafold", "pdb", "structure", "protein"],
    #     }
    # }

    PROFESSIONAL_KEYWORDS = [
        "약", "단백질", "임상", "유전자", "화합물", "구조", "신약", "바이오", "의약", "임상시험",
        "drug", "protein", "compound", "gene", "clinical", "trial", "structure", "biotech", "pharmacology",
        "FDA", "ChEMBL", "PubChem", "KEGG", "Reactome", "pharma", "biomedical"
    ]

    WORKFLOW_DEFINITION: Tuple[Dict[str, Any], ...] = (
        # 각 워크플로우 단계는 MCP 서버를 통해 실행되는 전문 분석 단계입니다.
        # tool_names에 지정된 MCP 서버들이 해당 단계에서 사용 가능한 도구를 제공합니다.
        {
            "key": "target_agent",
            "title": "TargetAgent",
            "description": "Select core gene targets associated with the disease.",
            "tool_names": ("OpenTargets-MCP-Server","GeneOntology-MCP-Server"),
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
            "tool_names": ("ChEMBL-MCP-Server",),
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

    MCP_AGENT_TO_STAGE: Dict[str, str] = {
        "TV": "target_agent",
        "CD": "chem_agent",
        "SA": "structure_agent",
        "PI": "pathway_agent",
    }
    MCP_AGENT_CHOICES: Tuple[str, ...] = (*MCP_AGENT_TO_STAGE.keys(), "AG")

    def __init__(
        self,
        *,
        model: Optional[str] = None,
        emitter: Optional[Emitter] = None,
    ) -> None:
        self.model = model or _get_default_model()
        self._client = _get_openai_client()
        self._emitter: Optional[Emitter] = emitter
        
        # MCP adapter 및 workflow 초기화
        self._mcp_adapter = MCPAdapterClient()
        self._workflow_stage_configs = self._compile_workflow_stages()
        self._workflow_stage_functions = {
            stage["key"]: self._make_workflow_stage_node(stage)
            for stage in self._workflow_stage_configs
        }
        
        # Agent priority 및 stage mapping 초기화
        self._agent_priority: Tuple[str, ...] = tuple(self.MCP_AGENT_TO_STAGE.keys())
        self._stage_to_agent_code: Dict[str, str] = {
            stage_key: agent_code for agent_code, stage_key in self.MCP_AGENT_TO_STAGE.items()
        }
        
        # VectorDB 초기화 (환경 변수 미리 체크)
        self._vectordb: Optional[vectordb] = None
        self._vectordb_enabled = self._check_vectordb_env()
        
        # 그래프는 모든 설정 후 마지막에 빌드
        self._graph = self._build_graph()

    def set_emitter(self, emitter: Optional[Emitter]) -> None:
        self._emitter = emitter

    async def _emit(self, event: str, data: Any) -> None:
        if self._emitter is None:
            return
        try:
            await self._emitter(event, data)
        except Exception:
            log.exception("Failed to emit LangGraph event", extra={"event": event})

    def _check_vectordb_env(self) -> bool:
        """VectorDB 환경 변수를 미리 체크하여 사용 가능 여부 반환"""
        idx = os.getenv("WEAVIATE_INDEX")
        token = os.getenv("EMBEDDING_BEARER_TOKEN", "")
        
        if not idx or not token:
            log.info(
                "VectorDB is disabled due to missing environment variables",
                extra={"has_index": bool(idx), "has_token": bool(token)},
            )
            return False
        return True

    def _build_graph(self):
        graph = StateGraph(GraphState)
        
        # 기본 노드 등록
        graph.add_node("router", self._router_node)
        graph.add_node("classify", self._classify_node)
        graph.add_node("classify_mcp", self._classify_mcp_node)
        graph.add_node("direct_answer", self._direct_answer_node)
        graph.add_node("mcp_execution", self._execute_mcp_node)
        graph.add_node("history_length_check", self._history_length_check_node)
        graph.add_node("summary", self._summary_node)
        graph.add_node("increment_step", self._increment_step_node)
        graph.add_node("search_query", self._search_query_node)
        graph.add_node("vector_search", self._vector_search_node)
        graph.add_node("final_answer", self._final_answer_node)

        # Entry point
        graph.set_entry_point("router")
        graph.add_edge("router", "classify")

        # Classify 분기: MCP vs Direct Answer
        def classify_branch(state: GraphState):
            if state.get("_classify_is_mcp"):
                return "classify_mcp"
            return "direct_answer"
        graph.add_conditional_edges("classify", classify_branch)

        # MCP Classify 분기: AG (RAG) vs MCP Execution
        def classify_mcp_branch(state: GraphState):
            if state.get("next", "").upper() == "AG":
                return "search_query"
            return "mcp_execution"
        graph.add_conditional_edges("classify_mcp", classify_mcp_branch)

        # MCP Execution 후 히스토리 체크
        graph.add_edge("mcp_execution", "history_length_check")

        # 히스토리 길이 분기: Summary vs Increment
        def history_branch(state: GraphState):
            if state.get("_history_needs_summary"):
                return "summary"
            return "increment_step"
        graph.add_conditional_edges("history_length_check", history_branch)

        graph.add_edge("summary", "increment_step")

        # Step 카운트 분기: 반복 vs RAG 검색
        def step_branch(state: GraphState):
            if state.get("step_count", 0) >= self.MAX_WORKFLOW_ITERATIONS:
                return "search_query"
            return "classify_mcp"
        graph.add_conditional_edges("increment_step", step_branch)

        # RAG 검색 플로우
        graph.add_edge("search_query", "vector_search")
        graph.add_edge("vector_search", "final_answer")

        # 종료 노드
        graph.add_conditional_edges("final_answer", lambda _: END)
        graph.add_conditional_edges("direct_answer", lambda _: END)

        return graph.compile()
    async def _search_query_node(self, state: GraphState) -> GraphState:
        """
        MCP 워크플로우 결과를 바탕으로 벡터DB 검색에 사용할 검색어를 생성합니다.
        간단히 마지막 단계 결과나 질문을 활용(추후 LLM 활용 가능)
        """
        # 예시: 마지막 워크플로우 결과에서 주요 키워드 추출(여기선 질문 사용)
        search_query = state.get("original_question", "")
        state["current_search_query"] = search_query
        await self._emit(
            "reasoning",
            {
                "stage": "search_query",
                "message": f"벡터DB 검색용 쿼리 생성: {search_query}",
            },
        )
        return state

    async def _vector_search_node(self, state: GraphState) -> GraphState:
        """
        RAG vectordb를 활용해 검색어로 벡터DB 검색, 결과를 state["document_results"]에 저장
        """
        query = state.get("current_search_query")
        if not query:
            await self._emit(
                "reasoning",
                {
                    "stage": "vector_search",
                    "message": "벡터DB 검색어가 없어 검색을 건너뜁니다.",
                },
            )
            return state
        
        # 환경 변수 체크로 미리 disabled 확인
        if not self._vectordb_enabled:
            await self._emit(
                "reasoning",
                {
                    "stage": "vector_search",
                    "message": "벡터DB가 비활성화되어 있어 검색을 건너뜁니다.",
                },
            )
            return state
            
        db = await self._get_vectordb()
        if db is None:
            await self._emit(
                "reasoning",
                {
                    "stage": "vector_search",
                    "message": "벡터DB 인스턴스 초기화 실패로 검색을 건너뜁니다.",
                },
            )
            return state
            
        results = await asyncio.to_thread(db.hybrid_search, query)
        state["document_results"] = results
        await self._emit(
            "reasoning",
            {
                "stage": "vector_search",
                "message": f"벡터DB에서 {len(results)}건 검색됨.",
            },
        )
        return state
    async def _classify_node(self, state: GraphState) -> GraphState:
        """
        LLM을 사용해 질문이 제약/바이오/임상 등 전문적 질문인지, 아니면 일반 질문인지 분류합니다.
        """
        question = state.get("original_question", "")
        system_prompt = (
            "너는 입력된 사용자의 질문이 제약, 바이오, 신약개발, 임상, 생명과학, 단백질, 유전자, 화합물, 구조, 임상시험 등 전문적인 바이오/제약/의약 관련 질문인지, 아니면 일반적인 일상/상식/비전문 질문인지 분류하는 분류기야.\n"
            "아래 예시를 참고해서 반드시 '전문' 또는 '일반' 중 하나로만 대답해.\n"
            "예시:\n"
            "- '이 약의 부작용은?' → 전문\n"
            "- '단백질 구조 예측 방법은?' → 전문\n"
            "- '오늘 날씨 어때?' → 일반\n"
            "- '파이썬으로 리스트 정렬하는 법 알려줘' → 일반\n"
            "- '임상시험 승인 절차는?' → 전문\n"
            "- '치킨 맛집 추천해줘' → 일반\n"
            f"질문: {question}\n답변:"
        )
        # LLM 호출 (최대한 짧고 명확하게)
        result = await self._simple_llm_call(
            system_prompt=system_prompt,
            user_prompt="",
            temperature=0.0,
        )
        result = result.strip().replace("\n", "").replace(":", "").replace("답변", "").strip()
        is_mcp = result.startswith("전문")
        expert_sim_score = max(fuzz.partial_ratio(k, question) for k in self.PROFESSIONAL_KEYWORDS)
        keyword_match = self._detect_professional_keywords(question)
        if expert_sim_score >= 80 or keyword_match:
            is_mcp = True
        await self._emit(
            "reasoning",
            {
                "stage": "classify",
                "message": f"질문 분류 결과: {'제약/바이오 관련' if is_mcp else '일반 질문'}로 판단됨. (LLM 답변: {result}, 유사도: {expert_sim_score}, 키워드: {keyword_match})",
            },
        )
        # 분기 결과를 state에 저장(테스트/디버깅용)
        state["_classify_llm_result"] = result
        state["_classify_is_mcp"] = is_mcp
        state["_classify_keyword_match"] = keyword_match
        self._append_history(
            state,
            "system",
            f"General classifier decided {'MCP' if is_mcp else 'direct'} path (LLM: {result}, score: {expert_sim_score}).",
        )
        return state
    
    async def _classify_mcp_node(self, state: GraphState) -> GraphState:
        """Decide the next MCP agent by analyzing the current question and stage status."""
        stage_visits = state.setdefault("_stage_visit_counts", {})
        pending_agent = self._next_unvisited_agent(stage_visits)
        iteration_budget_reached = state.get("step_count", 0) >= self.MAX_WORKFLOW_ITERATIONS

        # 종료 조건: 최대 반복 또는 모든 스테이지 방문 완료
        if iteration_budget_reached or (pending_agent is None and stage_visits):
            state["next"] = "AG"
            reason = (
                "Stage iteration budget exhausted" if iteration_budget_reached else "All mapped MCP stages already visited"
            )
            rationale = f"{reason}; escalate to RAG search."
            state["rationale"] = rationale
            await self._emit(
                "reasoning",
                {
                    "stage": "classify_mcp",
                    "message": rationale,
                },
            )
            self._append_history(
                state,
                "system",
                f"Routing to RAG search: {rationale}",
            )
            return state

        question = state.get("original_question", "")
        
        # 방문한 스테이지와 미방문 스테이지 요약
        visited_stages = [stage for stage, count in stage_visits.items() if count > 0]
        unvisited_agents = [
            agent for agent in self._agent_priority
            if self.MCP_AGENT_TO_STAGE.get(agent)
            and stage_visits.get(self.MCP_AGENT_TO_STAGE[agent], 0) == 0
        ]
        
        # Agent 매핑 정보
        agent_descriptions = {
            "TV": "TargetAgent - Gene target identification",
            "PI": "PathwayAgent - Signaling pathway analysis",
            "CD": "ChemAgent - Compound activity data",
            "SA": "StructureAgent - 3D structure & binding prediction",
            "AG": "RAG Search - Document retrieval and synthesis"
        }
        
        format_choices = ", ".join(self.MCP_AGENT_CHOICES)
        visited_info = ", ".join(visited_stages) if visited_stages else "None"
        pending_info = ", ".join(unvisited_agents) if unvisited_agents else "None"
        
        # 간결하고 명확한 프롬프트
        system_prompt = (
            "You are a biomedical workflow router. Based on the user's question, "
            "select the MOST CRITICAL next agent to call. Each agent handles a specific analysis stage:\n"
            + "\n".join(f"- {code}: {desc}" for code, desc in agent_descriptions.items())
        )
        
        user_prompt = (
            f"User Question: {question}\n\n"
            f"Already visited stages: {visited_info}\n"
            f"Pending agents: {pending_info}\n\n"
            f"Choose the next agent code from: {format_choices}\n"
            f"Respond ONLY with valid JSON:\n"
            '{"next": "<agent_code>", "visible_rationale": "<brief reason>"}'
        )
        
        response = await self._simple_llm_call(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.1,  # 더 결정적인 선택을 위해 낮춤
        )
        
        # JSON 파싱
        raw_response = response.strip()
        cleaned_response = self._clean_json_response(raw_response)
        rationale = ""
        next_choice = pending_agent or "TV"  # fallback을 pending_agent로 변경
        
        try:
            payload = json.loads(cleaned_response)
            rationale = payload.get("visible_rationale") or payload.get("rationale", "")
            next_choice = payload.get("next", "").strip().upper()
        except json.JSONDecodeError:
            log.warning(
                "MCP classifier JSON parsing failed; using fallback",
                extra={
                    "response": raw_response,
                    "cleaned": cleaned_response,
                    "fallback": next_choice,
                },
            )
            rationale = f"JSON parsing failed; defaulting to {next_choice}."
        
        # Validation
        if next_choice not in self.MCP_AGENT_CHOICES:
            log.warning(
                "Invalid agent choice; using pending agent",
                extra={"choice": next_choice, "fallback": pending_agent or "TV"},
            )
            next_choice = pending_agent or "TV"
            rationale = f"Invalid choice; defaulting to {next_choice}."

        # 중복 방지: 이미 방문한 스테이지면 미방문 스테이지로 변경
        chosen_stage = self.MCP_AGENT_TO_STAGE.get(next_choice)
        already_completed = bool(chosen_stage and stage_visits.get(chosen_stage, 0))
        if already_completed and pending_agent and pending_agent != next_choice:
            rationale = (
                (rationale + " ") if rationale else ""
            ) + f"Override: {next_choice} already visited; selecting {pending_agent} instead."
            next_choice = pending_agent

        state["next"] = next_choice
        state["rationale"] = rationale
        state["_classify_mcp_raw"] = raw_response
        
        self._append_history(
            state,
            "system",
            f"MCP classifier selected {next_choice}: {rationale}",
        )
        await self._emit(
            "reasoning",
            {
                "stage": "classify_mcp",
                "message": f"Next agent: {next_choice}. Rationale: {rationale}"[:1000],
            },
        )
        return state

    async def _execute_mcp_node(self, state: GraphState) -> GraphState:
        next_agent = state.get("next", "TV") or "TV"
        next_agent = next_agent.upper()
        default_stage = self._workflow_stage_configs[0]["key"] if self._workflow_stage_configs else "target_agent"
        stage_key = self.MCP_AGENT_TO_STAGE.get(next_agent, default_stage)
        stage_func = self._workflow_stage_functions.get(stage_key)
        if stage_func:
            await stage_func(state)
            self._append_history(
                state,
                "system",
                f"Executed MCP stage '{stage_key}' for agent {next_agent}.",
            )
        else:
            self._append_history(
                state,
                "system",
                f"No workflow stage mapped for agent {next_agent}. Skipping MCP execution.",
            )
        stage_visits = state.setdefault("_stage_visit_counts", {})
        if stage_key:
            stage_visits[stage_key] = stage_visits.get(stage_key, 0) + 1
        state["_last_mcp_stage"] = stage_key
        return state

    @staticmethod
    def _clean_json_response(text: str) -> str:
        """Remove markdown fences and isolate the JSON object."""
        if not text:
            return text
        stripped = text.strip()
        if stripped.startswith("```"):
            # Remove ```json ... ``` fences
            parts = stripped.split("```")
            if len(parts) >= 3:
                stripped = parts[1 if parts[1].strip() else 2].strip()
                if stripped.lower().startswith("json"):
                    stripped = stripped[4:].lstrip()
            else:
                stripped = stripped.strip("`")
        # Extract first JSON object braces if extra text remains
        first = stripped.find("{")
        last = stripped.rfind("}")
        if first != -1 and last != -1 and last > first:
            return stripped[first : last + 1]
        return stripped

    async def _history_length_check_node(self, state: GraphState) -> GraphState:
        content = self._history_text(state)
        state["_history_needs_summary"] = len(content) > 10000
        return state

    async def _summary_node(self, state: GraphState) -> GraphState:
        history_excerpt = self._history_text(state)[-4000:]
        prompt = (
            "You are a concise summarizer. Compress the latest protocol and MCP interactions into a short paragraph. "
            "Emphasize the critical decisions and any missing data." 
        )
        user_prompt = f"History excerpt:\n{history_excerpt}\nSummarize it in <= 150 words."
        summary = await self._simple_llm_call(
            system_prompt=prompt,
            user_prompt=user_prompt,
            temperature=0.2,
        )
        summary_text = summary.strip()
        if summary_text:
            self._append_history(state, "system", f"History summary: {summary_text}")
        state["_history_needs_summary"] = False
        state["_last_summary"] = summary_text
        return state

    async def _increment_step_node(self, state: GraphState) -> GraphState:
        current = state.get("step_count", 0)
        state["step_count"] = current + 1
        self._append_history(
            state,
            "system",
            f"Loop counter incremented to {state['step_count']}.",
        )
        return state
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

            emit_message = agent_outcome["emit_message"]
            ran_llm_tools = bool(agent_outcome["used_tools"])
            if not ran_llm_tools and not stage_results:
                fallback_outcome = await self._run_fallback_tools(
                    stage_key=stage_key,
                    stage_title=stage_title,
                    query=query,
                    resolved_tools=resolved_tools,
                )
                if fallback_outcome["results"]:
                    stage_results.update(fallback_outcome["results"])
                trace_entry["tools"].extend(fallback_outcome["used_tools"])
                fallback_notes = fallback_outcome["notes"]
                if fallback_notes:
                    combined_notes = filter(
                        None,
                        [trace_entry.get("notes"), f"Fallback run:\n{fallback_notes}"],
                    )
                    trace_entry["notes"] = "\n\n".join(combined_notes)
                trace_entry["status"] = fallback_outcome["status"]
                emit_message = fallback_outcome["emit_message"] or emit_message
                if fallback_outcome["results"]:
                    await self._emit(
                        "reasoning",
                        {
                            "stage": stage_key,
                            "message": f"{stage_title} 단계에서 LLM 에이전트가 도구를 실행하지 않아 기본 MCP 호출을 수행했습니다.",
                            "results": list(stage_results.keys()),
                        },
                    )

            workflow_trace.append(trace_entry)

            await self._emit(
                "reasoning",
                {
                    "stage": stage_key,
                    "message": emit_message,
                    "results": list(stage_results.keys()),
                },
            )

            return state

        return _node

    def _append_history(self, state: GraphState, role: str, content: str) -> None:
        entry = _make_history_entry(role, content)
        state.setdefault("history", []).append(entry)

    def _history_text(self, state: GraphState) -> str:
        return "\n".join(entry.get("content", "") for entry in state.get("history", []))

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

            # LangChain 도구를 OpenAI tools 형식으로 변환
            tools_schema = self._convert_tools_to_openai_schema(resolved_tools)
            
            use_tool_schema = bool(tools_schema)
            response_payload = await self._simple_llm_call(
                system_prompt=(
                    f"You are the specialist agent for the {stage_title} stage. "
                    "Respond only with JSON that describes your next action."
                ),
                user_prompt=agent_instruction,
                tools=tools_schema if tools_schema else None,
                return_message=use_tool_schema,
            )

            tool_calls = []
            if use_tool_schema:
                response_message = response_payload
                if hasattr(response_message, "tool_calls") and response_message.tool_calls:
                    tool_calls = response_message.tool_calls
                response_text = getattr(response_message, "content", "") if response_message else ""
            else:
                response_text = response_payload or ""

            if tool_calls:
                log.info(
                    "LLM requested MCP tool via function call",
                    extra={
                        "stage": stage_key,
                        "tool_name": tool_calls[0].function.name if tool_calls[0].function else None,
                    },
                )
                call = tool_calls[0]
                function_name = call.function.name if call.function else ""
                arguments = {}
                if call.function and call.function.arguments:
                    try:
                        arguments = json.loads(call.function.arguments)
                    except json.JSONDecodeError:
                        log.warning(
                            "Failed to parse tool call arguments",
                            extra={"stage": stage_key, "raw": call.function.arguments},
                        )
                        arguments = {}
                decision = {
                    "action": "call_tool",
                    "tool_name": function_name,
                    "arguments": arguments,
                }
            else:
                try:
                    decision = json.loads(response_text or "{}")
                except json.JSONDecodeError:
                    decision = {"action": "finish", "summary": (response_text or "").strip()}

            log.debug(
                "Stage agent decision parsed",
                extra={
                    "stage": stage_key,
                    "action": decision.get("action"),
                    "source": "tool_call" if tool_calls else "text",
                    "response_excerpt": (response_text or "")[:200],
                },
            )

            action = (decision.get("action") or "").lower()
            if action == "call_tool":
                # MAX_STAGE_AGENT_TOOLS 제한 체크 (도구 호출 전)
                if len(used_tools) >= self.MAX_STAGE_AGENT_TOOLS:
                    scratchpad.append(
                        {
                            "type": "error",
                            "message": f"Tool budget limit ({self.MAX_STAGE_AGENT_TOOLS}) reached; cannot call more tools.",
                        }
                    )
                    summary = summary or "Tool budget reached before this call; stopping."
                    break
                
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
                    
                    # 빈 결과 체크
                    if not self._is_meaningful_result(result):
                        log.info(
                            f"Stage agent tool {tool_label} returned empty data",
                            extra={"tool": tool_label, "arguments": arguments},
                        )
                        scratchpad.append(
                            {
                                "type": "tool",
                                "tool": tool_label,
                                "input": arguments,
                                "output": "빈 결과 (관련 데이터 없음)",
                            }
                        )
                        # 빈 결과는 stage_results에 추가하지 않고 계속 진행
                        continue

                formatted_result = self._format_tool_result(result, max_chars=400)
                json_safe_args = self._jsonable(arguments)
                json_safe_result = self._jsonable(result)
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
                    "tool_use",
                    {
                        "stage": stage_key,
                        "stage_title": stage_title,
                        "tool_label": tool_label,
                        "tool_name": resolved.tool.name,
                        "server_name": resolved.server_name,
                        "description": getattr(resolved.tool, "description", ""),
                        "input_args": json_safe_args,
                        "output_result": json_safe_result,
                        "output_preview": formatted_result,
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    },
                )
                await self._emit(
                    "reasoning",
                    {
                        "stage": "mcp_tool",
                        "node": stage_key,
                        "tool": tool_label,
                        "message": f"{stage_title} 단계에서 {tool_label} 실행 중",
                    },
                )
                # 제한 체크는 위로 이동했으므로 여기서는 continue만
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

    def _convert_tools_to_openai_schema(
        self, resolved_tools: List[ResolvedMCPTool]
    ) -> List[Dict[str, Any]]:
        """Convert LangChain BaseTool to OpenAI function calling schema."""
        tools_schema = []
        for rt in resolved_tools:
            tool = rt.tool  # ResolvedMCPTool is a dataclass, not a dict
            
            # LangChain BaseTool의 args_schema 속성 사용
            parameters = {"type": "object", "properties": {}}
            
            # args_schema가 Pydantic model이면 schema() 호출
            if hasattr(tool, 'args_schema') and tool.args_schema:
                try:
                    if hasattr(tool.args_schema, 'schema'):
                        schema = tool.args_schema.schema()
                        # Pydantic v2의 경우 model_json_schema() 사용
                        if not schema and hasattr(tool.args_schema, 'model_json_schema'):
                            schema = tool.args_schema.model_json_schema()
                        if schema:
                            parameters = schema
                except Exception as e:
                    log.warning(
                        "Failed to extract args_schema",
                        extra={"tool": tool.name, "error": str(e)}
                    )
            # 레거시: args 속성 폴백
            elif hasattr(tool, 'args') and tool.args:
                if isinstance(tool.args, dict):
                    if "type" in tool.args and "properties" in tool.args:
                        parameters = tool.args
                    else:
                        parameters = {
                            "type": "object",
                            "properties": tool.args,
                        }
            
            function_schema = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or "",
                    "parameters": parameters
                }
            }
            
            # 디버깅: 첫 번째 도구의 스키마 로그 출력
            if not tools_schema:
                log.info(
                    "First tool schema for OpenAI",
                    extra={
                        "tool_name": tool.name,
                        "has_args_schema": hasattr(tool, 'args_schema'),
                        "has_args": hasattr(tool, 'args'),
                        "parameters_keys": list(parameters.keys()) if isinstance(parameters, dict) else None,
                    }
                )
            
            tools_schema.append(function_schema)
        
        return tools_schema

    async def _run_fallback_tools(
        self,
        *,
        stage_key: str,
        stage_title: str,
        query: str,
        resolved_tools: List[ResolvedMCPTool],
    ) -> Dict[str, Any]:
        fallback_results: Dict[str, Any] = {}
        used_tools: List[str] = []
        notes_lines: List[str] = []
        ranked_tools = self._rank_resolved_tools(query, resolved_tools)
        limit = self.FALLBACK_TOOL_LIMIT or len(ranked_tools)
        
        log.info(
            f"Fallback executing for {stage_title}",
            extra={
                "stage": stage_key,
                "query": query,
                "tool_count": len(ranked_tools),
                "limit": limit,
            },
        )
        
        for resolved in ranked_tools[:limit]:
            tool_label = resolved.label
            default_args = self._build_default_tool_args(resolved.tool, query)
            
            log.info(
                f"Fallback calling tool {tool_label}",
                extra={
                    "tool": tool_label,
                    "args": default_args,
                },
            )
            
            try:
                result = await resolved.tool.ainvoke(default_args)
            except Exception as exc:  # pragma: no cover - external service
                log.exception(
                    "Fallback MCP tool execution failed",
                    extra={
                        "stage": stage_title,
                        "tool": tool_label,
                        "exception": exc,
                    },
                )
                notes_lines.append(f"{tool_label} error: {exc}")
                continue

            serialized = self._serialize_tool_output(result)
            
            log.info(
                f"Fallback tool {tool_label} result",
                extra={
                    "tool": tool_label,
                    "result_type": type(result).__name__,
                    "result_length": len(str(result)),
                    "result_preview": str(result)[:200] if result else "None",
                },
            )
            
            # 빈 결과 필터링: 의미 있는 데이터가 있는지 검증
            if not self._is_meaningful_result(serialized):
                log.info(
                    f"Fallback tool {tool_label} returned empty or meaningless data",
                    extra={"tool": tool_label, "result": serialized},
                )
                notes_lines.append(
                    f"[Fallback] {tool_label} input={default_args} → 빈 결과 (데이터 없음)"
                )
                continue
            
            fallback_results.setdefault(tool_label, []).append(serialized)
            used_tools.append(tool_label)
            formatted = self._format_tool_result(serialized, max_chars=400)
            notes_lines.append(
                f"[Fallback] {tool_label} input={default_args} output={formatted}"
            )

        # 도구 실행 수와 결과 수를 구분하여 메시지 생성
        tools_executed = len(ranked_tools[:limit])
        status = "completed" if fallback_results else "skipped"
        
        if fallback_results:
            emit_message = f"{stage_title} 단계 기본 MCP 호출 완료 ({len(fallback_results)}개 툴에서 데이터 수집)"
        elif tools_executed > 0:
            emit_message = f"{stage_title} 단계에서 {tools_executed}개 MCP 도구를 실행했으나 관련 데이터를 찾지 못했습니다."
        else:
            emit_message = f"{stage_title} 단계에 사용 가능한 MCP 도구가 없습니다."
        
        notes = "\n".join(notes_lines) or "Fallback executed but produced no tool outputs."

        if not fallback_results:
            log.warning(
                "Fallback MCP execution produced no results",
                extra={
                    "stage": stage_title,
                    "stage_key": stage_key,
                    "tools_executed": tools_executed,
                    "tools_available": len(resolved_tools),
                },
            )

        return {
            "results": fallback_results,
            "used_tools": used_tools,
            "status": status,
            "notes": notes,
            "emit_message": emit_message,
        }

    def _is_meaningful_result(self, result: Any) -> bool:
        """
        빈 결과인지 검증합니다.
        
        Returns:
            True if result contains meaningful data, False otherwise
        """
        if result is None:
            return False
        
        # 문자열인 경우
        if isinstance(result, str):
            # 빈 문자열이나 공백만 있는 경우
            if not result.strip():
                return False
            
            # JSON 문자열인 경우 파싱 시도
            try:
                import json
                data = json.loads(result)
                return self._is_meaningful_result(data)
            except (json.JSONDecodeError, TypeError):
                # JSON이 아니면 문자열에 내용이 있다고 간주
                return True
        
        # 딕셔너리인 경우
        if isinstance(result, dict):
            # 빈 딕셔너리
            if not result:
                return False
            
            # 일반적인 빈 응답 패턴 체크
            # {"hits": [], "total": 0} 형태
            if "hits" in result and isinstance(result["hits"], list):
                if len(result["hits"]) == 0:
                    return False
            
            # {"data": {"search": {"hits": [], "total": 0}}} 형태
            if "data" in result:
                data = result["data"]
                if isinstance(data, dict):
                    if "search" in data:
                        search = data["search"]
                        if isinstance(search, dict):
                            if "hits" in search and isinstance(search["hits"], list):
                                if len(search["hits"]) == 0:
                                    return False
            
            # {"results": []} 형태
            if "results" in result and isinstance(result["results"], list):
                if len(result["results"]) == 0:
                    return False
            
            # 재귀적으로 딕셔너리 값 체크
            for value in result.values():
                if value is not None and value != "" and value != [] and value != {}:
                    return True
            return False
        
        # 리스트인 경우
        if isinstance(result, list):
            # 빈 리스트
            if not result:
                return False
            # 리스트 내 요소가 모두 빈 값인지 체크
            return any(self._is_meaningful_result(item) for item in result)
        
        # 기타 타입 (숫자, bool 등)은 의미 있는 값으로 간주
        return True

    def _rank_resolved_tools(
        self,
        query: str,
        resolved_tools: List[ResolvedMCPTool],
    ) -> List[ResolvedMCPTool]:
        """Rank tools by relevance to the query using fuzzy matching."""
        if not query:
            return resolved_tools
        
        ranked: List[Tuple[int, ResolvedMCPTool]] = []
        query_lower = query.lower()
        
        for resolved in resolved_tools:
            descriptor_parts = [
                resolved.label,
                resolved.server_name,
                getattr(resolved.tool, "name", None),
                getattr(resolved.tool, "description", None),
            ]
            descriptor = " ".join(part for part in descriptor_parts if part)
            
            # Fuzzy matching score
            score = fuzz.partial_ratio(query_lower, descriptor.lower()) if descriptor else 0
            
            # 최소 점수 임계값 설정 (너무 낮은 점수는 제외)
            if score >= 30:  # 30% 이상 매칭되는 도구만 포함
                ranked.append((score, resolved))
        
        # 점수순 정렬
        ranked.sort(key=lambda item: item[0], reverse=True)
        
        # 점수 로깅
        if ranked:
            log.info(
                "Tool ranking completed",
                extra={
                    "top_tool": ranked[0][1].label if ranked else None,
                    "top_score": ranked[0][0] if ranked else None,
                    "total_ranked": len(ranked),
                },
            )
        
        return [tool for _, tool in ranked]

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
            "IMPORTANT: You MUST call at least one tool to gather data before finishing.\n"
            "Action guardrails:\n"
            "1. ALWAYS call relevant tools to gather data - do not skip tool usage.\n"
            "2. Execute at most 3 distinct tools for this stage. Start with the most relevant tool.\n"
            "3. Invoke a single tool per step using JSON with proper arguments matching the schema.\n"
            "4. After gathering tool results, reply with action=\"finish\" and provide a concise summary.\n\n"
            "Output format (respond ONLY with valid JSON):\n"
            'For tool call: {"action": "call_tool", "tool_name": "<exact_tool_name>", "arguments": {<schema_fields>}}\n'
            'For finishing: {"action": "finish", "summary": "<brief summary of findings>"}\n\n'
            f"Progress so far:\n{history_text}\n\n"
            "Your response (JSON only):"
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

        # 벡터DB 검색 결과 추가
        vector_results = state.get("document_results", [])
        if vector_results:
            context_blocks.append("[벡터DB 검색 결과]\n" + self._format_tool_result(vector_results, max_chars=1200))

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
        ui_payload = self._build_ui_payload(state)
        if ui_payload:
            await self._emit("ui_payload", ui_payload)
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

    @staticmethod
    def _jsonable(value: Any) -> Any:
        try:
            json.dumps(value, ensure_ascii=False)
            return value
        except TypeError:
            if isinstance(value, dict):
                return {k: LangGraphSearchAgent._jsonable(v) for k, v in value.items()}
            if isinstance(value, list):
                return [LangGraphSearchAgent._jsonable(v) for v in value]
            if isinstance(value, tuple):
                return [LangGraphSearchAgent._jsonable(v) for v in value]
            return str(value)

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
        tools: Optional[List[Dict[str, Any]]] = None,
        return_message: bool = False,
    ) -> Union[str, Any]:
        client = self._client
        
        request_params = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
        }
        
        # tools가 있으면 추가
        if tools:
            request_params["tools"] = tools
            request_params["tool_choice"] = "auto"
        
        response = await client.chat.completions.create(**request_params)
        message = response.choices[0].message
        tool_call_count = len(getattr(message, "tool_calls", []) or [])
        log.debug(
            "LLM call completed",
            extra={
                "has_tools": bool(tools),
                "tool_call_count": tool_call_count,
                "content_preview": (message.content or "")[:200],
            },
        )
        if return_message:
            return message
        return message.content or ""


    def _build_ui_payload(self, state: GraphState) -> Optional[Dict[str, Any]]:
        workflow_results: Dict[str, Dict[str, Any]] = state.get("mcp_tool_results", {}) or {}
        if not workflow_results:
            return None

        target_name, compound_name = self._infer_target_and_compound(state)
        structure_panel = self._build_structure_panel(workflow_results, target_name, compound_name)
        linkage_info = self._build_linkage_info(workflow_results, compound_name, target_name)
        knowledge_graph = self._build_knowledge_graph_payload(target_name, compound_name)
        report_cards = self._build_report_cards(state, target_name, compound_name, structure_panel)

        payload: Dict[str, Any] = {}
        if knowledge_graph:
            payload["knowledge_graph"] = knowledge_graph
        if structure_panel:
            payload["structure_panel"] = structure_panel
        if linkage_info:
            payload["linkage"] = linkage_info
        if report_cards:
            payload["report_cards"] = report_cards
        return payload or None
    

    def _infer_target_and_compound(self, state: GraphState) -> Tuple[str, str]:
        question = state.get("original_question", "")
        question_lower = question.lower()
        target_candidates = [
            "KRAS",
            "NRAS",
            "HRAS",
            "BRAF",
            "EGFR",
            "ALK",
            "PIK3CA",
            "TP53",
            "CDK12",
            "MET",
            "RET",
        ]
        target_name = next((gene for gene in target_candidates if gene.lower() in question_lower), "Target")

        compound_match = re.search(r"\b([A-Z]{2,}[0-9]{2,}[A-Z0-9]*)\b", question)
        compound_name = compound_match.group(1) if compound_match else "Lead compound"
        if compound_name.upper() == target_name.upper():
            compound_name = "Lead compound"
        return target_name, compound_name

    def _build_structure_panel(
        self,
        workflow_results: Dict[str, Dict[str, Any]],
        target_name: str,
        compound_name: str,
    ) -> Optional[Dict[str, Any]]:
        stage_payload = (
            workflow_results.get("StructureAgent")
            or workflow_results.get("Structureagent")
            or workflow_results.get("Structure")
        )
        text_blob = self._flatten_stage_payload(stage_payload) if stage_payload else ""
        pdb_url = self._extract_first_match(text_blob, r"https?://[^\s\"']+\.pdb\b")
        binding_image = self._extract_first_match(text_blob, r"https?://[^\s\"']+\.(?:png|jpg|jpeg)")
        binding_pocket = "Switch-II pocket" if "switch" in text_blob.lower() else "Active site"

        if not pdb_url:
            pdb_url = "https://files.rcsb.org/download/8AW3.pdb"
        pdb_id_match = re.search(r"/([0-9A-Za-z]{4})\.pdb", pdb_url)
        pdb_id = pdb_id_match.group(1).upper() if pdb_id_match else None

        return {
            "target": target_name,
            "compound": compound_name,
            "bindingPocket": binding_pocket,
            "pdbUrl": pdb_url,
            "pdbId": pdb_id,
            "bindingModeImage": binding_image,
        }

    def _build_linkage_info(
        self,
        workflow_results: Dict[str, Dict[str, Any]],
        compound_name: str,
        target_name: str,
    ) -> Optional[Dict[str, Any]]:
        stage_payload = (
            workflow_results.get("ChemAgent")
            or workflow_results.get("ChemicalAgent")
            or workflow_results.get("Chem")
        )
        if not stage_payload:
            return {"compound": compound_name, "target": target_name}
        text_blob = self._flatten_stage_payload(stage_payload)
        smiles = self._extract_first_match(text_blob, r"SMILES[^A-Za-z0-9]*([A-Za-z0-9@+\-\[\]\(\)=#/\\]{6,})")
        if smiles:
            smiles = smiles.strip().strip('"')
        mechanism = self._extract_first_sentence(text_blob, keywords=("mechanism", "MoA", "mode of action"))
        references = self._extract_urls(text_blob)
        payload = {
            "compound": compound_name,
            "target": target_name,
            "smiles": smiles,
            "mechanism": mechanism,
            "references": references[:5] if references else None,
        }
        return {k: v for k, v in payload.items() if v}

    def _build_knowledge_graph_payload(
        self,
        target_name: str,
        compound_name: str,
    ) -> Dict[str, Any]:
        nodes = [
            {"id": target_name, "label": target_name, "group": "target", "level": 0},
            {"id": "MAPK", "label": "MAPK Pathway", "group": "pathway", "level": 1},
            {"id": "PI3K", "label": "PI3K", "group": "pathway", "level": 1},
            {"id": compound_name, "label": compound_name, "group": "compound", "level": 2},
            {"id": "MEK", "label": "MEK", "group": "pathway", "level": 2},
            {"id": "ERK", "label": "ERK", "group": "pathway", "level": 3},
        ]
        links = [
            {"source": target_name, "target": "MAPK", "strength": 0.95},
            {"source": target_name, "target": "PI3K", "strength": 0.85},
            {"source": "MAPK", "target": "MEK", "strength": 0.9},
            {"source": "MEK", "target": "ERK", "strength": 0.9},
            {"source": compound_name, "target": target_name, "strength": 0.98},
        ]
        return {"nodes": nodes, "links": links}

    def _build_report_cards(
        self,
        state: GraphState,
        target_name: str,
        compound_name: str,
        structure_panel: Optional[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        final_answer = state.get("final_answer", "") or ""
        summary = final_answer.split("\n\n")[0].strip() if final_answer else ""
        primary_card = {
            "title": f"{target_name} – {compound_name} binding summary",
            "summary": summary or "Generated from latest MCP workflow run.",
            "tags": [target_name, compound_name],
        }
        media_url = structure_panel.get("bindingModeImage") if structure_panel else None
        if media_url:
            primary_card["media"] = [
                {
                    "type": "image",
                    "url": media_url,
                    "caption": f"Predicted binding pose of {compound_name} against {target_name}",
                }
            ]
        return [primary_card]

    def _flatten_stage_payload(self, stage_payload: Dict[str, Any]) -> str:
        texts: List[str] = []

        def _collect(value: Any) -> None:
            if value is None:
                return
            if isinstance(value, (list, tuple)):
                for item in value:
                    _collect(item)
                return
            if isinstance(value, dict):
                try:
                    texts.append(json.dumps(value, ensure_ascii=False))
                except Exception:
                    texts.append(str(value))
                return
            texts.append(str(value))

        for entry in stage_payload.values():
            _collect(entry)
        return "\n".join(texts)

    @staticmethod
    def _extract_first_match(text: str, pattern: str) -> Optional[str]:
        if not text:
            return None
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            return None
        if match.lastindex:
            return match.group(1)
        return match.group(0)

    @staticmethod
    def _extract_first_sentence(text: str, *, keywords: Tuple[str, ...]) -> Optional[str]:
        if not text:
            return None
        lowered = text.lower()
        for keyword in keywords:
            idx = lowered.find(keyword.lower())
            if idx == -1:
                continue
            snippet = text[idx:]
            sentence_match = re.match(r"([^\.\n]+)", snippet)
            if sentence_match:
                return sentence_match.group(1).strip()
        return None

    @staticmethod
    def _extract_urls(text: str) -> List[str]:
        if not text:
            return []
        return re.findall(r"https?://[^\s\"']+", text)

    def _next_unvisited_agent(self, stage_visits: Dict[str, int]) -> Optional[str]:
        """Return the first unvisited agent code based on priority order."""
        for agent_code in self._agent_priority:
            stage_key = self.MCP_AGENT_TO_STAGE.get(agent_code)
            if not stage_key:
                continue
            if stage_visits.get(stage_key, 0) == 0:
                return agent_code
        return None
        return None

    def _detect_professional_keywords(self, question: str) -> bool:
        lowered = question.lower()
        for keyword in self.PROFESSIONAL_KEYWORDS:
            if keyword.lower() in lowered:
                return True
        return False

    async def run(
        self,
        *,
        question: str,
        history: List[Dict[str, str]] | None = None,
    ) -> GraphState:
        initial_messages = [
            *(history or []),
            {"role": "user", "content": question},
        ]
        initial_state: GraphState = {
            "messages": initial_messages,
            "history": [_make_history_entry(entry.get("role", "user"), entry.get("content", "")) for entry in initial_messages],
            "next": "",
            "step_count": 0,
            "rationale": "",
            "original_question": question,
            "search_iterations": 0,
            "search_results_summary": [],
            "current_search_query": None,
            "final_answer": None,
            "document_results": [],
            "mcp_tool_results": {},
            "workflow_trace": [],
            "_stage_visit_counts": {},
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
        """VectorDB 인스턴스를 lazy initialization으로 반환"""
        if self._vectordb is not None:
            return self._vectordb
        
        # 환경 변수가 없으면 즉시 반환
        if not self._vectordb_enabled:
            return None

        idx = os.getenv("WEAVIATE_INDEX")
        host = os.getenv("WEAVIATE_HOST", "localhost")
        http_port = int(os.getenv("WEAVIATE_HTTP_PORT", "8080"))
        grpc_port = int(os.getenv("WEAVIATE_GRPC_PORT", "50051"))
        serving_id = int(os.getenv("EMBEDDING_SERVING_ID", "10"))
        token = os.getenv("EMBEDDING_BEARER_TOKEN", "")
        base_url = os.getenv("EMBEDDING_BASE_URL", "https://genos.genon.ai:3443")

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
            log.info("VectorDB initialized successfully")
        except Exception:
            log.exception("Failed to initialize vectordb")
            self._vectordb = None
            self._vectordb_enabled = False  # 실패 시 재시도 방지

        return self._vectordb
