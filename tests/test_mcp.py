import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

import aiohttp
import requests
import logging
# from app.utils import States, ToolState

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MCPToolInfo:
    """Metadata kept for each MCP tool discovered from GenOS."""

    name: str
    server_id: str
    serving_id: Optional[str]
    schema: Dict[str, Any]
    raw: Dict[str, Any]


def get_tools_description(server_id: str):
    token_response = requests.post(
        "https://genos.mnc.ai:3443/api/admin/auth/login",
        json={
            "user_id": os.getenv("GENOS_ID"),
            "password": os.getenv("GENOS_PW")
        }
    )
    token_response.raise_for_status()
    token = token_response.json()["data"]["access_token"]
    response = requests.get(
        f"https://genos.mnc.ai:3443/api/admin/mcp/server/test/{server_id}/tools",
        headers={
            "Authorization": f"Bearer {token}"
        }
    )
    response.raise_for_status()
    return response.json()['data']


def _normalize_alias(value: str) -> str:
    return value.lower().replace("-", "_").replace(" ", "_")


def get_every_mcp_tools_description():
    tool_name_to_server_id: Dict[str, str] = {}
    tool_registry: Dict[str, MCPToolInfo] = {}
    normalized_tools: List[Dict[str, Any]] = []

    mcp_server_raw = os.getenv("MCP_SERVER_ID", "")
    mcp_server_id_list = [endpoint.strip() for endpoint in mcp_server_raw.split(",") if endpoint.strip()]

    if not mcp_server_id_list:
        logger.warning("MCP_SERVER_ID가 설정되지 않았습니다. MCP 툴을 비활성화합니다.")
        return [], {}, {}

    nested_list = [get_tools_description(endpoint) for endpoint in mcp_server_id_list]
    for server_id, data in zip(mcp_server_id_list, nested_list):
        for tool in data:
            name = tool.get("name")
            if not name:
                continue
            schema = tool.get("input_schema") or tool.get("parameters") or {"type": "object", "properties": {}}
            serving_id = tool.get("serving_id") or tool.get("servingId") or tool.get("mcp_serving_id")
            serving_id = str(serving_id) if serving_id not in (None, "") else None
            tool_name_to_server_id[name] = server_id
            tool_registry[name] = MCPToolInfo(
                name=name,
                server_id=server_id,
                serving_id=serving_id,
                schema=schema,
                raw=tool,
            )
            normalized_tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": tool.get("description", ""),
                        "parameters": schema,
                    }
                }
            )

    logger.info(
        "MCP 툴 메타데이터 로드 완료",
        extra={
            "count": len(tool_registry),
            "tool_names": list(tool_registry.keys()),
        },
    )
    return normalized_tools, tool_name_to_server_id, tool_registry


# MCP_TOOLS, MCP_TOOL_NAME_TO_SERVER_ID, MCP_TOOL_REGISTRY = get_every_mcp_tools_description()
# MCP_TOOL_ALIAS_MAP: Dict[str, str] = {}
# for canonical_name in MCP_TOOL_REGISTRY.keys():
#     MCP_TOOL_ALIAS_MAP[_normalize_alias(canonical_name)] = canonical_name


def _canonical_tool_name(tool_name: str) -> str:
    if tool_name in MCP_TOOL_REGISTRY:
        return tool_name
    normalized = _normalize_alias(tool_name)
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


def get_mcp_tools_schemas(tool_names: Iterable[str]) -> List[Dict[str, Any]]:
    schemas: List[Dict[str, Any]] = []
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
    canonical = _canonical_tool_name(tool_name)
    server_id = MCP_TOOL_NAME_TO_SERVER_ID[canonical]

    async def call_mcp_tool(states: States, **tool_input):
        async with aiohttp.ClientSession() as session:
            token_response = await session.post(
                "https://genos.mnc.ai:3443/api/admin/auth/login",
                json={
                    "user_id": os.getenv("GENOS_ID"),
                    "password": os.getenv("GENOS_PW")
                }
            )
            token_response.raise_for_status()
            token = (await token_response.json())["data"]["access_token"]
            response = await session.post(
                f"https://genos.mnc.ai:3443/api/admin/mcp/server/test/{server_id}/tools/call",
                headers={
                    "Authorization": f"Bearer {token}"
                },
                json={"tool_name": canonical, "input_schema": tool_input}
            )
            response.raise_for_status()
            data = (await response.json())['data']
            logger.info(
                f"MCP tool '{canonical}' called",
                extra={"tool_input": tool_input, "response_data": data}
            )
            normalized_name = canonical.replace("-", "_")
            if normalized_name == "comprehensive_web_search":
                if "query" in tool_input or (data and isinstance(data[0], dict)):
                    return data

                tool_state = getattr(states, "tool_state", None)
                if not isinstance(tool_state, ToolState):
                    tool_state = ToolState()
                    states.tool_state = tool_state

                iframe_index = len(tool_state.id_to_iframe)
                tool_state.id_to_iframe[f"{iframe_index}"] = data[0]
                raw_payload = tool_input.get('data_json')
                if isinstance(raw_payload, str):
                    data_json = json.loads(raw_payload)
                else:
                    data_json = raw_payload or {}
                title = data_json.get('title', 'Web_search')
                return (
                    f"search '{title}' has been successfully "
                    f"You can display it to the user by using the following ID: `【{iframe_index}†chart】`"
                )

        return data

    return call_mcp_tool


def __init__():
    print(get_tools_description("122"))
