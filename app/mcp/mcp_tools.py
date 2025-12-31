from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import threading
def _run_coroutine_in_thread(factory):
    result: Dict[str, Any] = {}
    error: Dict[str, BaseException] = {}

    def _runner():
        try:
            result["value"] = asyncio.run(factory())
        except BaseException as exc:  # pragma: no cover - runtime only
            error["exc"] = exc

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    thread.join()
    if error:
        raise error["exc"]
    return result.get("value")
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import aiohttp
import requests
from langchain_mcp_adapters.sessions import Connection, create_session
from mcp import types as mcp_types

from app.utils import ROOT_DIR, States, ToolState

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_LOCAL_CONFIG = "../config/mcp_servers.local.json"
MERGEABLE_DICT_KEYS = ("env", "headers", "session_kwargs")
SUPPORTED_LOCAL_TRANSPORTS = {"stdio", "sse", "websocket", "streamable_http"}


@dataclass(frozen=True)
class MCPToolInfo:
    """Metadata kept for each MCP tool."""

    name: str
    server_id: str
    serving_id: Optional[str]
    schema: Dict[str, Any]
    raw: Dict[str, Any]


@dataclass(frozen=True)
class LocalServerEntry:
    name: str
    display_name: str
    description: str
    connection: Connection
    tool_allowlist: set[str]
    tool_blocklist: set[str]


_LOCAL_SERVER_CONNECTIONS: Dict[str, Connection] = {}
_CURRENT_MCP_MODE = os.getenv("MCP_MODE", "genos").strip().lower() or "genos"
if _CURRENT_MCP_MODE not in {"genos", "local", "off"}:
    logger.warning("알 수 없는 MCP_MODE=%s, genos 모드로 대체합니다.", _CURRENT_MCP_MODE)
    _CURRENT_MCP_MODE = "genos"


def _deep_merge_dict(base: Optional[Dict[str, Any]], override: Optional[Dict[str, Any]]) -> Dict[str, Any] | None:
    merged: Dict[str, Any] = {}
    if base:
        merged.update(base)
    if override:
        merged.update(override)
    return merged or None


def _resolve_path(value: Optional[str], *, base: Path) -> Optional[str]:
    if not value:
        return None
    path = Path(value)
    if not path.is_absolute():
        path = (base / path).resolve()
    return str(path)


def _normalize_args(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple)):
        return [str(arg) for arg in value]
    raise ValueError("args 필드는 문자열 또는 문자열 리스트여야 합니다.")


def _build_connection(entry: Dict[str, Any], *, base_dir: Path) -> Connection:
    transport = entry.get("transport")
    if not transport or transport not in SUPPORTED_LOCAL_TRANSPORTS:
        raise ValueError(
            "transport 필드는 stdio/sse/websocket/streamable_http 중 하나여야 합니다."
        )

    connection: Connection = {"transport": transport}

    if transport == "stdio":
        command = entry.get("command")
        if not command:
            raise ValueError("stdio 연결에는 command가 필요합니다.")
        connection["command"] = command
        connection["args"] = _normalize_args(entry.get("args", []))
    else:
        url = entry.get("url")
        if not url:
            raise ValueError(f"{transport} 연결에는 url이 필요합니다.")
        connection["url"] = url

    if entry.get("cwd"):
        resolved = _resolve_path(entry.get("cwd"), base=base_dir)
        if resolved:
            connection["cwd"] = resolved

    for key in ("env", "headers", "session_kwargs"):
        value = entry.get(key)
        if value:
            connection[key] = value

    for key in ("timeout", "sse_read_timeout", "encoding", "encoding_error_handler"):
        if entry.get(key) is not None:
            connection[key] = entry[key]

    return connection


def _merge_server_defaults(defaults: Dict[str, Any] | None, server: Dict[str, Any]) -> Dict[str, Any]:
    """Apply optional defaults onto a server config entry.

    When the JSON already contains the resolved transport/command/etc. per entry,
    the defaults block may be empty or omitted. In that case we simply return a
    copy of the server definition without additional merging. This keeps the
    loader compatible with both the legacy (defaults driven) and the new
    fully-expanded config formats.
    """

    defaults = defaults or {}
    if not defaults:
        return dict(server)

    merged = dict(defaults)
    merged.update(server)
    for key in MERGEABLE_DICT_KEYS:
        merged[key] = _deep_merge_dict(defaults.get(key), server.get(key))
    if "args" not in merged and defaults.get("args"):
        merged["args"] = defaults["args"]
    return merged


