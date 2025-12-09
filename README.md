# Mocking Flowise

프론트엔드와 백엔드를 포함한 전체 스택 애플리케이션입니다.

## 주요 기능

### LangChain 멀티턴 대화
- **멀티턴 대화**: 최대 10개 메시지 윈도우로 대화 맥락 유지
- **Tool Binding**: LangChain 기반의 자동 tool 바인딩
- **SQLite 메모리**: 대화 히스토리를 SQLite에 영구 저장
- **Agent 지원**: LangChain Agent로 자동 tool 호출 및 실행

### API 엔드포인트

#### 기존 엔드포인트
- `POST /api/chat/stream` - 기존 OpenAI 스트리밍 (호환성 유지)

#### 새로운 LangChain 멀티턴 엔드포인트
- `POST /api/chat/multiturn` - LangChain Agent 기반 멀티턴 대화
  ```json
  {
    "question": "질문 내용",
    "chatId": "채팅 ID (선택)",
    "userInfo": {"id": "사용자 ID"}
  }
  ```

#### 히스토리 관리
- `GET /api/chat/history/{chat_id}` - 특정 채팅의 히스토리 조회 (최대 10개)
- `DELETE /api/chat/history/{chat_id}` - 채팅 히스토리 삭제

## Docker Compose로 실행하기

### 사전 요구사항

- Docker
- Docker Compose

### 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성하고 필요한 환경 변수를 설정하세요:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o
TAVILY_API_KEY=your_tavily_api_key

# MCP 통합 설정
MCP_MODE=genos              # genos | local | off
MCP_SERVER_ID=122,123,124    # MCP_MODE=genos 일 때 필수
GENOS_ID=your-admin-id       # GenOS 관리자 계정
GENOS_PW=your-admin-password # GenOS 관리자 비밀번호
MCP_LOCAL_SERVER_CONFIG=./config/mcp_servers.local.json
MCP_LOCAL_DEFAULT_CWD=../jw_mcp
```

**환경 변수 설명:**
- `OPENAI_API_KEY`: OpenAI API 키 (필수)
- `OPENAI_MODEL`: 사용할 OpenAI 모델 (선택, 기본값: gpt-4o)
- `TAVILY_API_KEY`: 검색 도구 (필수)
- `MCP_MODE`: MCP 서버 연결 방식. `genos`(기본) / `local`(직접 연결) / `off`(완전 비활성화)
- `MCP_SERVER_ID`: GenOS 콘솔에 등록된 MCP 서버 ID 목록(쉼표 구분)
- `GENOS_ID`, `GENOS_PW`: GenOS 관리자 인증 정보
- `MCP_LOCAL_SERVER_CONFIG`: 로컬 모드에서 사용할 JSON 설정 경로
- `MCP_LOCAL_DEFAULT_CWD`: 로컬 MCP 서버 공통 작업 디렉터리(상대 경로 가능)

### 실행 방법

1. **모든 서비스 실행 (프론트엔드 + 백엔드 + Redis)**
   ```bash
   docker-compose up -d
   ```

2. **로그 확인**
   ```bash
   docker-compose logs -f
   ```

3. **특정 서비스 로그만 확인**
   ```bash
   docker-compose logs -f api
   docker-compose logs -f frontend
   ```

4. **서비스 중지**
   ```bash
   docker-compose down
   ```

5. **서비스 중지 및 볼륨 삭제**
   ```bash
   docker-compose down -v
   ```

6. **이미지 재빌드 후 실행**
   ```bash
   docker-compose up -d --build
   ```

### 접속 정보

- **프론트엔드**: http://localhost:8080
- **백엔드 API**: http://localhost:6666
- **API 문서**: http://localhost:6666/docs

### 서비스 구성

- **frontend**: React + Vite + Nginx (포트 8080)
- **api**: FastAPI + LangChain + LangGraph(포트 6666)
- **redis**: Redis 서버 (세션 저장용)

### 저장 위치

- **채팅 히스토리**: `chat_history.db` (SQLite)
- **Redis 데이터**: Docker 볼륨 `redis-data`

## 개발 모드

개발 중에는 Docker Compose 대신 각각 실행할 수 있습니다:

**백엔드 (LangChain 멀티턴 지원):**
```bash
cd AI_Chat_mockup_Base
pip install -r requirements.txt
python -m app.main
# 또는
uvicorn app.main:app --host 0.0.0.0 --port 6666 --reload
```

**프론트엔드:**
```bash
cd web-gpt-mate
npm install
npm run dev
```

## 멀티턴 대화 사용 예시

```python
import aiohttp
import asyncio

