import asyncio
import json
import re
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from app.utils import (
    call_llm_stream, 
    is_sse, 
    ROOT_DIR, 
    States
)
from app.stores.session_store import SessionStore
from app.stores.chat_history import ChatHistoryStore
from app.tools import get_tool_map, get_tools_for_llm
from app.logger import get_logger
from app.langgraph_agent import LangGraphSearchAgent

router = APIRouter()
store = SessionStore()
history_store = ChatHistoryStore()
log = get_logger(__name__)


class GenerateRequest(BaseModel):
    question: str
    chatId: str | None = None
    userInfo: dict | None = None
    model_config = ConfigDict(extra='allow')


@router.post("/chat/stream")
async def chat_stream(
    req: GenerateRequest, 
    request: Request
) -> StreamingResponse:
    """
    SSE 프로토콜을 사용하여 채팅 스트리밍을 제공합니다.
    """
    queue: asyncio.Queue[str] = asyncio.Queue()
    SENTINEL = "__STREAM_DONE__"
    client_disconnected = asyncio.Event()

    async def emit(event: str, data):
        payload = {"event": event, "data": data}
        await queue.put(f"data: {json.dumps(payload, ensure_ascii=False)}\n\n")

    async def heartbeat():
        while True:
            if client_disconnected.is_set():
                break
            await asyncio.sleep(10)
            await queue.put(": keep-alive\n\n")

    async def runner():
        # 변수 초기화 (예외 발생 시에도 finally에서 사용할 수 있도록)
        states = None
        chat_id = None
        history = []
        
        try:
            states = States()
            chat_id = req.chatId or uuid4().hex
            log.info("chat stream started", extra={"chat_id": chat_id})

            if req.userInfo:
                states.user_id = req.userInfo.get("id")

            system_prompt = (ROOT_DIR / "prompts" / "system.txt").read_text(encoding="utf-8").format(
                current_date=datetime.now().strftime("%Y-%m-%d"),
                locale="ko-KR"
            )
            
            # model_set_context 초기화 (user_id가 없어도 사용할 수 있도록)
            model_set_context = []
            if states.user_id:
                model_set_context_list = await store.get_messages(states.user_id)
                if model_set_context_list:
                    model_set_context = [SystemMessage(
                            content="### User Memory\n" + "\n".join([f"{idx}. {msc}" for idx, msc in enumerate(model_set_context_list,   start=1)])
                        )]
            
            persisted_dicts = (await store.get_messages(chat_id)) or []
            persisted = []
            for msg in persisted_dicts:
                role = msg.get("role")
                content = msg.get("content", "")
                if role == "user":
                    persisted.append(HumanMessage(content=content))
                elif role == "assistant":
                    tool_calls_data = msg.get("tool_calls")
                    persisted.append(AIMessage(content=content, tool_calls=tool_calls_data if tool_calls_data else []))
                elif role == "system":
                    persisted.append(SystemMessage(content=content))
                elif role == "tool":
                    persisted.append(ToolMessage(content=content, tool_call_id=msg.get("tool_call_id")))

            history = [
                *persisted,
                HumanMessage(content=req.question)
            ]
            
            states.messages = [
                SystemMessage(content=system_prompt),
                *model_set_context,
                *history
            ]
            states.tools = await get_tools_for_llm()
            tool_map = await get_tool_map()

            while True:
                if client_disconnected.is_set():
                    break
                
                await emit("tool_state", states.tool_state.model_dump())
                
                # 최종 메시지를 저장할 변수
                final_message = None
                
                # 스트림 처리
                async for res in call_llm_stream(
                    messages=states.messages,
                    tools=states.tools,
                    temperature=0.2
                ):
                    if is_sse(res):
                        # SSE 이벤트 (토큰 등)는 즉시 emit
                        await emit(res["event"], res["data"])
                    else:
                        # 최종 메시지는 나중에 처리하기 위해 저장
                        final_message = res
                
                # 최종 메시지가 없으면 루프 종료
                if final_message is None:
                    break
                
                # 최종 메시지를 states.messages에 추가
                if isinstance(final_message, dict):
                    role = final_message.get("role")
                    content = final_message.get("content", "")
                    tool_calls = final_message.get("tool_calls")
                    if role == "assistant":
                        msg_obj = AIMessage(content=content, tool_calls=tool_calls if tool_calls else [])
                    elif role == "user":
                        msg_obj = HumanMessage(content=content)
                    elif role == "system":
                        msg_obj = SystemMessage(content=content)
                    elif role == "tool":
                        msg_obj = ToolMessage(content=content, tool_call_id=final_message.get("tool_call_id"))
                    else:
                        msg_obj = BaseMessage(content=content, type=role)
                else:
                    msg_obj = final_message

                states.messages.append(msg_obj)
                
                # tool_calls와 content 확인
                tool_calls = getattr(msg_obj, "tool_calls", []) if hasattr(msg_obj, "tool_calls") else []
                contents = msg_obj.content
                
                # 툴 호출이 없고 콘텐츠가 있으면 종료
                if not tool_calls and contents:
                    break
                # 툴 호출이 없고 콘텐츠가 없으면 다시 인퍼런스 시도
                elif not tool_calls and not contents:
                    continue
                
                # 툴 호출이 있으면 툴 호출 처리
                if tool_calls:
                    for tool_call in tool_calls:
                        tool_name = tool_call.get('function', {}).get('name')
                        if not tool_name:
                            log.warning("tool call에 name이 없음", extra={"chat_id": chat_id, "tool_call": tool_call})
                            continue
                        
                        try:
                            tool_args_str = tool_call.get('function', {}).get('arguments', '{}')
                            tool_args = json.loads(tool_args_str) if tool_args_str else {}
                        except json.JSONDecodeError as e:
                            log.exception("tool arguments JSON 파싱 실패", extra={"chat_id": chat_id, "tool_name": tool_name, "arguments": tool_args_str})
                            tool_args = {}
                        
                        log.info("tool call", extra={"chat_id": chat_id, "tool_name": tool_name})
                        
                        try:
                            tool_res = tool_map[tool_name](states, **tool_args)
                            # emit visible query for search tools
                            if tool_name == "search":
                                await emit("agentFlowExecutedData", {
                                    "nodeLabel": "Visible Query Generator",
                                    "data": {
                                        "output": {
                                            "content": json.dumps({
                                                "visible_web_search_query": [sq.get('q', '') for sq in tool_args.get('search_query', [])]
                                            }, ensure_ascii=False)
                                        }
                                    }
                                })
                            elif tool_name == "open":
                                try:
                                    if tool_args.get('id') and tool_args['id'].startswith('http'):
                                        url = tool_args['id']
                                    elif tool_args.get('id') is None:
                                        url = getattr(states.tool_state, "current_url", None)
                                    else:
                                        url = states.tool_state.id_to_url.get(tool_args['id'])
                                    if url:
                                        await emit("agentFlowExecutedData", {
                                            "nodeLabel": "Visible URL",
                                            "data": {
                                                "output": {
                                                    "content": json.dumps({
                                                        "visible_url": url
                                                    }, ensure_ascii=False)
                                                }
                                            }
                                        })
                                except Exception as e:
                                    log.exception("open tool emit 실패", extra={"chat_id": chat_id})

                            if asyncio.iscoroutine(tool_res):
                                tool_res = await tool_res

                            # If search tool returned structured results, emit them and a log event
                            if tool_name == "search":
                                try:
                                    # tool_res expected to be a dict like {"results": [...]}
                                    results = None
                                    if isinstance(tool_res, dict) and "results" in tool_res:
                                        results = tool_res.get("results")
                                    elif isinstance(tool_res, list):
                                        results = tool_res
                                    elif isinstance(tool_res, str):
                                        # try to parse JSON
                                        try:
                                            parsed = json.loads(tool_res)
                                            results = parsed.get("results") if isinstance(parsed, dict) else parsed
                                        except Exception:
                                            results = None

                                    if results:
                                        # Emit agent flow node with search results (titles + sources)
                                        await emit("agentFlowExecutedData", {
                                            "nodeLabel": "Search Results",
                                            "data": {
                                                "output": {
                                                    "content": json.dumps({
                                                        "visible_search_results": [
                                                            {"id": r.get("id"), "title": r.get("title"), "source": r.get("source"), "url": r.get("url")}
                                                            for r in results
                                                        ]
                                                    }, ensure_ascii=False)
                                                }
                                            }
                                        })

                                        # Also emit a tool_log event so frontend can display full snippets
                                        await emit("tool_log", {
                                            "tool": "search",
                                            "results": results
                                        })

                                        log.info("search tool executed", extra={"chat_id": chat_id, "count": len(results)})
                                except Exception as e:
                                    log.exception("failed to emit search results", extra={"chat_id": chat_id})
                        except Exception as e:
                            log.exception("tool call failed", extra={"chat_id": chat_id, "tool_name": tool_name})
                            tool_res = f"Error calling {tool_name}: {e}\n\nTry again with different arguments."
                        
                        tool_call_id = tool_call.get('id', '')
                        states.messages.append(ToolMessage(content=str(tool_res), tool_call_id=tool_call_id))

        except Exception as e:
            log.exception("chat stream failed")
            await emit("error", str(e))
            await emit("token", f"\n\n오류가 발생했습니다: {e}")
        finally:
            # states와 history가 정의되어 있고 유효한 경우에만 메시지 저장
            try:
                if states and hasattr(states, 'messages') and states.messages and chat_id:
                    # BaseMessage 객체들을 dict로 변환하여 저장
                    to_save = []
                    for msg in states.messages:
                        if isinstance(msg, SystemMessage):
                            continue # 시스템 프롬프트는 저장하지 않음 (필요에 따라 조절)
                        
                        m_dict = {"role": msg.type, "content": msg.content}
                        if isinstance(msg, AIMessage) and msg.tool_calls:
                            m_dict["tool_calls"] = msg.tool_calls
                        if isinstance(msg, ToolMessage):
                            m_dict["tool_call_id"] = msg.tool_call_id
                        
                        # assistant 메시지 정규화
                        if m_dict["role"] == "assistant" and isinstance(m_dict["content"], str):
                            m_dict["content"] = re.sub(r"【[^】]*】", "", m_dict["content"]).strip()
                        
                        to_save.append(m_dict)
                    
                    await store.save_messages(chat_id, to_save)
            except Exception as e:
                log.exception("failed to save messages in finally block", extra={"chat_id": chat_id})
            
            await emit("result", None)
            await queue.put(SENTINEL)
            log.info("chat stream finished", extra={"chat_id": chat_id})

    async def sse():
        producer = asyncio.create_task(runner())
        pinger = asyncio.create_task(heartbeat())
        try:
            while True:
                if await request.is_disconnected():
                    client_disconnected.set()
                    break
                chunk = await queue.get()
                if chunk == SENTINEL:
                    break
                yield chunk
        finally:
            client_disconnected.set()
            producer.cancel()
            pinger.cancel()

    return StreamingResponse(
        sse(), 
        media_type="text/event-stream", 
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    )