def _parse_local_server_config() -> List[LocalServerEntry]:
    config_path = os.getenv("MCP_LOCAL_SERVER_CONFIG")
    if config_path:
        config_path = config_path.strip()
    path = Path(config_path) if config_path else Path(ROOT_DIR) / DEFAULT_LOCAL_CONFIG
    if not path.is_absolute():
        path = (Path(ROOT_DIR) / path).resolve()

    if not path.exists():
        logger.warning("로컬 MCP 설정 파일이 없습니다: %s", path)
        return []

    try:
        config_data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        logger.error("로컬 MCP 설정 파일 파싱 실패", exc_info=exc)
        return []

    defaults = config_data.get("defaults", {}) or {}
    servers = config_data.get("servers") or []
    if not servers:
        logger.warning("로컬 MCP 설정에 servers 항목이 없습니다: %s", path)
        return []

    base_cwd = os.getenv("MCP_LOCAL_DEFAULT_CWD")
    base_dir = Path(base_cwd).resolve() if base_cwd else path.parent

    entries: List[LocalServerEntry] = []
    for server in servers:
        merged = _merge_server_defaults(defaults, server)
        name = (merged.get("name") or merged.get("id") or "").strip()
        if not name:
            logger.warning("로컬 MCP 서버 항목에 name/id가 없습니다: %s", server)
            continue
        try:
            connection = _build_connection(merged, base_dir=base_dir)
        except Exception as exc:  # pragma: no cover - config errors
            logger.error("로컬 MCP 서버 연결 구성 실패: %s", name, exc_info=exc)
            continue
        entries.append(
            LocalServerEntry(
                name=name,
                display_name=merged.get("display_name", name),
                description=merged.get("description", ""),
                connection=connection,
                tool_allowlist=set(merged.get("tool_allowlist") or []),
                tool_blocklist=set(merged.get("tool_blocklist") or []),
            )
        )
    return entries


async def _load_local_servers(entries: List[LocalServerEntry]):
    normalized_tools: List[Dict[str, Any]] = []
    tool_name_to_server: Dict[str, str] = {}
    tool_registry: Dict[str, MCPToolInfo] = {}

    _LOCAL_SERVER_CONNECTIONS.clear()

    for entry in entries:
        connection_copy = copy.deepcopy(entry.connection)
        _LOCAL_SERVER_CONNECTIONS[entry.name] = connection_copy
        try:
            async with create_session(copy.deepcopy(connection_copy)) as session:
                await session.initialize()
                tool_response = await session.list_tools()
        except Exception as exc:  # pragma: no cover - transport/runtime errors
            logger.error("MCP 서버 연결 실패: %s", entry.name, exc_info=exc)
            continue

        if hasattr(tool_response, "tools"):
            tools_iterable = tool_response.tools or []
        elif isinstance(tool_response, dict):
            tools_iterable = tool_response.get("tools") or []
        else:
            tools_iterable = tool_response or []

        for tool_candidate in tools_iterable:
            tool = tool_candidate[0] if isinstance(tool_candidate, tuple) else tool_candidate
            if not hasattr(tool, "name"):
                logger.warning("알 수 없는 MCP tool 항목을 건너뜁니다: entry=%s", tool_candidate)
                continue
            tool_name = tool.name
            if entry.tool_allowlist and tool_name not in entry.tool_allowlist:
                continue
            if tool_name in entry.tool_blocklist:
                continue
            schema = tool.inputSchema or {"type": "object", "properties": {}}
            info = MCPToolInfo(
                name=tool_name,
                server_id=entry.name,
                serving_id=None,
                schema=schema,
                raw=tool.model_dump(),
            )
            normalized_tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": tool.description or "",
                        "parameters": schema,
                    },
                }
            )
            tool_registry[tool_name] = info
            tool_name_to_server[tool_name] = entry.name

    logger.info(
        "로컬 MCP 서버 로드 완료",
        extra={"servers": list(_LOCAL_SERVER_CONNECTIONS.keys()), "tools": len(tool_registry)},
    )
    return normalized_tools, tool_name_to_server, tool_registry


def _get_genos_base_url() -> str:
    return os.getenv("GENOS_URL", "https://genos.mnc.ai:3443").rstrip("/")


def _get_genos_token_sync() -> str:
    response = requests.post(
        f"{_get_genos_base_url()}/api/admin/auth/login",
        json={
            "user_id": os.getenv("GENOS_ID"),
            "password": os.getenv("GENOS_PW"),
        },
    )
    response.raise_for_status()
    return response.json()["data"]["access_token"]


