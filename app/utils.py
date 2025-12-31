import os
import pathlib
import json
from typing import Any
from pydantic import BaseModel, Field
from openai import AsyncOpenAI
import aiohttp
import requests
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage

from app.logger import get_logger

log = get_logger(__name__)

ROOT_DIR = pathlib.Path(__file__).parent.absolute()


class ToolState(BaseModel):
    id_to_url: dict[str, str] = Field(default_factory=dict)
    url_to_page: dict[str, object] = Field(default_factory=dict)
    current_url: str | None = None
    tool_results: dict[str, object] = Field(default_factory=dict)
    id_to_iframe: dict[str, str] = Field(default_factory=dict)


class States:
    user_id: str = None
    messages: list[dict]
    turn: int = 0
    tools: list[dict] = []
    tool_state: ToolState = ToolState()
    tool_results: dict[str, object] = {}


def _get_genos_token() -> str:
    """GenOS 인증 토큰을 동기적으로 가져옵니다 (초기화용)"""
    import requests
    base_url = os.getenv("GENOS_URL", "https://genos.genon.ai:3443").rstrip("/")
    response = requests.post(
        f"{base_url}/api/admin/auth/login",
        json={
            "user_id": os.getenv("GENOS_ID"),
            "password": os.getenv("GENOS_PW")
        }
    )
    response.raise_for_status()
    return response.json()["data"]["access_token"]


async def _get_genos_token_async() -> str:
    """GenOS 인증 토큰을 비동기적으로 가져옵니다"""
    base_url = os.getenv("GENOS_URL", "https://genos.genon.ai:3443").rstrip("/")
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{base_url}/api/admin/auth/login",
            json={
                "user_id": os.getenv("GENOS_ID"),
                "password": os.getenv("GENOS_PW")
            }
        ) as response:
            response.raise_for_status()
            data = await response.json()
            return data["data"]["access_token"]


def _get_openrouter_base_url() -> str:
    return os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")


def _get_openai_client() -> AsyncOpenAI:
    """OpenAI 클라이언트 반환 (GenOS 미사용 시)"""
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY 환경 변수가 설정되지 않았습니다.")
    return AsyncOpenAI(api_key=api_key, base_url=_get_openrouter_base_url())


def _get_default_model() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-4o")


def _use_genos_llm() -> bool:
    """GenOS LLM 서빙을 사용할지 결정"""
    serving_id = os.getenv("GENOS_LLM_SERVING_ID")
    # 환경변수가 설정되어 있고, 빈 문자열이 아니어야 함
    use_genos = serving_id is not None and serving_id.strip() != ""
    if use_genos:
        log.info(f"GenOS LLM 서빙 사용: serving_id={serving_id}")
    else:
        log.info("OpenAI 직접 호출 사용 (GENOS_LLM_SERVING_ID가 설정되지 않음)")
    return use_genos


def _get_genos_llm_serving_id() -> int:
    """GenOS LLM 서빙 ID 반환"""
    return int(os.getenv("GENOS_LLM_SERVING_ID", "0"))


def _get_configured_genos_token() -> tuple[str, str | None]:
    """환경변수에서 설정된 GenOS 토큰과 그 출처를 반환"""
    for env_name in ("GENOS_BEARER_TOKEN", "GENOS_LLM_TOKEN"):
        token = os.getenv(env_name)
        if token and token.strip():
            return token.strip(), env_name
    return "", None


def _get_genos_bearer_token() -> str:
    """GenOS Bearer 토큰 반환 (환경변수 또는 동적 획득) - 동기 버전"""
    token, source = _get_configured_genos_token()
    if token:
        if source != "GENOS_BEARER_TOKEN":
            log.info("환경변수 %s 사용 (GENOS_BEARER_TOKEN 미설정)", source)
        return token
    # 환경변수가 없으면 동적으로 획득 (동기 호출)
    try:
        fetched_token = _get_genos_token()
        log.info("GenOS Bearer 토큰을 동적으로 획득했습니다.")
        return fetched_token
    except Exception as e:
        log.warning(f"GenOS 토큰 획득 실패: {e}")
        return ""


