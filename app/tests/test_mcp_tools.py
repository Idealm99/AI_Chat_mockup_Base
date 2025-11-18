import asyncio
import pytest
from app.mcp.mcp_tools import get_mcp_tool, resolve_mcp_tool_name, list_mcp_tool_names
from app.utils import States

@pytest.mark.asyncio
async def test_mcp_web_search_basic():
    # 환경변수에 MCP_SERVER_ID, GENOS_ID, GENOS_PW 등이 올바르게 설정되어 있어야 함
    tool_name = resolve_mcp_tool_name(
        preferred_aliases=["search-web", "search_web", "web_search"],
        contains_keywords=["search"],
    )
    if tool_name is None:
        pytest.skip(f"검색 MCP 툴이 없습니다. 현재 로드된 툴: {list_mcp_tool_names()}")
    mcp_web_search = get_mcp_tool(tool_name)
    states = States()
    # 검색어 예시
    result = await mcp_web_search(states, q="테스트 검색어", recency=None, domains=None)
    assert result is not None
    assert isinstance(result, list) or isinstance(result, dict)
    print(f"MCP web_search result (tool={tool_name}):", result)

@pytest.mark.asyncio
async def test_mcp_tool_not_found():
    with pytest.raises(ValueError):
        get_mcp_tool("nonexistent_tool")
