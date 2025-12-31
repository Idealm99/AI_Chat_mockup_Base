#!/usr/bin/env python3
"""
MCP 도구 로딩 및 OpenAI 스키마 변환 검증 스크립트
"""
import asyncio
import json
import sys
import os
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))
os.chdir(project_root)

from app.mcp import MCP_TOOLS, get_mcp_tool_map, list_mcp_tool_names
from app.tools import get_tools_for_llm
from app.mcp_chat_agent import _sanitize_tool_schema


async def main():
    print("=" * 80)
    print("MCP 도구 로딩 및 OpenAI 스키마 변환 검증")
    print("=" * 80)
    print()
    
    # 1. 로드된 MCP 도구 개수 확인
    print(f"📊 로드된 MCP 도구 개수: {len(MCP_TOOLS)}")
    print()
    
    # 2. 도구 이름 목록 출력
    tool_names = list_mcp_tool_names()
    print(f"📝 도구 이름 목록 ({len(tool_names)}개):")
    for i, name in enumerate(tool_names[:10], 1):  # 처음 10개만
        print(f"   {i}. {name}")
    if len(tool_names) > 10:
        print(f"   ... 외 {len(tool_names) - 10}개")
    print()
    
    # 3. 원본 도구 스키마 샘플 확인 (처음 3개)
    print("🔍 원본 도구 스키마 샘플:")
    for i, tool in enumerate(MCP_TOOLS[:3], 1):
        print(f"\n   --- 도구 #{i}: {tool.get('function', {}).get('name')} ---")
        print(f"   Type: {tool.get('type')}")
        function = tool.get('function', {})
        print(f"   Name: {function.get('name')}")
        print(f"   Description: {function.get('description', '')[:100]}...")
        
        parameters = function.get('parameters', {})
        print(f"   Parameters type: {parameters.get('type')}")
        
        # oneOf/anyOf/allOf 검사
        has_oneof = 'oneOf' in parameters
        has_anyof = 'anyOf' in parameters
        has_allof = 'allOf' in parameters
        
        if has_oneof or has_anyof or has_allof:
            print(f"   ⚠️  스키마에 금지된 키워드 발견:")
            if has_oneof:
                print(f"      - oneOf: {len(parameters.get('oneOf', []))}개 옵션")
            if has_anyof:
                print(f"      - anyOf: {len(parameters.get('anyOf', []))}개 옵션")
            if has_allof:
                print(f"      - allOf: {len(parameters.get('allOf', []))}개 옵션")
        else:
            print(f"   ✅ 스키마가 깨끗합니다 (oneOf/anyOf/allOf 없음)")
        
        # properties 확인
        properties = parameters.get('properties', {})
        print(f"   Properties: {len(properties)}개 필드")
        if properties:
            print(f"      필드명: {list(properties.keys())[:5]}")
    
    print("\n" + "=" * 80)
    
    # 4. 정제(sanitize) 후 스키마 확인
    print("\n🔧 정제(sanitize) 후 도구 스키마:")
    for i, tool in enumerate(MCP_TOOLS[:3], 1):
        sanitized = _sanitize_tool_schema(tool)
        print(f"\n   --- 도구 #{i}: {sanitized.get('function', {}).get('name')} ---")
        
        function = sanitized.get('function', {})
        parameters = function.get('parameters', {})
        
        print(f"   Parameters type: {parameters.get('type')}")
        
        # oneOf/anyOf/allOf 검사
        has_oneof = 'oneOf' in parameters
        has_anyof = 'anyOf' in parameters
        has_allof = 'allOf' in parameters
        
        if has_oneof or has_anyof or has_allof:
            print(f"   ❌ 정제 실패: 여전히 금지된 키워드가 있습니다!")
            if has_oneof:
                print(f"      - oneOf")
            if has_anyof:
                print(f"      - anyOf")
            if has_allof:
                print(f"      - allOf")
        else:
            print(f"   ✅ 정제 성공: oneOf/anyOf/allOf 제거됨")
        
        properties = parameters.get('properties', {})
        print(f"   Properties: {len(properties)}개 필드")
        if properties:
            print(f"      필드명: {list(properties.keys())[:5]}")
    
    print("\n" + "=" * 80)
    
    # 5. get_tools_for_llm으로 가져온 도구 확인
    print("\n🎯 get_tools_for_llm() 결과 확인:")
    all_tools = await get_tools_for_llm()
    print(f"   전체 도구 개수: {len(all_tools)}")
    
    # 내장 도구 vs MCP 도구 구분
    builtin_tools = [t for t in all_tools if t.get('function', {}).get('name') in ['search', 'open', 'bio']]
    mcp_tools_from_llm = [t for t in all_tools if t.get('function', {}).get('name') not in ['search', 'open', 'bio']]
    
    print(f"   - 내장 도구: {len(builtin_tools)}개")
    print(f"   - MCP 도구: {len(mcp_tools_from_llm)}개")
    
    # 6. 도구 맵 확인
    print("\n🗺️  도구 맵(get_tool_map) 확인:")
    from app.tools import get_tool_map
    tool_map = await get_tool_map()
    print(f"   도구 맵 크기: {len(tool_map)}개")
    print(f"   도구 이름 샘플: {list(tool_map.keys())[:10]}")
    
    # 7. 특정 서버의 도구만 가져오기 테스트
    print("\n🎯 특정 MCP 서버의 도구만 가져오기 테스트:")
    test_servers = ["AlphaFold-MCP-Server", "PubChem-MCP-Server"]
    for server_name in test_servers:
        try:
            server_tools = await get_tools_for_llm(target_servers=[server_name])
            # 내장 도구 제외하고 카운트
            server_mcp_tools = [t for t in server_tools if t.get('function', {}).get('name') not in ['search', 'open', 'bio']]
            print(f"   - {server_name}: {len(server_mcp_tools)}개 도구")
            if server_mcp_tools:
                print(f"      도구명: {[t.get('function', {}).get('name') for t in server_mcp_tools[:3]]}")
        except Exception as e:
            print(f"   - {server_name}: 오류 발생 - {e}")
    
    print("\n" + "=" * 80)
    print("✅ 검증 완료!")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
