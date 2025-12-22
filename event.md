
# 📚 LangGraphSearchAgent Event Schema

`LangGraphSearchAgent`가 프론트엔드로 방출(emit)하는 4가지 주요 이벤트 타입에 대한 명세입니다.

-----

## 1\. Reasoning (추론 및 진행 상태)

에이전트의 사고 과정, 현재 단계, 워크플로우 진행 상황을 사용자에게 알리는 메시지입니다.

### 📋 Field Definition

| 필드명 | 타입 | 필수 | 설명 |
| :--- | :--- | :--- | :--- |
| **`stage`** | `string` | ✅ | 현재 워크플로우 단계 (예: `router`, `final`, `classify_mcp`) |
| **`message`** | `string` | ✅ | 사용자에게 표시할 안내 문구 |
| `results` | `list` | ❌ | 해당 단계에서 생성된 결과 키 목록 |
| `query` | `string` | ❌ | 현재 처리 중인 사용자 쿼리 |
| `pipeline` | `list` | ❌ | 전체 워크플로우 단계 리스트 (예: `['타겟발굴', '오믹스분석']`) |

### 💡 Payload Example

```json
{
  "stage": "router",
  "message": "질문을 바이오/신약개발 MCP 워크플로우 단계로 라우팅합니다.",
  "pipeline": ["Target Discovery", "Omics Analysis", "Structure Prediction"]
}
```

-----

## 2\. Tool Use (도구 실행)

MCP 서버의 도구(Tool)가 호출되거나 결과가 반환되었을 때 발생합니다. 실행 이력을 보여주는 데 사용됩니다.

### 📋 Field Definition

| 필드명 | 타입 | 필수 | 설명 |
| :--- | :--- | :--- | :--- |
| **`stage`** | `string` | ✅ | 도구가 실행된 워크플로우 단계 ID |
| **`stage_title`** | `string` | ✅ | 단계의 한글 명칭 (예: "구조 분석") |
| **`tool_label`** | `string` | ✅ | UI 표시용 도구 이름 (예: "PDB 구조 조회") |
| `tool_name` | `string` | ✅ | 실제 호출된 함수명 (예: `get_pdb_structure`) |
| `server_name` | `string` | ✅ | MCP 서버 식별자 |
| `input_args` | `dict` | ✅ | 도구 호출 인자 |
| `output_preview` | `string` | ✅ | 결과 요약 텍스트 (UI 미리보기용) |
| `output_result` | `any` | ❌ | 도구 실행 원본 데이터 |

### 💡 Payload Example

```json
{
  "stage": "structure_agent",
  "stage_title": "구조 분석",
  "tool_label": "PDB 구조 조회",
  "tool_name": "get_pdb_structure",
  "server_name": "PDB-MCP-Server",
  "input_args": { "pdb_id": "1ABC" },
  "output_preview": "KRAS G12D 구조 데이터 확보 완료",
  "timestamp": "2025-12-10T12:34:56Z"
}
```

-----

## 3\. UI Payload (시각화 및 패널 데이터)

최종 결과물로서 그래프, 3D 구조, 리포트 카드 등 **특수 UI 컴포넌트**를 렌더링하기 위한 데이터입니다.

### 📋 Field Definition

| 필드명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `structure_panel` | `dict` | **[중요]** 단백질 구조 뷰어(Mol\*) 및 상세 정보 데이터 |
| `knowledge_graph` | `dict` | 지식 그래프 노드/엣지 데이터 |
| `visualization` | `dict` | 기타 차트/3D 뷰어용 범용 데이터 |
| `report_cards` | `list` | 요약 정보 카드 리스트 |

### 💡 Payload Example (Structure Panel)

```json
{
  "structure_panel": {
    "target": "KRAS",
    "compound": "AMG-510",
    "pdbId": "6oim",
    "pdbUrl": "https://files.rcsb.org/download/6oim.pdb",
    "summary": "KRAS G12C 돌연변이와 억제제의 결합 구조입니다."
  }
}
```

-----

## 4\. Token (스트리밍 응답)

LLM이 생성하는 텍스트를 실시간으로 전송합니다.

### 💡 Format

```python
# (이벤트 타입, 토큰 문자열)
("token", "KRAS 단백질은 세포 신호 전달에...")
```

-----

## 5\. Error (예외 처리)

워크플로우 중단 또는 심각한 오류 발생 시 사용됩니다.

### 💡 Payload Example

```json
{
  "type": "error",
  "message": "Weaviate DB 연결 실패",
  "traceback": "Traceback (most recent call last): ..."
}
```

-----

### 📝 개발 참고 사항 (Next Step)

프론트엔드(TypeScript)에서 사용하기 쉽도록 인터페이스(Interface) 정의가 필요하다면 아래 코드를 바로 사용하실 수 있습니다.

```typescript
// types/agent-events.ts

export type AgentEventType = 'reasoning' | 'tool_use' | 'ui_payload' | 'token' | 'error';

export interface ReasoningEvent {
  stage: string;
  message: string;
  pipeline?: string[];
  // ... others
}

export interface ToolUseEvent {
  stage: string;
  tool_label: string;
  input_args: Record<string, any>;
  output_preview: string;
  // ... others
}

export interface UiPayloadEvent {
  structure_panel?: {
    pdbUrl: string;
    pdbId: string;
    target: string;
    // ...
  };
  // ... others
}
```