# ============ LangChain 멀티턴 엔드포인트 ============


@router.post("/chat/langgraph")
async def chat_langgraph(
    req: GenerateRequest,
    request: Request
) -> StreamingResponse:
    queue: asyncio.Queue[str] = asyncio.Queue()
    SENTINEL = "__STREAM_DONE__"
    client_disconnected = asyncio.Event()

    async def emit(event: str, data):
        payload = {"event": event, "data": data}
        await queue.put(f"data: {json.dumps(payload, ensure_ascii=False)}\n\n")

    async def heartbeat():
        while True:
            if client_disconnected.is_set():
                break
            await asyncio.sleep(10)
            await queue.put(": keep-alive\n\n")

    async def runner():
        chat_id = req.chatId or uuid4().hex
        user_id = req.userInfo.get("id") if req.userInfo else None
        usage_summary: dict | None = None
        reasoning_events: list[dict] = []
        tool_events: list[dict] = []
        latest_ui_payload: dict | None = None
        references_payload: list[dict] = []

        try:
            await emit("token", "")

            history_messages = await history_store.get_chat_history_as_messages(chat_id, limit=10)

            await history_store.save_message(
                chat_id,
                "user",
                req.question,
                user_id=user_id,
                title=req.question,
            )

            agent = LangGraphSearchAgent()

            async def agent_emit(event: str, data):
                nonlocal latest_ui_payload
                if client_disconnected.is_set():
                    return
                timestamp = datetime.utcnow().isoformat()
                if event == "reasoning" and data is not None:
                    reasoning_events.append({"timestamp": timestamp, "data": data})
                elif event == "tool_use" and data is not None:
                    tool_events.append({"timestamp": timestamp, "data": data})
                elif event == "ui_payload" and isinstance(data, dict):
                    latest_ui_payload = data
                await emit(event, data)

            agent.set_emitter(agent_emit)

            final_state = await agent.run(question=req.question, history=history_messages)

            final_answer = final_state.get("final_answer") or ""
            final_usage = final_state.get("final_usage")
            final_cost = final_state.get("final_cost")

            ui_payload = agent._build_ui_payload(final_state)
            if ui_payload:
                await agent_emit("ui_payload", ui_payload)

            document_results = final_state.get("document_results") or []

            def _format_reference(item: dict, max_length: int = 240):
                if not isinstance(item, dict):
                    return None
                content = (item.get("content") or "").strip()
                if max_length > 0 and len(content) > max_length:
                    content = content[:max_length].rstrip() + "…"
                return {
                    "file_name": item.get("file_name") or "알 수 없는 문서",
                    "page": item.get("page"),
                    "position": item.get("position"),
                    "content_snippet": content,
                }

            references_payload = [ref for ref in (_format_reference(item) for item in document_results) if ref]

            await emit("document_references", {"documents": references_payload})

            await emit("metadata", {
                "chat_id": chat_id,
                "user_id": user_id,
                "search_iterations": final_state.get("search_iterations", 0),
                "summaries": final_state.get("search_results_summary", []),
            })

            if final_usage or final_cost is not None:
                usage_summary = {}
                if final_usage:
                    usage_summary["usage"] = final_usage
                if final_cost is not None:
                    usage_summary["cost"] = final_cost
                await history_store.update_session_usage(chat_id, final_usage, final_cost)

            assistant_metadata = {
                "reasoning": reasoning_events,
                "tool_logs": tool_events,
                "references": references_payload,
                "ui_payload": latest_ui_payload or ui_payload,
                "usage": final_usage,
                "cost": final_cost,
            }

            await history_store.save_message(
                chat_id,
                "assistant",
                final_answer,
                user_id=user_id,
                metadata=assistant_metadata,
            )

        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("langgraph chat failed", extra={"chat_id": chat_id})
            await emit("error", str(e))
            await emit("token", f"\n\n오류가 발생했습니다: {e}")
        finally:
            await emit("result", usage_summary)
            await queue.put(SENTINEL)
            log.info("langgraph chat finished", extra={"chat_id": chat_id})

    async def sse():
        producer = asyncio.create_task(runner())
        pinger = asyncio.create_task(heartbeat())
        try:
            while True:
                if await request.is_disconnected():
                    client_disconnected.set()
                    break
                chunk = await queue.get()
                if chunk == SENTINEL:
                    break
                yield chunk
        finally:
            client_disconnected.set()
            producer.cancel()
            pinger.cancel()

    return StreamingResponse(
        sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )

