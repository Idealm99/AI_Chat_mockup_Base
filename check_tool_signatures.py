#!/usr/bin/env python3
"""Check tool function signatures"""

import asyncio
import inspect
from app.mcp import MCP_TOOLS
from app.tools import get_tool_map


async def main():
    print('=' * 80)
    print('도구 함수 시그니처 검사')
    print('=' * 80)
    print()
    
    tool_map = await get_tool_map()
    
    print(f'도구 맵 크기: {len(tool_map)}개')
    print()
    
    # 몇 개 샘플 도구의 시그니처 확인
    sample_tools = list(tool_map.keys())[:10]
    
    print('샘플 도구 함수 시그니처:')
    for i, tool_name in enumerate(sample_tools, 1):
        tool_fn = tool_map[tool_name]
        
        # 함수 시그니처 확인
        sig = inspect.signature(tool_fn)
        params = list(sig.parameters.keys())
        
        # async 여부 확인
        is_async = inspect.iscoroutinefunction(tool_fn)
        
        print(f'  {i}. {tool_name}')
        print(f'     Parameters: {params}')
        print(f'     Is async: {is_async}')
        print(f'     Signature: {sig}')
    
    print()
    
    # get_mcp_tool로 생성된 함수 확인
    from app.mcp import get_mcp_tool
    from app.utils import States
    
    mcp_tool_names = [name for name in tool_map.keys() if name not in ['search', 'open', 'bio']]
    if mcp_tool_names:
        print('MCP 도구 함수 상세 검사 (첫 3개):')
        for tool_name in mcp_tool_names[:3]:
            tool_fn = get_mcp_tool(tool_name)
            sig = inspect.signature(tool_fn)
            
            print(f'\n  도구: {tool_name}')
            print(f'  시그니처: {sig}')
            print(f'  파라미터:')
            for param_name, param in sig.parameters.items():
                print(f'    - {param_name}: {param.kind.name}')
                if param.kind == inspect.Parameter.VAR_KEYWORD:
                    print(f'      (가변 키워드 인자: **{param_name})')
    
    print()
    print('=' * 80)


if __name__ == '__main__':
    asyncio.run(main())
