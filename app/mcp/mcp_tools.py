import json
import os
import aiohttp
import requests

from app.utils import States, ToolState


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


def get_every_mcp_tools_description():
    tool_name_to_server_id = {}
    out = []
    mcp_server_id_list = [endpoint.strip() for endpoint in os.getenv("MCP_SERVER_ID", "").split(",") if endpoint.strip()]
    nested_list = [get_tools_description(endpoint) for endpoint in mcp_server_id_list]
    for server_id, data in zip(mcp_server_id_list, nested_list):
        for tool in data:
            tool_name_to_server_id[tool['name']] = server_id
        out.extend(data)
    # Normalize to OpenAI tools schema
    out = [
        {
            "type": "function",
            "function": {
                "name": tool.get("name"),
                "description": tool.get("description", ""),
                "parameters": tool.get("input_schema") or tool.get("parameters") or {"type": "object", "properties": {}},
            }
        }
        for tool in out
    ]
    return out, tool_name_to_server_id


MCP_TOOLS, MCP_TOOL_NAME_TO_SERVER_ID = get_every_mcp_tools_description()


def get_mcp_tool(tool_name: str):
    if tool_name not in MCP_TOOL_NAME_TO_SERVER_ID:
        raise ValueError(f"Tool {tool_name} not found")
    server_id = MCP_TOOL_NAME_TO_SERVER_ID[tool_name]

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
                json={"tool_name": tool_name, "input_schema": tool_input}
            )
            response.raise_for_status()
            data = (await response.json())['data']
            normalized_name = tool_name.replace("-", "_")
            if normalized_name == "web_search":
                if "search_query" in tool_input or (data and isinstance(data[0], dict)):
                    return data

                tool_state = getattr(states, "tool_state", None)
                if not isinstance(tool_state, ToolState):
                    tool_state = ToolState()
                    states.tool_state = tool_state

                iframe_index = len(tool_state.id_to_iframe)
                tool_state.id_to_iframe[f"{iframe_index}†chart"] = data[0]
                raw_payload = tool_input.get('data_json')
                if isinstance(raw_payload, str):
                    data_json = json.loads(raw_payload)
                else:
                    data_json = raw_payload or {}
                title = data_json.get('title', 'Generated chart')
                return (
                    f"Chart '{title}' has been successfully generated. "
                    f"You can display it to the user by using the following ID: `【{iframe_index}†chart】`"
                )

            return data

    return call_mcp_tool