def _fetch_genos_tools(server_id: str) -> List[Dict[str, Any]]:
    token = _get_genos_token_sync()
    response = requests.get(
        f"{_get_genos_base_url()}/api/admin/mcp/server/test/{server_id}/tools",
        headers={"Authorization": f"Bearer {token}"},
    )
    response.raise_for_status()
    return response.json()["data"]


def _load_genos_tools():
    tool_name_to_server_id: Dict[str, str] = {}
    tool_registry: Dict[str, MCPToolInfo] = {}
    normalized_tools: List[Dict[str, Any]] = []

    mcp_server_raw = os.getenv("MCP_SERVER_ID", "")
    server_ids = [endpoint.strip() for endpoint in mcp_server_raw.split(",") if endpoint.strip()]

    if not server_ids:
        logger.warning("MCP_SERVER_ID가 설정되지 않았습니다. MCP 툴을 비활성화합니다.")
        return [], {}, {}

    for server_id in server_ids:
        try:
            tools = _fetch_genos_tools(server_id)
        except Exception as exc:  # pragma: no cover - depends on infra
            logger.error("GenOS 툴 메타데이터 조회 실패: %s", server_id, exc_info=exc)
            continue
        for tool in tools:
            name = tool.get("name")
            if not name:
                continue
            schema = tool.get("input_schema") or tool.get("parameters") or {"type": "object", "properties": {}}
            serving_id = tool.get("serving_id") or tool.get("servingId") or tool.get("mcp_serving_id")
            serving_id = str(serving_id) if serving_id not in (None, "") else None
            info = MCPToolInfo(
                name=name,
                server_id=server_id,
                serving_id=serving_id,
                schema=schema,
                raw=tool,
            )
            tool_registry[name] = info
            tool_name_to_server_id[name] = server_id
            normalized_tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": tool.get("description", ""),
                        "parameters": schema,
                    },
                }
            )

    logger.info(
        "GenOS MCP 툴 로드 완료",
        extra={"count": len(tool_registry), "server_ids": server_ids},
    )
    return normalized_tools, tool_name_to_server_id, tool_registry


async def _call_genos_tool(server_id: str, tool_name: str, tool_input: Dict[str, Any]):
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{_get_genos_base_url()}/api/admin/auth/login",
            json={
                "user_id": os.getenv("GENOS_ID"),
                "password": os.getenv("GENOS_PW"),
            },
        ) as token_response:
            token_response.raise_for_status()
            token = (await token_response.json())["data"]["access_token"]

        async with session.post(
            f"{_get_genos_base_url()}/api/admin/mcp/server/test/{server_id}/tools/call",
            headers={"Authorization": f"Bearer {token}"},
            json={"tool_name": tool_name, "input_schema": tool_input},
        ) as response:
            response.raise_for_status()
            data = (await response.json())["data"]
            return data


def _normalize_call_tool_result(result: mcp_types.CallToolResult) -> Any:
    if result.structuredContent is not None:
        return result.structuredContent
    if not result.content:
        return {"content": [], "is_error": result.isError}
    text_blocks = [block.text for block in result.content if isinstance(block, mcp_types.TextContent)]
    if len(text_blocks) == len(result.content):
        return text_blocks[0] if len(text_blocks) == 1 else text_blocks
    payload: Dict[str, Any] = {
        "content": [block.model_dump() for block in result.content],
    }
    if result.isError:
        payload["is_error"] = True
    return payload


async def _call_local_tool(server_id: str, tool_name: str, tool_input: Dict[str, Any]):
    connection = _LOCAL_SERVER_CONNECTIONS.get(server_id)
    if not connection:
        raise RuntimeError(f"로컬 MCP 서버 연결 정보를 찾을 수 없습니다: {server_id}")
    async with create_session(copy.deepcopy(connection)) as session:
        await session.initialize()
        call_result = await session.call_tool(tool_name, tool_input or None)
        return _normalize_call_tool_result(call_result)


def _bootstrap_mcp_tools():
    if _CURRENT_MCP_MODE == "off":
        logger.info("MCP_MODE=off: MCP 도구 로딩을 건너뜁니다.")
        return [], {}, {}
    if _CURRENT_MCP_MODE == "local":
        entries = _parse_local_server_config()
        if not entries:
            return [], {}, {}
        return _run_coroutine_in_thread(lambda: _load_local_servers(entries))
    return _load_genos_tools()


MCP_TOOLS, MCP_TOOL_NAME_TO_SERVER_ID, MCP_TOOL_REGISTRY = _bootstrap_mcp_tools()
MCP_TOOL_ALIAS_MAP: Dict[str, str] = {
    name.lower().replace("-", "_").replace(" ", "_"): name for name in MCP_TOOL_REGISTRY.keys()
}


