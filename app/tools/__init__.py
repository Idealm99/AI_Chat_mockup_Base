from .bio import bio, BIO
from .web_search import web_search, WEB_SEARCH
from .open_url import open, OPEN_URL
try:
    from app.mcp import MCP_TOOLS, get_mcp_tool_map, get_mcp_tools_schemas
except Exception:
    MCP_TOOLS = []

    async def get_mcp_tool_map():
        return {}

    def get_mcp_tools_schemas(tool_names, filter_by_server=False):  # type: ignore
        return []


async def get_tool_map():
    mcp_map = await get_mcp_tool_map()
    return {
        "search": web_search,
        "open": open,
        "bio": bio,
        **mcp_map,
    }


async def get_tools_for_llm(selected_mcp_tools: list[str] | None = None, target_servers: list[str] | None = None):
    """
    Get tools for LLM.
    
    Args:
        selected_mcp_tools: Specific MCP tool names to load
        target_servers: MCP server names to load tools from
    """
    if target_servers:
        # target_servers에서 지정된 MCP 서버들의 도구만 로드
        mcp_tool_schemas = get_mcp_tools_schemas(target_servers, filter_by_server=True)
    elif selected_mcp_tools:
        # 기존 동작: 특정 도구 이름들만 로드
        mcp_tool_schemas = get_mcp_tools_schemas(selected_mcp_tools)
    else:
        # 모든 도구 로드
        mcp_tool_schemas = MCP_TOOLS

    # MCP 도구만 반환 (search, open, bio 제외)
    return [
        *mcp_tool_schemas,
    ]