async def call_llm_stream(
    messages: list[dict | BaseMessage],
    model: str | None = None,
    tools: list[dict] | None = None,
    temperature: float | None = None,
    **kwargs
):
    """
    OpenAI API를 통해 LLM 스트리밍 호출
    """
    if _use_genos_llm():
        async for res in _call_genos_llm_stream(
            messages=messages,
            model=model,
            tools=tools,
            temperature=temperature,
            **kwargs
        ):
            yield res
        return

    client = _get_openai_client()
    model = model or _get_default_model()
    
    # OpenAI API 형식에 맞게 메시지 준비
    api_messages = []
    for msg in messages:
        if isinstance(msg, BaseMessage):
            if isinstance(msg, HumanMessage):
                api_messages.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                api_msg = {"role": "assistant", "content": msg.content}
                if msg.tool_calls:
                    api_msg["tool_calls"] = msg.tool_calls
                api_messages.append(api_msg)
            elif isinstance(msg, SystemMessage):
                api_messages.append({"role": "system", "content": msg.content})
            elif isinstance(msg, ToolMessage):
                api_messages.append({
                    "role": "tool",
                    "content": msg.content,
                    "tool_call_id": msg.tool_call_id
                })
            else:
                api_messages.append({"role": msg.type, "content": msg.content})
        elif isinstance(msg, dict):
            role = msg.get("role")
            if role == "tool":
                # tool 메시지는 tool_call_id가 필요
                api_msg = {
                    "role": "tool",
                    "content": msg.get("content", ""),
                    "tool_call_id": msg.get("tool_call_id", ""),
                }
            else:
                api_msg = {
                    "role": role,
                    "content": msg.get("content", ""),
                }
                if "tool_calls" in msg:
                    api_msg["tool_calls"] = msg["tool_calls"]
            api_messages.append(api_msg)
    
    # OpenAI API 호출 파라미터
    stream_params: dict[str, Any] = {
        "model": model,
        "messages": api_messages,
        "stream": True,
    }
    
    if tools:
        stream_params["tools"] = tools
        stream_params["tool_choice"] = "auto"
    
    if temperature is not None:
        stream_params["temperature"] = temperature

    full_content_parts: list[str] = []
    tool_call_buf: dict[int, dict] = {}
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    total_cost = 0.0  # OpenAI 직접 호출 시 비용 정보는 제공되지 않아 0으로 유지
    
    try:
        stream = await client.chat.completions.create(**stream_params)
        
        async for chunk in stream:
            if not chunk.choices:
                continue
                
            choice = chunk.choices[0]
            delta = choice.delta
            
            if not delta:
                continue
            
            # tool calls 처리
            if delta.tool_calls:
                for tool_call in delta.tool_calls:
                    if tool_call.index is not None:
                        idx = tool_call.index
                        if idx not in tool_call_buf:
                            tool_call_buf[idx] = {
                                "id": tool_call.id or "",
                                "type": "function",
                                "function": {
                                    "name": "",
                                    "arguments": "",
                                },
                            }
                        buf = tool_call_buf[idx]
                        
                        if tool_call.id:
                            buf["id"] = tool_call.id
                        
                        if tool_call.function:
                            if tool_call.function.name:
                                buf["function"]["name"] = tool_call.function.name
                            if tool_call.function.arguments:
                                buf["function"]["arguments"] += tool_call.function.arguments
            
            # content tokens 처리
            # tool_calls가 있는 경우에도 content가 올 수 있음 (예: o1 모델)
            if delta.content:
                content_piece = delta.content
                if content_piece:
                    full_content_parts.append(content_piece)
                    # tool_calls가 있으면 토큰을 yield하지 않고 버퍼에만 저장
                    # tool_calls가 없으면 토큰을 즉시 yield
                    if not delta.tool_calls:
                        yield {
                            "event": "token",
                            "data": content_piece,
                        }

            # usage 정보 갱신 (스트림 마지막 chunk에 포함됨)
            chunk_usage = getattr(chunk, "usage", None)
            if chunk_usage:
                if hasattr(chunk_usage, "model_dump"):
                    usage_dict = chunk_usage.model_dump()
                elif isinstance(chunk_usage, dict):
                    usage_dict = chunk_usage
                else:
                    usage_dict = {
                        "prompt_tokens": getattr(chunk_usage, "prompt_tokens", None),
                        "completion_tokens": getattr(chunk_usage, "completion_tokens", None),
                        "total_tokens": getattr(chunk_usage, "total_tokens", None),
                    }
                if isinstance(usage_dict, dict):
                    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
                        value = usage_dict.get(key)
                        if isinstance(value, int):
                            total_usage[key] = value

        # 최종 메시지 생성

        final_message: dict[str, Any] = {"role": "assistant"}
        final_content = "".join(full_content_parts).strip()
        final_message["content"] = final_content if final_content else ""
        
        # tool_calls가 있으면 추가
        if tool_call_buf:
            tool_calls = []
            for idx in sorted(tool_call_buf.keys()):
                tc = tool_call_buf[idx]
                # arguments가 JSON 문자열인지 확인
                try:
                    # 이미 JSON 문자열이면 그대로 사용
                    json.loads(tc["function"]["arguments"])
                    args_str = tc["function"]["arguments"]
                except (json.JSONDecodeError, TypeError):
                    # JSON이 아니면 빈 객체로 처리
                    args_str = "{}"
                
                tool_calls.append({
                    "id": tc["id"],
                    "type": tc["type"],
                    "function": {
                        "name": tc["function"]["name"],
                        "arguments": args_str,
                    },
                })
            final_message["tool_calls"] = tool_calls

        final_message["usage"] = total_usage
        final_message["cost"] = total_cost
        
        yield final_message
        
    except Exception as e:
        log.exception("OpenAI API 호출 실패")
        raise


