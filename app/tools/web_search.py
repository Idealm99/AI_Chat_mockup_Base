import aiohttp
import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.utils import States, ToolState
from app.logger import get_logger

log = get_logger(__name__)

try:
    from app.mcp import (
        get_mcp_tool,
        get_mcp_tool_serving_id,
        resolve_mcp_tool_name,
    )
except Exception:
    get_mcp_tool = None
    get_mcp_tool_serving_id = None
    resolve_mcp_tool_name = None

MCP_WEB_SEARCH_TOOL_NAME: str | None = None
MCP_WEB_SEARCH_CALLER = None
if get_mcp_tool and resolve_mcp_tool_name:
    candidate_env = os.getenv("MCP_WEB_SEARCH_TOOL", "web_search,search-web")
    candidates = [name.strip() for name in candidate_env.split(",") if name.strip()]
    resolved_name = resolve_mcp_tool_name(
        preferred_aliases=candidates,
        contains_keywords=["search"],
    )
    if resolved_name:
        try:
            MCP_WEB_SEARCH_CALLER = get_mcp_tool(resolved_name)
            MCP_WEB_SEARCH_TOOL_NAME = resolved_name
            serving_id = get_mcp_tool_serving_id(resolved_name) if get_mcp_tool_serving_id else None
            log.info(
                "MCP web search tool resolved",
                extra={"tool": resolved_name, "serving_id": serving_id},
            )
        except Exception:
            log.exception("Failed to initialize MCP web search tool", extra={"tool": resolved_name})
    else:
        log.warning("검색용 MCP 툴을 찾을 수 없습니다. Tavily fallback만 사용합니다.")


class SingleSearchModel(BaseModel):
    q: str = Field(description="search string (use the language that's most likely to match the sources)")
    recency: int | None = Field(description="limit to recent N days, or null", default=None)
    domains: list[str] | None = Field(description='restrict to domains (e.g. ["example.com", "another.com"], or null)', default=None)


class MultipleSearchModel(BaseModel):
    search_query: list[SingleSearchModel] = Field(description="array of search query objects. You can call this tool with multiple search queries to get more results faster.")
    response_length: Literal["short", "medium", "long"] = Field(description="response length option", default="medium")


WEB_SEARCH = {
    "type": "function",
    "function": {
        "name": "search",
        "description": "Search the web for information.",
        "parameters": {
            "type": "object",
            "properties": {
                "search_query": {
                    "type": "array",
                    "items": SingleSearchModel.model_json_schema(),
                    "description": "array of search query objects. You can call this tool with multiple search queries to get more results faster."
                },
                "response_length": {
                    "type": "string",
                    "enum": ["short", "medium", "long"],
                    "default": "medium",
                    "description": "response length option"
                }
            },
            "required": ["search_query"]
        }
    }
}


def _current_query_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


async def web_search(
    states: States,
    **tool_input
) -> list:
    
    try:
        tool_input = MultipleSearchModel(**tool_input)
    except Exception as e:
        return f"Error validating `web_search`: {e}"

    queried_at = _current_query_timestamp()
    log.info("web_search called", extra={
        "query": [sq.q for sq in tool_input.search_query] if hasattr(tool_input, 'search_query') else None,
        "queried_at": queried_at
    })

    # MCP API 우선 사용
    if MCP_WEB_SEARCH_CALLER is not None:
        mcp_payload = _prepare_mcp_payload(tool_input)
        try:
            mcp_results = await MCP_WEB_SEARCH_CALLER(states, **mcp_payload)
            converted = _convert_mcp_results(states, mcp_results, queried_at)
            if converted is not None:
                log.info("web_search MCP results", extra={"results": converted})
                return converted
        except Exception as e:
            log.exception("MCP web search call failed, fallback to Tavily", extra={"error": str(e), "tool": MCP_WEB_SEARCH_TOOL_NAME})

    # MCP 실패 시 Tavily API로 fallback
    async with aiohttp.ClientSession() as session:
        tasks = [
            single_search(
                session, 
                sq.q, 
                sq.recency, 
                sq.domains, 
                tool_input.response_length
            ) for sq in tool_input.search_query
        ]
        results = await asyncio.gather(*tasks)
    flatted_res = [item for sublist in results for item in sublist]
    outputs = _register_results(states, flatted_res, queried_at)
    try:
        log.info("web_search Tavily results", extra={"results": outputs})
    except Exception:
        log.info("web_search results (non-serializable)")
    return outputs