async def test_multiturn():
    chat_id = "test-chat-123"
    
    # 첫 번째 턴
    async with aiohttp.ClientSession() as session:
        data = {
            "question": "안녕하세요. 당신의 이름은?",
            "chatId": chat_id,
            "userInfo": {"id": "user-1"}
        }
        
        async with session.post("http://localhost:6666/api/chat/multiturn", json=data) as resp:
            async for line in resp.content:
                print(line.decode('utf-8'))
    
    # 두 번째 턴 (같은 chat_id로 멀티턴 유지)
    async with aiohttp.ClientSession() as session:
        data = {
            "question": "그럼 당신은 무엇을 할 수 있나요?",
            "chatId": chat_id,
            "userInfo": {"id": "user-1"}
        }
        
        async with session.post("http://localhost:6666/api/chat/multiturn", json=data) as resp:
            async for line in resp.content:
                print(line.decode('utf-8'))

asyncio.run(test_multiturn())
```

## 아키텍처

```
┌─────────────────────┐
│   Frontend (React)  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  FastAPI Backend    │
├─────────────────────┤
│ - Chat API (SSE)    │
│ - Multiturn API     │
│ - History API       │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌────────┐  ┌──────────┐
│ Redis  │  │  SQLite  │
│ (Cache)│  │(History) │
└────────┘  └──────────┘
           │
           ▼
    ┌─────────────┐
    │ LangChain   │
    │ + OpenAI    │
    │ + Tools     │
    └─────────────┘
