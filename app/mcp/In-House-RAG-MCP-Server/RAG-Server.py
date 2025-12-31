import json
from mcp.server.fastmcp import FastMCP
import requests
import weaviate
import httpx
from weaviate.classes.query import Filter, MetadataQuery

mcp = FastMCP("In-House-RAG-Server")

# ========================================================================================================
import json
import sys
import requests
import httpx

class embedding_serving:
    def __init__(self, serving_id:int = 10, bearer_token:str = '1ed5a9dbe58043219b6c1be758910450',
                  genos_url:str = 'https://genos.genon.ai:3443'):
        self.serving_id = serving_id
        self.url = f"{genos_url}/api/gateway/rep/serving/{serving_id}"
        self.headers = dict(Authorization=f"Bearer {bearer_token}")
        
        # [수정] 로그는 stderr로 출력
        if serving_id and bearer_token:
            print(f'embedding model: {serving_id}번과 토큰이 입력되었습니다.', file=sys.stderr)
        else:
            print('serving id 혹은 인증키가 입력되지 않았습니다.', file=sys.stderr)

    def call(self, question:str = '안녕?'):
        body = {
            "input" : [question]
        }
        endpoint = f"{self.url}/v1/embeddings"
        response = requests.post(endpoint, headers=self.headers, json=body)
        result = response.json()
        vector = result['data']
        return vector
    
    def call_batch(self, question:list = ['안녕?']):
        body = {
            "input" : question
        }
        endpoint = f"{self.url}/v1/embeddings"
        response = requests.post(endpoint, headers=self.headers, json=body)
        result = response.json()
        vector = result['data']
        return vector
    
    async def async_call(self, question = '안녕?'):
        body = {
            "input" : question
        }
        endpoint = f"{self.url}/v1/embeddings"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
                response = await client.post(endpoint, headers=self.headers, json=body)
                result = response.json()
                vector = result['data']

        except KeyError as e:
            # [수정] 로그는 stderr로 출력
            print(response.json(), file=sys.stderr)
            print(f'embedding 서빙 호출 중 keyerror 발생: {e}', file=sys.stderr)
            return None
        except httpx.RequestError as e:
            # [수정] 로그는 stderr로 출력
            print(f'embedding 서빙 호출 중 오류 발생 : {e}', file=sys.stderr)
            return None
        return vector
    
    async def async_call_batch(self, question:list = '안녕?'):
        body = {
            "input" : [question]
        }
        endpoint = f"{self.url}/v1/embeddings"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
                response = await client.post(endpoint, headers=self.headers, json=body)
                result = response.json()
                vector = result['data']

        except KeyError as e:
            # [수정] 로그는 stderr로 출력
            print(response.json(), file=sys.stderr)
            print(f'embedding 서빙 호출 중 keyerror 발생: {e}', file=sys.stderr)
            return None
        except httpx.RequestError as e:
            # [수정] 로그는 stderr로 출력
            print(f'embedding 서빙 호출 중 오류 발생 : {e}', file=sys.stderr)
            return None
        return vector
    
