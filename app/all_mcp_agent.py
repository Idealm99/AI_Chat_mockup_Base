import operator
from typing import Annotated, List, Literal, Union, TypedDict
import yaml

from langchain_openai import ChatOpenAI
from langchain_core.messages import AnyMessage, SystemMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from app.mcp.mcp_adapter_client import MCPClient

from langchain_core.tools import Tool


import operator
from typing import Annotated, List, Literal, Union, TypedDict
from langchain_core.tools import tool
from langchain_core.messages import AnyMessage

class State(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    all_available_tools: List[tool]
    active_tools: List[tool]



class JWResearchAgent:
    def __init__(self, mcp_config_path:str = "./configs/mcpconfig.json",
                 llm_config_path:str = "./configs/llmconfig.yaml"):
        # 초기화 시에는 연결하지 않고 객체만 생성
        self.client = MCPClient()
        
        with open(llm_config_path, 'r') as file:
            config = yaml.safe_load(file)
            self.api_key = config['openrouter']['api_key']
            self.base_url = config['openrouter']['base_url']
            self.model = config['openrouter']['model']

    # async def planner(self, state:State):
    #     llm = ChatOpenAI(model=self.model, api_key=self.api_key, base_url=self.base_url)
    #     system_prompt = SystemMessage(content = """

    #     """)

    async def research_agent(self, state: State):
        llm = ChatOpenAI(model=self.model, api_key=self.api_key, base_url=self.base_url)
        available_tools = state.get('active_tools', [])
        
        # MCP 툴 포맷 변환
        tools = [self.client.convert_tool_format(tool) for tool in available_tools]
        
        # 시스템 메시지 처리 (메시지 기록에 없다면 추가)
        messages = state['messages']

        # 도구 바인딩 및 호출
        if tools:
            llm = llm.bind_tools(tools)
        
        response = await llm.ainvoke(messages)
        return {"messages": [response]}
    
    async def process_response(self, state: State):
        """도구 실행 노드"""
        messages = state['messages']
        last_message = messages[-1]
        
        tool_outputs = []
        if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
            for tool_call in last_message.tool_calls:
                # 1. 도구 실행 (MCP Client)
                mcp_result = await self.client.tool_call(tool_call)

                if hasattr(mcp_result, 'content') and isinstance(mcp_result.content, list):
                    content_str = "".join([c.text for c in mcp_result.content if hasattr(c, 'type') and c.type == 'text'])
                else:
                    content_str = str(mcp_result) # fallback

                # 3. ToolMessage 생성
                tool_outputs.append(ToolMessage(
                    content=content_str,
                    tool_call_id=tool_call['id'],
                    name=tool_call['name']
                ))

            return {"messages": tool_outputs}
        
        return {"messages": []}

    def should_continue(self, state: State) -> Literal["parsing", END]:
        """
        LLM의 응답을 확인하여 다음 단계를 결정하는 조건부 함수
        """
        messages = state['messages']
        last_message = messages[-1]
        
        # LLM이 도구 호출(tool_calls)을 원하면 'parsing' 노드로 이동
        if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
            return "parsing"
        
        # 도구 호출이 없으면 답변이 완료된 것이므로 종료
        return END

    async def get_workflow(self):
        workflow = StateGraph(State)
        
        # 워크플로우 생성 시점에 서버 연결 (await 필수)
        await self.client.connect_to_server()
        self.all_servers = await self.client.get_server_lists()
        self.all_tools = await self.client.get_all_tools()

        # --------------------------nodes---------------------------

        workflow.add_node('agent', self.research_agent)
        workflow.add_node('parsing', self.process_response)

        # --------------------------edges---------------------------
        
        # 1. 시작 -> 에이전트
        workflow.add_edge(START, "agent")
        
        # 2. 에이전트 -> (조건부) -> 도구 실행 or 종료
        workflow.add_conditional_edges(
            "agent",
            self.should_continue,
            {
                "parsing": "parsing",  # 도구 호출 시 parsing 노드로
                END: END               # 답변 완료 시 종료
            }
        )
        
        # 3. 도구 실행 -> 다시 에이전트 (Loop 핵심)
        # 도구 결과를 보고 에이전트가 다시 판단하도록 함
        workflow.add_edge("parsing", "agent")
        
        # ----------------------------------------------------------- 

        memory = MemorySaver()
        app = workflow.compile(checkpointer=memory)
        return app
    
    async def start(self, question:str, tools:list[Tool], session_id:str = "test-session-1"):
        workflow = await self.get_workflow()
        inputs = {
            "messages": [
                            SystemMessage(content="""
                                주어진 도구를 활용하여 사용자의 질문에 대해 자세한 답변을 수행하세요.
                                절대 추측하지 말고 도구를 사용하여 사실에 근거한 답변을 작성하세요.
                                도구를 사용할 때에는 Tool Description을 꼼꼼히 읽고 가장 적합한 도구를 선택하세요.
                                """), 
                            HumanMessage(content=question)
                        ],
            "all_available_tools": self.all_tools,
            "active_tools": tools, # (참고: active_tool_names와 변수명 일치 여부 확인 필요)
        }
        config = {"configurable": {"thread_id": session_id}}
        result = await workflow.ainvoke(inputs, config = config)
        return result

    async def start_stream(self, question:str, tools:list[Tool], session_id:str = "test-session-1"):
        workflow = await self.get_workflow()
        inputs = {
            "messages": [
                            SystemMessage(content="""
                                주어진 도구를 활용하여 사용자의 질문에 대해 자세한 답변을 수행하세요.
                                절대 추측하지 말고 도구를 사용하여 사실에 근거한 답변을 작성하세요.
                                도구를 사용할 때에는 Tool Description을 꼼꼼히 읽고 가장 적합한 도구를 선택하세요.
                                """), 
                            HumanMessage(content=question)
                        ],
            "all_available_tools": self.all_tools,
            "active_tools": tools, # (참고: active_tool_names와 변수명 일치 여부 확인 필요)
        }
        config = {"configurable": {"thread_id": session_id}}
        async for event in workflow.astream_events(inputs, config = config):
            yield event