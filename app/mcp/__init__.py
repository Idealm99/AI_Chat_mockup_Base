from .mcp_tools import (
    MCP_TOOLS,
    get_mcp_tool,
    get_mcp_tool_metadata,
    get_mcp_tool_serving_id,
    get_mcp_tool_schema,
    get_mcp_tools_schemas,
    list_mcp_tool_names,
    resolve_mcp_tool_name,
)


async def get_mcp_tool_map():
    return {
        tool['function']['name']: get_mcp_tool(tool['function']['name'])
        for tool in MCP_TOOLS
    }


__all__ = [
    "MCP_TOOLS",
    "get_mcp_tool",
    "get_mcp_tool_metadata",
    "get_mcp_tool_serving_id",
    "get_mcp_tool_schema",
    "get_mcp_tools_schemas",
    "list_mcp_tool_names",
    "resolve_mcp_tool_name",
    "get_mcp_tool_map",
]
