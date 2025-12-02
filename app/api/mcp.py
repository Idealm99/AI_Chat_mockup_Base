from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter

from app.mcp.mcp_adapter_client import MCPAdapterClient

router = APIRouter()


@router.get("/mcp/status")
async def get_mcp_status() -> Dict[str, Any]:
    """Return the availability status for each configured MCP server."""

    client = MCPAdapterClient()
    server_names = client.available_servers()
    statuses: List[Dict[str, Any]] = []

    for server_name in server_names:
        status = "inactive"
        message = ""
        tool_count = 0
        try:
            resolved_tools = await client.get_stage_tools([server_name])
            tool_count = sum(1 for tool in resolved_tools if tool.server_name == server_name)
            if tool_count > 0:
                status = "active"
            else:
                status = "idle"
                message = "No tools resolved from server."
        except Exception as exc:  # pragma: no cover - network/process errors
            status = "error"
            message = str(exc)

        statuses.append(
            {
                "name": server_name,
                "status": status,
                "is_active": status == "active",
                "tool_count": tool_count,
                "message": message,
            }
        )

    return {"servers": statuses}