def get_every_mcp_tools_description():
    """Return the cached MCP tool metadata for compatibility."""
    return MCP_TOOLS, MCP_TOOL_NAME_TO_SERVER_ID, MCP_TOOL_REGISTRY


def _canonical_tool_name(tool_name: str) -> str:
    if tool_name in MCP_TOOL_REGISTRY:
        return tool_name
    normalized = tool_name.lower().replace("-", "_").replace(" ", "_")
    canonical = MCP_TOOL_ALIAS_MAP.get(normalized)
    if canonical:
        return canonical
    raise ValueError(f"Tool {tool_name} not found")


def list_mcp_tool_names() -> List[str]:
    return list(MCP_TOOL_REGISTRY.keys())


def resolve_mcp_tool_name(
    preferred_aliases: Optional[Iterable[str]] = None,
    contains_keywords: Optional[Iterable[str]] = None,
) -> Optional[str]:
    preferred_aliases = preferred_aliases or []
    for alias in preferred_aliases:
        try:
            return _canonical_tool_name(alias)
        except ValueError:
            continue

    contains_keywords = [kw.lower() for kw in (contains_keywords or [])]
    if contains_keywords:
        for name in MCP_TOOL_REGISTRY.keys():
            lowered = name.lower()
            if all(kw in lowered for kw in contains_keywords):
                return name
    return None


def get_mcp_tool_metadata(tool_name: str) -> MCPToolInfo:
    canonical = _canonical_tool_name(tool_name)
    return MCP_TOOL_REGISTRY[canonical]


def get_mcp_tool_serving_id(tool_name: str) -> Optional[str]:
    info = get_mcp_tool_metadata(tool_name)
    return info.serving_id


def get_mcp_tool_schema(tool_name: str) -> Dict[str, Any]:
    info = get_mcp_tool_metadata(tool_name)
    return info.schema


def get_mcp_tools_schemas(tool_names: Iterable[str], filter_by_server: bool = False) -> List[Dict[str, Any]]:
    """
    Get MCP tool schemas.
    
    Args:
        tool_names: List of tool names (or server names if filter_by_server=True)
        filter_by_server: If True, tool_names are treated as MCP server names
    
    Returns:
        List of tool schema dictionaries
    """
    schemas: List[Dict[str, Any]] = []
    
    if filter_by_server:
        # tool_names are MCP server names; get tools from those servers
        target_servers = set(tool_names)
        for canonical, info in MCP_TOOL_REGISTRY.items():
            server_id = MCP_TOOL_NAME_TO_SERVER_ID.get(canonical)
            # Extract server name from serving_id (e.g., "AlphaFold-MCP-Server" from "local:AlphaFold-MCP-Server")
            if server_id:
                server_name = server_id.split(":")[-1] if ":" in server_id else server_id
                if server_name in target_servers:
                    schemas.append(
                        {
                            "type": "function",
                            "function": {
                                "name": info.name,
                                "description": info.raw.get("description", ""),
                                "parameters": info.schema,
                            },
                        }
                    )
    else:
        # tool_names are specific tool names
        for name in tool_names:
            try:
                canonical = _canonical_tool_name(name)
            except ValueError:
                continue
            info = MCP_TOOL_REGISTRY[canonical]
            schemas.append(
                {
                    "type": "function",
                    "function": {
                        "name": info.name,
                        "description": info.raw.get("description", ""),
                        "parameters": info.schema,
                    },
                }
            )
    return schemas


def get_mcp_tool(tool_name: str):
    if not MCP_TOOL_REGISTRY:
        raise RuntimeError("활성화된 MCP 도구가 없습니다. 환경설정(MCP_MODE 등)을 확인하세요.")

    canonical = _canonical_tool_name(tool_name)
    server_id = MCP_TOOL_NAME_TO_SERVER_ID[canonical]

    async def call_mcp_tool(states: States, **tool_input):
        if _CURRENT_MCP_MODE == "local":
            result = await _call_local_tool(server_id, canonical, tool_input)
        else:
            result = await _call_genos_tool(server_id, canonical, tool_input)

        normalized_name = canonical.replace("-", "_")
        if normalized_name == "comprehensive_web_search":
            tool_state = getattr(states, "tool_state", None)
            if not isinstance(tool_state, ToolState):
                tool_state = ToolState()
                states.tool_state = tool_state
            iframe_index = len(tool_state.id_to_iframe)
            tool_state.id_to_iframe[f"{iframe_index}"] = result
            return (
                "search 결과가 생성되었습니다. ID: "
                f"`【{iframe_index}†chart】`를 사용해 사용자에게 표시하세요."
            )
        return result

    return call_mcp_tool