async def _call_genos_llm_stream(
    messages: list[dict],
    model: str | None = None,
    tools: list[dict] | None = None,
    temperature: float | None = None,
    **kwargs
):
    """
    GenOS API를 통해 LLM 스트리밍 호출
    GenOS Gateway를 통해 OpenRouter 모델에 접근합니다.
    """
    serving_id = _get_genos_llm_serving_id()
    genos_url = os.getenv("GENOS_URL", "https://genos.genon.ai:3443").rstrip("/")
    
    if serving_id == 0:
        raise RuntimeError("GENOS_LLM_SERVING_ID가 설정되지 않았거나 유효하지 않습니다.")
    
    log.info(f"GenOS LLM 호출: serving_id={serving_id}, genos_url={genos_url}, model={model}")
    
    # Bearer 토큰 획득
    # 1. 환경변수에서 직접 설정된 토큰 사용 (serving별 토큰)
    bearer_token, source = _get_configured_genos_token()
    
    # 2. 환경변수가 없으면 admin 토큰 획득
    if not bearer_token:
        log.info("GENOS_BEARER_TOKEN/GENOS_LLM_TOKEN 미설정으로 admin 토큰을 획득합니다.")
        bearer_token = await _get_genos_token_async()
        log.info(f"Admin 토큰 획득 완료 (길이: {len(bearer_token)})")
    else:
        log.info(
            "환경변수 %s 에서 인증 키 사용 (길이: %d, 처음 10자: %s...)",
            source,
            len(bearer_token),
            bearer_token[:10],
        )
    
    if not bearer_token:
        raise RuntimeError("GenOS Bearer 토큰을 획득할 수 없습니다. GENOS_ID와 GENOS_PW를 확인하세요.")
    
    log.info(f"GenOS Bearer 토큰 획득 완료 (길이: {len(bearer_token)})")
    
    # GenOS Gateway API 엔드포인트
    endpoint = f"{genos_url}/api/gateway/rep/serving/{serving_id}/v1/chat/completions"
    
    # 헤더 설정 (임베딩 서빙과 동일한 형식 사용)
    headers = {
        "Authorization": f"Bearer {bearer_token}",
        "Content-Type": "application/json"
    }
    
    log.info(f"GenOS Gateway API 호출 준비: endpoint={endpoint}, token_length={len(bearer_token)}")
    
    # OpenAI 호환 형식으로 메시지 준비
    api_messages = []
    for msg in messages:
        if isinstance(msg, dict):
            role = msg.get("role")
            if role == "tool":
                api_msg = {
                    "role": "tool",
                    "content": msg.get("content", ""),
                    "tool_call_id": msg.get("tool_call_id", ""),
                }
            else:
                api_msg = {
                    "role": role,
                    "content": msg.get("content", ""),
                }
            api_messages.append(api_msg)
        elif isinstance(msg, BaseMessage):
            if isinstance(msg, HumanMessage):
                api_messages.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                api_msg = {"role": "assistant", "content": msg.content}
                if msg.tool_calls:
                    api_msg["tool_calls"] = msg.tool_calls
                api_messages.append(api_msg)
            elif isinstance(msg, SystemMessage):
                api_messages.append({"role": "system", "content": msg.content})
            elif isinstance(msg, ToolMessage):
                api_messages.append({
                    "role": "tool",
                    "content": msg.content,
                    "tool_call_id": msg.tool_call_id
                })
            else:
                api_messages.append({"role": msg.type, "content": msg.content})
    
    # 요청 파라미터 구성
    request_data: dict[str, Any] = {
        "model": model or _get_default_model(),
        "messages": api_messages,
        "stream": True,
    }
    
    if tools:
        request_data["tools"] = tools
        request_data["tool_choice"] = "auto"
    
    if temperature is not None:
        request_data["temperature"] = temperature
    
    full_content_parts: list[str] = []
    tool_call_buf: dict[int, dict] = {}

    # === usage/cost 누적용 변수 추가 ===
    total_cost = 0.0
    total_usage = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }

    try:
        log.info(f"GenOS API 호출: {endpoint}")
        async with aiohttp.ClientSession() as session:
            async with session.post(endpoint, headers=headers, json=request_data) as response:
                # 401 에러인 경우 상세 정보 로깅
                if response.status == 401:
                    error_text = await response.text()
                    log.error(f"GenOS API 인증 실패 (401): {error_text}")
                    log.error(f"사용된 토큰 (처음 20자): {bearer_token[:20]}...")
                    raise RuntimeError(f"GenOS API 인증 실패: {error_text}")
                response.raise_for_status()

                buffer = ""
                async for chunk in response.content.iter_any():
                    if not chunk:
                        continue

                    buffer += chunk.decode('utf-8', errors='ignore')
                    lines = buffer.split('\n')
                    buffer = lines.pop()  # 마지막 불완전한 줄은 버퍼에 보관

                    for line in lines:
                        line = line.strip()
                        if not line or line == 'data: [DONE]':
                            continue

                        if line.startswith('data: '):
                            json_str = line[6:]  # 'data: ' 제거
                            try:
                                chunk_data = json.loads(json_str)
                            except json.JSONDecodeError:
                                continue

                            # === usage/cost 누적 ===
                            # Alibaba MCP 서버 등에서 body 필드가 있을 수 있음
                            body = chunk_data.get('body') or chunk_data
                            usage = body.get('usage') if isinstance(body, dict) else None
                            if usage:
                                if "prompt_tokens" in usage:
                                    total_usage["prompt_tokens"] = usage.get("prompt_tokens", total_usage["prompt_tokens"])
                                if "completion_tokens" in usage:
                                    total_usage["completion_tokens"] = usage.get("completion_tokens", total_usage["completion_tokens"])
                                if "total_tokens" in usage:
                                    total_usage["total_tokens"] = usage.get("total_tokens", total_usage["total_tokens"])
                                cost_val = usage.get("cost")
                                if isinstance(cost_val, (int, float)):
                                    total_cost = float(cost_val)

                            if not chunk_data.get('choices'):
                                continue

                            choice = chunk_data['choices'][0]
                            delta = choice.get('delta', {})

                            if not delta:
                                continue

                            # tool calls 처리
                            if 'tool_calls' in delta and delta['tool_calls']:
                                for tool_call_delta in delta['tool_calls']:
                                    idx = tool_call_delta.get('index')
                                    if idx is None:
                                        continue

                                    if idx not in tool_call_buf:
                                        tool_call_buf[idx] = {
                                            "id": tool_call_delta.get('id', ''),
                                            "type": "function",
                                            "function": {
                                                "name": "",
                                                "arguments": "",
                                            },
                                        }

                                    buf = tool_call_buf[idx]

                                    if 'id' in tool_call_delta:
                                        buf["id"] = tool_call_delta['id']

                                    if 'function' in tool_call_delta:
                                        func_delta = tool_call_delta['function']
                                        if 'name' in func_delta:
                                            buf["function"]["name"] = func_delta['name']
                                        if 'arguments' in func_delta:
                                            buf["function"]["arguments"] += func_delta['arguments']

                            # content tokens 처리
                            if 'content' in delta and delta['content']:
                                content_piece = delta['content']
                                if content_piece:
                                    full_content_parts.append(content_piece)
                                    # tool_calls가 없으면 토큰을 즉시 yield
                                    if 'tool_calls' not in delta or not delta.get('tool_calls'):
                                        yield {
                                            "event": "token",
                                            "data": content_piece,
                                        }
        # 최종 메시지 생성
        final_message: dict[str, Any] = {"role": "assistant"}
        final_content = "".join(full_content_parts).strip()
        final_message["content"] = final_content if final_content else ""

        # === 최종 usage/cost 정보 추가 ===
        final_message["usage"] = total_usage
        final_message["cost"] = total_cost

        # tool_calls가 있으면 추가
        if tool_call_buf:
            tool_calls = []
            for idx in sorted(tool_call_buf.keys()):
                tc = tool_call_buf[idx]
                try:
                    json.loads(tc["function"]["arguments"])
                    args_str = tc["function"]["arguments"]
                except (json.JSONDecodeError, TypeError):
                    args_str = "{}"

                tool_calls.append({
                    "id": tc["id"],
                    "type": tc["type"],
                    "function": {
                        "name": tc["function"]["name"],
                        "arguments": args_str,
                    },
                })
            final_message["tool_calls"] = tool_calls

        yield final_message

    except Exception as e:
        log.exception("GenOS LLM API 호출 실패")
        raise


def is_sse(response):
    class SSE(BaseModel):
        event: str
        data: Any

    try:
        SSE.model_validate(response)
        return True
    except Exception:
        return False