```

## LangChain Tool 목록

- **search_web**: 웹 검색 기능
- **open_url**: URL 열기 및 내용 추출
- **manage_memory**: 사용자 메모리 관리 (bio tool)

## 바이오/신약 MCP 워크플로우

백엔드는 LangGraph 기반의 다단계 파이프라인을 통해 `/jw_mcp` 디렉터리에 있는 MCP 서버들을 순차적으로 호출합니다. 사용자 질문(예: "위암에 대한 신약 후보")은 아래 순서로 전달되며, 각 단계의 결과가 최종 답변에 반영됩니다.

| 단계 | 역할 | 연결된 MCP 서버 |
| --- | --- | --- |
| 1. TargetAgent | 질병 연관 타겟 유전자 선별 | OpenTargets-MCP-Server |
| 2. OmicsAgent | 주요 유전자 변이/발현 패턴 분석 | ChEMBL-MCP-Server |
| 3. PathwayAgent | 신호 전달 경로 및 기능 탐색 | KEGG-MCP-Server, Reactome-MCP-Server, GeneOntology-MCP-Server |
| 4. ChemAgent | 경로에 작용하는 화합물 탐색 | ChEMBL-MCP-Server |
| 5. StructureAgent | 3D 구조·결합 포켓 분석 | AlphaFold-MCP-Server, PDB-MCP-Server |
| 6. ClinicalAgent | 임상시험/규제 정보 확인 | ClinicalTrials-MCP-Server, OpenFDA-MCP-Server |

> **Agentic MCP 실행**: 각 단계는 MCP 서버에 등록된 도구 전체를 한 번에 실행하지 않고, LangGraph 내 LLM 에이전트가 노출된 도구 목록을 읽고 필요한 도구만 순차적으로 호출합니다. 도구 실행 결과를 근거로 다음 행동(추가 호출/단계 종료)을 판단하여, 최소한의 호출로 목표를 달성하도록 설계되었습니다.

### JW MCP 서버 연결 방법

모든 MCP 서버는 공통적으로 의존성 설치 → 빌드 → 실행 과정을 거쳐야 합니다.

```bash
cd jw_mcp/AlphaFold-MCP-Server
npm install
npm run build
npm start   # 또는 node build/index.js
```

동일한 방법으로 PDB, ChEMBL, PubChem 등 필요한 모든 서버를 기동하세요. 이후 **GenOS 모드** 또는 **로컬 모드** 가운데 원하는 방식을 선택해 백엔드와 연결할 수 있습니다.

#### GenOS 모드 (기본값)

1. 각 MCP 서버를 GenOS 관리자 콘솔에 등록하고 발급받은 `server_id`를 `.env`의 `MCP_SERVER_ID`에 쉼표로 입력합니다. (예: `MCP_SERVER_ID=122,123,124`)
2. `GENOS_ID`, `GENOS_PW`를 관리자 계정 정보로 채웁니다.
3. `MCP_MODE=genos` 로 두고 백엔드를 재시작하면 MCP 메타데이터가 자동 로드됩니다.

#### 로컬 모드 (STDIO/SSE 직접 연결)

1. `.env`에 `MCP_MODE=local`을 설정합니다.
2. `config/mcp_servers.local.json` 파일에 각 서버의 transport 정보를 작성합니다. (아래 예시 참고)
3. 필요하다면 `MCP_LOCAL_DEFAULT_CWD=../jw_mcp`를 설정해 공통 루트 경로를 지정합니다.
4. 백엔드를 재시작하면 설정 파일에 정의된 transport(stdio, sse, websocket, streamable_http)가 그대로 사용됩니다.

예시 `config/mcp_servers.local.json`:

```json
{
   "defaults": {
      "cwd": "../jw_mcp",
      "transport": "stdio",
      "args": ["build/index.js"],
      "env": {
         "NODE_ENV": "production"
      }
   },
   "servers": [
      {
         "name": "AlphaFold-MCP-Server",
         "command": "node"
      },
      {
         "name": "PDB-MCP-Server",
         "cwd": "../jw_mcp/PDB-MCP-Server",
         "command": "node",
         "args": ["build/index.js"]
      },
      {
         "name": "ClinicalTrials-MCP-Server",
         "transport": "sse",
         "url": "http://127.0.0.1:4010/sse",
         "headers": {
            "Authorization": "Bearer local-dev"
         }
      }
   ]
}
```

`tool_allowlist`/`tool_blocklist` 등의 필드를 추가하면 서버에서 노출할 MCP 툴을 세밀하게 제어할 수 있습니다. 로컬 모드에서 MCP를 사용하지 않을 때는 `MCP_MODE=off`로 설정하면 백엔드가 MCP 단계 없이도 기동됩니다.

#### Docker로 MCP 서버 일괄 실행하기

`app/mcp` 아래 모든 서버를 한 번에 기동하려면 새로 추가된 `docker-compose.mcp.yml`을 사용하면 됩니다.

```bash
docker compose -f docker-compose.mcp.yml up -d        # 백그라운드 실행
docker compose -f docker-compose.mcp.yml logs -f      # 로그 확인
docker compose -f docker-compose.mcp.yml down         # 전체 종료
```

각 서비스는 `node:20` 이미지를 기반으로 `npm install && npm run build && npm run start`를 자동 수행합니다. 소스를 수정하면 `docker compose ... up -d --build` 로 다시 올리면 되고, `MCP_MODE=local` + `MCP_LOCAL_SERVER_CONFIG` 에 정의된 경로와 동일하게 맞춰져 있으므로 추가 설정 없이 바로 사용할 수 있습니다.