class vectordb:
    def __init__(self, genos_ip:str = "192.168.74.164", 
                 http_port: int = 32208, 
                 grpc_port: int = 32122,
                 idx:str = None,
                 embedding_serving_id:int = 10,
                 embedding_bearer_token:str = '1ed5a9dbe58043219b6c1be758910450',
                 embedding_genos_url:str = 'https://genos.genon.ai:3443'):
        try:
            self.client = weaviate.connect_to_custom(
                http_host=genos_ip,
                http_port=http_port,
                http_secure=False,
                grpc_host=genos_ip,
                grpc_port=grpc_port,
                grpc_secure=False,
            )
        except Exception as e:
            # [수정] 로그는 stderr로 출력
            print(f'Weaviate 접속 중 오류 발생, 접속 정보를 확인하세요. {e}', file=sys.stderr)
        
        self.collection = 'vdb collection이 설정되지 않았습니다.'
        if not idx:
            # [수정] 로그는 stderr로 출력
            print('벡터 인덱스가 설정되지 않았습니다. 벡터 인덱스를 설정하세요.', file=sys.stderr)
        else:
            self.collection = self.client.collections.get(idx)
            # [수정] 로그는 stderr로 출력
            print('VDB를 설정했습니다.', file=sys.stderr)
            
            # 주석 처리된 부분도 만약 사용하게 된다면 file=sys.stderr 추가 필요
            # print('----VDB 내부 property sample 3개----', file=sys.stderr)
            # ...

        # [수정] 로그는 stderr로 출력
        print(f'유사도 검색을 위한 임베딩 모델로 {embedding_serving_id}번 임베딩 모델을 사용합니다.', file=sys.stderr)
        self.emb = embedding_serving(serving_id = embedding_serving_id, bearer_token = embedding_bearer_token,
                                                   genos_url = embedding_genos_url)
    def dense_search(self, query:str, topk = 4):
        vector = self.emb.call(query)[0]['embedding']
        results = [i.properties for i  in self.collection.query.near_vector(near_vector = vector, limit = topk).objects]
        return results
    
    def bm25_search(self, query:str, topk = 4):
        results = [i.properties for i in self.collection.query.bm25(query, limit = topk).objects]
        return results
    
    def hybrid_search(self, query:str, topk:int = 4, alpha:float = 0.5):
        vector = self.emb.call(query)[0]['embedding']
        results = [i.properties for i in self.collection.query.hybrid(query = query, 
                                                                vector = vector,
                                                                alpha = alpha, limit = topk).objects]
        return results

    def show_documents(self):
        query_return = self.collection.query.fetch_objects(
            limit = 10000,
            return_properties=['file_name']
        )
        file_names = list(dict.fromkeys([i.properties['file_name'] for i in query_return.objects]))
        return file_names

    def search_from_file_name(self, query:str, file_name_pattern, topk = 4, alpha = 0.5):
        vector = self.emb.call(query)[0]['embedding']
        query_return = self.collection.query.hybrid(
            query = query,
            limit = topk,
            filters = Filter.by_property("file_name").like(file_name_pattern),
            vector = vector
        )
        results = [i.properties for i in query_return.objects]
        return results
    
    def search_images_from_file_name(self, query:str, file_name_pattern, alpha = 0.5):
        vector = self.emb.call(query)[0]['embedding']
        query_return = self.collection.query.hybrid(
            query = query,
            limit = 10000,
            filters = Filter.by_property("file_name").like(file_name_pattern),
            vector = vector
        )
        results = [i.properties for i in query_return.objects]
        return results

# # ========================================================================================================

@mcp.tool()
def search(query: str) -> list:
    """
    [일반 문서 검색] 사용자의 질문과 관련된 문서 내용(chunks)을 전체 데이터베이스에서 검색합니다.
    특정 파일명이 지정되지 않았거나, 범용적인 내용을 찾을 때 가장 먼저 사용해야 하는 기본 검색 도구입니다.

    Args:
        query (str): 검색할 질문 내용 또는 키워드

    Returns:
        list: 검색된 문서 조각(chunk)들의 리스트 (내용, 파일명, 페이지 정보 포함)
    """
    vdb = vectordb(idx = 'A648d5940b27d4f2d995e9be2c21df4f8')
    result = vdb.hybrid_search(query = query)
    result = [{'content' : i['text'], 'file_name' : i['file_name'], 'page' : int(i['i_page'])} for i in result]
    return result

@mcp.tool()
def show_documents() -> list:
    """
    [파일 목록 조회] 현재 데이터베이스에 저장되어 있는 모든 문서의 파일명 목록을 조회합니다.
    사용자가 어떤 문서들이 있는지 물어보거나, 특정 문서를 검색하기 전에 정확한 파일명을 확인해야 할 때 사용합니다.

    Returns:
        list: 저장된 모든 문서의 파일명(file_name) 리스트
    """
    vdb = vectordb(idx = 'A648d5940b27d4f2d995e9be2c21df4f8')
    return vdb.show_documents()

