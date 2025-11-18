import aiohttp
import asyncio
import os
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.utils import States, ToolState
from app.logger import get_logger

log = get_logger(__name__)

try:
    from app.mcp import get_mcp_tool
except Exception:
    get_mcp_tool = None

MCP_WEB_SEARCH_TOOL_NAME: str | None = None
MCP_WEB_SEARCH_CALLER = None
if get_mcp_tool:
    candidates = [name.strip() for name in os.getenv("MCP_WEB_SEARCH_TOOL", "web_search,search-web").split(",") if name.strip()]
    for candidate in candidates:
        try:
            MCP_WEB_SEARCH_CALLER = get_mcp_tool(candidate)
            MCP_WEB_SEARCH_TOOL_NAME = candidate
            log.info("MCP web search tool detected", extra={"tool": candidate})
            break
        except ValueError:
            continue
        except Exception:
            log.exception("Failed to initialize MCP web search tool", extra={"tool": candidate})
            continue


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


async def web_search(
    states: States,
    **tool_input
) -> list:
    
    try:
        tool_input = MultipleSearchModel(**tool_input)
    except Exception as e:
        return f"Error validating `web_search`: {e}"

    log.info("web_search called", extra={"query": [sq.q for sq in tool_input.search_query] if hasattr(tool_input, 'search_query') else None})

    if MCP_WEB_SEARCH_CALLER is not None:
        mcp_payload = tool_input.model_dump()
        try:
            mcp_results = await MCP_WEB_SEARCH_CALLER(states, **mcp_payload)
        except Exception as e:
            log.exception("MCP web search call failed", extra={"error": str(e), "tool": MCP_WEB_SEARCH_TOOL_NAME})
        else:
            converted = _convert_mcp_results(states, mcp_results)
            if converted is not None:
                return converted

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
    outputs = _register_results(states, flatted_res)

    # Log structured results
    try:
        log.info("web_search results", extra={"results": outputs})
    except Exception:
        log.info("web_search results (non-serializable)")

    # Return structured list of results for callers to handle
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


def _convert_mcp_results(states: States, raw: Any):
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        raw = raw.get("data", [])

    results: list[dict[str, Any]] = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, list):
                results.extend([entry for entry in item if isinstance(entry, dict)])
            elif isinstance(item, dict):
                results.append(item)

    if not results:
        return []

    normalized = _normalize_results(results)
    if not normalized:
        return []

    return _register_results(states, normalized)


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


def _register_results(states: States, results: list[dict[str, Any]]):
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
        outputs.append({"id": result_id, **item})

    setattr(states, "turn", current_turn + 1)
    return outputs
