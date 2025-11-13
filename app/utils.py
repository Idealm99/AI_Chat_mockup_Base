import os
import pathlib
import json
import requests
from typing import Any
from pydantic import BaseModel, Field
import aiohttp

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


def _get_genos_base() -> str:
    base = os.getenv("GENOS_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("GENOS_URL 환경 변수가 설정되지 않았습니다.")
    return base


def _get_serving_id() -> str:
    sid = os.getenv("SERVING_ID", "").strip()
    if not sid:
        raise RuntimeError("SERVING_ID 환경 변수가 설정되지 않았습니다.")
    return sid


def _get_headers() -> dict:
    token = os.getenv("GENOS_TOKEN", "").strip()
    if not token:
        raise RuntimeError("GENOS_TOKEN 환경 변수가 설정되지 않았습니다.")
    return {"Authorization": f"Bearer {token}"}


async def call_llm_stream(
    messages: list[dict],
    model: str | None = None,
    tools: list[dict] | None = None,
    temperature: float | None = None,
    **kwargs
):
    """
    GENOS 게이트웨이(servin_api.py 방식)로 스트리밍 호출합니다.
    OpenAI Chat Completions 호환 스트림을 파싱하여 토큰/툴콜을 동일 포맷으로 내보냅니다.
    """
    base = _get_genos_base()
    serving_id = _get_serving_id()
    headers = _get_headers()

    url = f"{base}/api/gateway/rep/serving/{serving_id}/v1/chat/completions"
    payload: dict[str, Any] = {
        "messages": messages,
        "stream": True,
    }
    if model:
        payload["model"] = model
    if tools:
        payload["tools"] = tools
        # OpenAI 포맷과 동일하게 tool_choice 자동
    if temperature is not None:
        payload["temperature"] = temperature
    # 기타 kwargs는 무시하거나 필요 시 매핑

    full_content_parts: list[str] = []
    full_reasoning_parts: list[str] = []
    tool_call_buf: dict[int, dict] = {}

    timeout = aiohttp.ClientTimeout(total=300)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(url, headers=headers, json=payload) as resp:
            resp.raise_for_status()
            async for raw_line in resp.content:
                if not raw_line:
                    continue
                line = raw_line.decode("utf-8").strip()
                if not line:
                    continue
                if not line.startswith("data:"):
                    continue
                data_str = line[len("data:"):].strip()
                if data_str == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                except Exception:
                    continue
                choices = data.get("choices", [])
                if not choices:
                    continue
                delta = choices[0].get("delta", {}) or {}

                # reasoning
                reasoning_piece = delta.get("reasoning")
                if reasoning_piece:
                    full_reasoning_parts.append(reasoning_piece)
                    yield {
                        "event": "reasoning_token",
                        "data": reasoning_piece,
                    }

                # tool calls (buffer)
                if "tool_calls" in delta and delta["tool_calls"]:
                    for i, tc in enumerate(delta["tool_calls"]):
                        key = tc.get("index", i)
                        buf = tool_call_buf.setdefault(key, {
                            "id": None,
                            "type": "function",
                            "function": {"name": None, "arguments": ""},
                        })
                        if tc.get("id"):
                            buf["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            buf["function"]["name"] = fn["name"]
                        if fn.get("arguments"):
                            buf["function"]["arguments"] += fn["arguments"]

                # content tokens (only when no tool_calls in this delta)
                if not delta.get("tool_calls") and delta.get("content"):
                    content_piece = delta.get("content") or ""
                    if content_piece:
                        full_content_parts.append(content_piece)
                        yield {
                            "event": "token",
                            "data": content_piece,
                        }

    final_message: dict[str, Any] = {"role": "assistant"}
    final_content = "".join(full_content_parts).strip()
    final_message["content"] = final_content if final_content else ""
    final_reasoning = "".join(full_reasoning_parts).strip()
    if final_reasoning:
        final_message["reasoning"] = final_reasoning

    if tool_call_buf:
        tool_calls = []
        for _, tc in sorted(tool_call_buf.items(), key=lambda x: x[0]):
            tool_calls.append({
                "id": tc["id"],
                "type": "function",
                "function": {
                    "name": tc["function"]["name"],
                    "arguments": tc["function"]["arguments"],
                },
            })
        final_message["tool_calls"] = tool_calls

    yield final_message


def is_sse(response):
    class SSE(BaseModel):
        event: str
        data: Any

    try:
        SSE.model_validate(response)
        return True
    except Exception:
        return False


def is_valid_model(model: str) -> bool:
    """
    GENOS 모델 목록에서 유효성 확인
    """
    try:
        base = _get_genos_base()
        serving_id = _get_serving_id()
        headers = _get_headers()
        url = f"{base}/api/gateway/rep/serving/{serving_id}/v1/models"
        res = requests.get(url, headers=headers, timeout=15)
        res.raise_for_status()
        data = res.json()
        model_list = [i["id"] for i in data.get("data", [])]
        return model in model_list if model else False
    except Exception:
        return False
