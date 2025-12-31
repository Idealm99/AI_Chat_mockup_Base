#!/usr/bin/env python3
"""Check for problematic schemas in MCP tools"""

from app.mcp import MCP_TOOLS
from app.mcp_chat_agent import _sanitize_tool_schema


def check_schema_recursive(schema, path=''):
    """재귀적으로 스키마를 검사하여 금지된 키워드를 찾음"""
    issues = []
    if not isinstance(schema, dict):
        return issues
    
    for key in ['oneOf', 'anyOf', 'allOf']:
        if key in schema:
            issues.append(f'{path}.{key}' if path else key)
    
    # properties 내부도 검사
    if 'properties' in schema and isinstance(schema['properties'], dict):
        for prop_name, prop_schema in schema['properties'].items():
            prop_path = f'{path}.properties.{prop_name}' if path else f'properties.{prop_name}'
            issues.extend(check_schema_recursive(prop_schema, prop_path))
    
    # items도 검사 (배열의 경우)
    if 'items' in schema and isinstance(schema['items'], dict):
        items_path = f'{path}.items' if path else 'items'
        issues.extend(check_schema_recursive(schema['items'], items_path))
    
    return issues


print('=' * 80)
print('금지된 키워드(oneOf/anyOf/allOf) 검사')
print('=' * 80)
print()

problematic_tools = []
for tool in MCP_TOOLS:
    func = tool.get('function', {})
    params = func.get('parameters', {})
    name = func.get('name', 'unknown')
    
    issues = check_schema_recursive(params)
    if issues:
        problematic_tools.append((name, issues))

print(f'문제가 있는 도구: {len(problematic_tools)}개 / {len(MCP_TOOLS)}개')
print()

if problematic_tools:
    print('문제가 있는 도구 목록 (처음 10개):')
    for i, (name, issues) in enumerate(problematic_tools[:10], 1):
        print(f'  {i}. {name}')
        for issue in issues[:3]:
            print(f'     - {issue}')
        if len(issues) > 3:
            print(f'     ... 외 {len(issues) - 3}개 이슈')
    if len(problematic_tools) > 10:
        print(f'  ... 외 {len(problematic_tools) - 10}개 도구')
    print()
    
    # 정제 후 재검사
    print('정제(sanitize) 후 재검사:')
    still_problematic = []
    for name, _ in problematic_tools[:10]:
        # 해당 도구 찾기
        tool = next((t for t in MCP_TOOLS if t.get('function', {}).get('name') == name), None)
        if tool:
            sanitized = _sanitize_tool_schema(tool)
            func = sanitized.get('function', {})
            params = func.get('parameters', {})
            issues = check_schema_recursive(params)
            if issues:
                still_problematic.append((name, issues))
    
    if still_problematic:
        print(f'  ❌ 여전히 문제가 있는 도구: {len(still_problematic)}개')
        for name, issues in still_problematic[:5]:
            print(f'    - {name}: {issues[:2]}')
    else:
        print(f'  ✅ 모든 도구가 정제됨')
else:
    print('✅ 모든 도구의 스키마가 깨끗합니다!')

print()
print('=' * 80)