@router.get("/chat/history/{chat_id}")
async def get_chat_history(chat_id: str, limit: int = 50):
    """
    특정 채팅 세션의 히스토리 조회 (최근 limit개 메시지)
    """
    try:
        messages = await history_store.get_chat_history(chat_id, limit=limit)
        return {
            "chat_id": chat_id,
            "messages": messages,
            "total": len(messages)
        }
    except Exception as e:
        log.exception(f"Failed to get chat history: {e}")
        return {"error": str(e), "chat_id": chat_id, "messages": []}


@router.get("/chat/sessions")
async def list_chat_sessions(limit: int = 50, user_id: str | None = None):
    try:
        summaries = await history_store.list_sessions(user_id=user_id, limit=limit)
        return {"sessions": summaries}
    except Exception as e:
        log.exception("Failed to list chat sessions")
        return {"sessions": [], "error": str(e)}


@router.delete("/chat/history/{chat_id}")
async def clear_chat_history(chat_id: str):
    """
    특정 채팅 세션의 히스토리 삭제
    """
    try:
        success = await history_store.clear_chat_history(chat_id)
        return {
            "chat_id": chat_id,
            "success": success
        }
    except Exception as e:
        log.exception(f"Failed to clear chat history: {e}")
        return {"error": str(e), "chat_id": chat_id, "success": False}