@mcp.tool()
def search_from_file_name(query: str, file_name_pattern: str) -> list:
    """
    [특정 파일 검색] 특정 파일명(또는 패턴)에 해당하는 문서 안에서만 내용을 검색합니다.
    사용자가 "A 논문에서 B 내용을 찾아줘"와 같이 특정 문서를 지칭했을 때 사용합니다.

    Args:
        query (str): 검색할 질문 내용
        file_name_pattern (str): 검색 범위를 제한할 파일명 또는 패턴 (예: "*2024*", "Report*", "*gene*", "BloodCancerJ2011_1_e29[NS-018].pdf")

    Returns:
        list: 해당 파일들 내에서 검색된 관련 문서 조각 리스트
    """
    vdb = vectordb(idx = 'A648d5940b27d4f2d995e9be2c21df4f8')
    result = vdb.search_from_file_name(query = query, file_name_pattern=file_name_pattern)
    result = [{'content' : i['text'], 'file_name' : i['file_name'], 'page' : int(i['i_page'])} for i in result]
    return result

@mcp.tool()
def search_images_from_file_name(query: str, file_name_pattern: str, topk: int = 4) -> list:
    """
    [시각 자료(이미지/차트) 검색] 특정 파일 내에서 질문과 관련된 '그림', '도표', '차트'가 포함된 부분을 검색합니다.
    사용자가 "이 논문의 아키텍처 다이어그램 보여줘", "실험 결과 그래프 찾아줘"와 같이 시각 자료를 요청할 때 사용합니다.
    (주의: 일반 텍스트 검색이 아니라, 이미지가 포함된 페이지나 영역을 찾을 때 씁니다.)

    Args:
        query (str): 찾으려는 이미지에 대한 설명 (예: "성능 비교 그래프")
        file_name_pattern (str): 검색할 대상 파일명 또는 패턴 (예: "BloodCancerJ2011_1_e29[NS-018].pdf")
        topk (int, optional): 반환할 최대 이미지 개수 (기본값: 4)

    Returns:
        list: 이미지가 포함된 문서 조각 및 좌표(bbox) 정보 리스트
    """
    vdb = vectordb(idx = 'A648d5940b27d4f2d995e9be2c21df4f8')
    result = vdb.search_images_from_file_name(query = query, file_name_pattern=file_name_pattern) 
    chunks = [{'content': i['text'], 'file_name' : i['file_name'], 'i_page' : i['i_page'], 'bboxes' : i['chunk_bboxes'] } for i in result]

    image_chunks = []
    for chunk in chunks:
        bbox_items = [i['ref'] for i in json.loads(chunk['bboxes'])]
        picture_cnt = sum(['pictures' in i for i in bbox_items])
        if picture_cnt >= 1:
            image_chunks.append(chunk)
        if len(image_chunks) >= topk:
            chunks = [{'content': i['content'], 'file_name' : i['file_name'], 'i_page' : i['i_page'],'bboxes' : i['bboxes']} for i in image_chunks]
            return chunks
    chunks = [{'content': i['content'], 'file_name' : i['file_name'], 'i_page' : i['i_page'] } for i in image_chunks]
    return chunks
    
@mcp.tool()
def search_relative_documents(query: str) -> list:
    """
    [관련 논문 탐색] 사용자의 질문이나 관심 주제와 관련된 논문이 무엇인지 찾습니다.
    문서의 전체 본문이 아니라, 각 문서의 '핵심 주제(Subject)'를 기반으로 검색하므로 더 빠르고 정확하게 연관된 논문 목록을 가져옵니다.
    
    사용자가 "~~에 대한 논문 있어?", "~~와 관련된 문서를 찾아줘"라고 요청했을 때 가장 먼저 사용하여 읽을 대상을 선정하는 데 사용합니다.

    Args:
        query (str): 찾고 싶은 논문의 주제, 키워드, 또는 해결하고자 하는 문제 (예: "Transformer 아키텍처 개선 연구")

    Returns:
        list: 검색된 관련 논문의 주제(subject)와 파일명(file_name) 리스트
    """
    vdb = vectordb(idx = 'C4d5d928c4ca04c27927c7876af780f5e') # 주제/메타데이터 전용 인덱스
    result = vdb.hybrid_search(query = query)
    # text 필드에 subject(요약된 주제)가 들어있다고 가정
    result = [{'subject': i['text'], 'file_name' : i['file_name']} for i in result]
    return result


if __name__ == "__main__":
    mcp.run() 