async def single_search(
    session: aiohttp.ClientSession, 
    q: str, 
    recency: str | None, 
    domains: list[str] | None, 
    response_length: Literal["short", "medium", "long"]
):
    # Tavily API only
    tavily_api_key = os.getenv("TAVILY_API_KEY")
    url = "https://api.tavily.com/search"

    size_map = {"short": 3, "medium": 5, "long": 7}
    num = size_map[response_length]

    payload = {
        "query": q,
        "api_key": tavily_api_key,
        "max_results": num,
        "include_domains": domains if domains else None,
        "recency_days": recency if recency else None
    }

    # Remove None values
    payload = {k: v for k, v in payload.items() if v is not None}

    async with session.post(url, json=payload) as resp:
        resp.raise_for_status()
        data = await resp.json()
        results = data.get("results", [])
        return [
            {
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": item.get("snippet", ""),
                "source": item.get("source", "tavily"),
                "date": item.get("date", None)
            } for item in results
        ]


def _convert_mcp_results(states: States, raw: Any, queried_at: str):
    if raw is None:
        return None
    if isinstance(raw, str):
        parsed = _try_parse_json(raw)
        if parsed is None:
            # 문자열 형태는 검색 결과가 아닌 안내 메시지일 가능성이 높으므로
            # Tavily fallback을 사용하도록 None을 반환한다.
            log.info("MCP search returned non-JSON string response; falling back", extra={"response": raw[:200]})
            return None
        raw = parsed
    if isinstance(raw, dict):
        raw = raw.get("data", [])

    results: list[dict[str, Any]] = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str):
                parsed_item = _try_parse_json(item)
                if parsed_item is None:
                    continue
                item = parsed_item
            if isinstance(item, list):
                results.extend([entry for entry in item if isinstance(entry, dict)])
            elif isinstance(item, dict):
                results.extend(_flatten_mcp_entry(item))

    if not results:
        return []

    normalized = _normalize_results(results)
    if not normalized:
        return []

    return _register_results(states, normalized, queried_at)


def _try_parse_json(payload: str) -> Any | None:
    try:
        return json.loads(payload)
    except Exception:
        return None


def _prepare_mcp_payload(tool_input: MultipleSearchModel) -> dict[str, Any]:
    """Transform internal search payload to the MCP tool's expected schema."""

    data = tool_input.model_dump()

    # If the MCP tool already accepts the same schema, return as-is.
    if "query" in data:
        return data

    search_queries = data.get("search_query") or []
    first_query = search_queries[0] if search_queries else None
    converted: dict[str, Any] = {}

    if first_query:
        converted["query"] = first_query.get("q")
        if first_query.get("recency") is not None:
            converted["recency"] = first_query["recency"]
        if first_query.get("domains"):
            converted["domains"] = first_query["domains"]

    response_length = data.get("response_length")
    if response_length:
        converted["response_length"] = response_length

    # Fall back to original structure if we couldn't build a query payload.
    return converted if converted else data


def _flatten_mcp_entry(item: dict[str, Any]) -> list[dict[str, Any]]:
    organic_results = item.get("organic_results")
    if isinstance(organic_results, list) and organic_results:
        flattened: list[dict[str, Any]] = []
        for entry in organic_results:
            if not isinstance(entry, dict):
                continue
            enriched = dict(entry)
            if item.get("search_query"):
                enriched.setdefault("search_query", item["search_query"])
            if item.get("search_information"):
                enriched.setdefault("search_information", item["search_information"])
            if item.get("related_questions"):
                enriched.setdefault("related_questions", item["related_questions"])
            flattened.append(enriched)
        return flattened
    return [item]


def _normalize_results(results: list[dict[str, Any]]):
    normalized: list[dict[str, Any]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        entry = dict(item)
        entry.setdefault("title", entry.get("name", ""))
        entry.setdefault("url", entry.get("link", ""))
        entry.setdefault("snippet", entry.get("summary", entry.get("content", "")))
        entry.setdefault("source", entry.get("publisher", entry.get("source", "web")))
        entry.setdefault("date", entry.get("published_at", entry.get("date")))
        normalized.append(entry)
    return normalized


def _register_results(states: States, results: list[dict[str, Any]], queried_at: str | None = None):
    if not isinstance(results, list):
        return []

    tool_state = getattr(states, "tool_state", None)
    if not isinstance(tool_state, ToolState):
        tool_state = ToolState()
        states.tool_state = tool_state

    current_turn = getattr(states, "turn", 0)
    outputs = []
    for idx, item in enumerate(results):
        if not isinstance(item, dict):
            continue
        result_id = f"{current_turn}:{idx}"
        url = item.get("url")
        if url:
            tool_state.id_to_url[result_id] = url
        entry = {"id": result_id, **item}
        if queried_at:
            entry["queried_at"] = queried_at
        outputs.append(entry)

    setattr(states, "turn", current_turn + 1)
    return outputs
