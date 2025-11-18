from .bio import bio, BIO
from .web_search import web_search, WEB_SEARCH
from .open_url import open, OPEN_URL
try:
    from app.mcp import MCP_TOOLS, get_mcp_tool_map, get_mcp_tools_schemas
except Exception:
    MCP_TOOLS = []

    async def get_mcp_tool_map():
        return {}

    def get_mcp_tools_schemas(tool_names):  # type: ignore
        return []


async def get_tool_map():
    mcp_map = await get_mcp_tool_map()
    return {
        "search": web_search,
        "open": open,
        "bio": bio,
        **mcp_map,
    }


async def get_tools_for_llm(selected_mcp_tools: list[str] | None = None):
    if selected_mcp_tools:
        mcp_tool_schemas = get_mcp_tools_schemas(selected_mcp_tools)
    else:
        mcp_tool_schemas = MCP_TOOLS

    return [
        WEB_SEARCH,
        OPEN_URL,
        BIO,
        *mcp_tool_schemas,
    ]
