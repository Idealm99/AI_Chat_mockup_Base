from typing import Any, Dict, List, Optional

import httpx
import requests
import weaviate

from app.logger import get_logger


logger = get_logger(__name__)


    
class embedding_serving:
    def __init__(self, serving_id:int = None, bearer_token:str = None, genos_url:str = None):
        import os
        self.serving_id = serving_id if serving_id is not None else int(os.getenv("EMBEDDING_SERVING_ID", "10"))
        self.url = f"{genos_url or os.getenv('EMBEDDING_BASE_URL', 'https://genos.mnc.ai:3443')}/api/gateway/rep/serving/{self.serving_id}"
        token = bearer_token if bearer_token is not None else os.getenv("EMBEDDING_BEARER_TOKEN", "")
        self.headers = dict(Authorization=f"Bearer {token}")
        if not self.serving_id or not token:
            logger.warning(
                "Serving id or bearer token missing for embedding serving",
                extra={"serving_id": self.serving_id},
            )

    def call(self, question: str = '안녕?'):
        body = {"input": [question]}
        endpoint = f"{self.url}/v1/embeddings"
        response = requests.post(endpoint, headers=self.headers, json=body)
        result = response.json()
        return result.get('data', [])
    
    def call_batch(self, question: Optional[List[str]] = None):
        inputs = question or ['안녕?']
        body = {"input": inputs}
        endpoint = f"{self.url}/v1/embeddings"
        response = requests.post(endpoint, headers=self.headers, json=body)
        result = response.json()
        return result.get('data', [])
    
    async def async_call(self, question: str = '안녕?'):
        body = {"input": question}
        endpoint = f"{self.url}/v1/embeddings"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
                response = await client.post(endpoint, headers=self.headers, json=body)
                result = response.json()
                return result.get('data', [])

        except KeyError as e:
            logger.error("Unexpected response format from embedding serving", extra={"error": str(e)})
            return None
        except httpx.RequestError as e:
            logger.error("Embedding serving request error", extra={"error": str(e)})
            return None
    
    async def async_call_batch(self, question: Optional[List[str]] = None):
        inputs = question or ['안녕?']
        body = {"input": inputs}
        endpoint = f"{self.url}/v1/embeddings"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
                response = await client.post(endpoint, headers=self.headers, json=body)
                result = response.json()
                return result.get('data', [])

        except KeyError as e:
            logger.error("Unexpected response format from embedding serving", extra={"error": str(e)})
            return None
        except httpx.RequestError as e:
            logger.error("Embedding serving request error", extra={"error": str(e)})
            return None
    
class vectordb:
    def __init__(self, genos_ip:str = None, 
                 http_port: int = None, 
                 grpc_port: int = None,
                 idx:str = None,
                 embedding_serving_id:int = None,
                 embedding_bearer_token:str = None,
                 embedding_genos_url:str = None):
        import os
        genos_ip = genos_ip if genos_ip is not None else os.getenv("WEAVIATE_HOST", "localhost")
        http_port = http_port if http_port is not None else int(os.getenv("WEAVIATE_HTTP_PORT", "8080"))
        grpc_port = grpc_port if grpc_port is not None else int(os.getenv("WEAVIATE_GRPC_PORT", "50051"))
        idx = idx if idx is not None else os.getenv("WEAVIATE_INDEX")
        embedding_serving_id = embedding_serving_id if embedding_serving_id is not None else int(os.getenv("EMBEDDING_SERVING_ID", "10"))
        embedding_bearer_token = embedding_bearer_token if embedding_bearer_token is not None else os.getenv("EMBEDDING_BEARER_TOKEN", "")
        embedding_genos_url = embedding_genos_url if embedding_genos_url is not None else os.getenv("EMBEDDING_BASE_URL", "https://genos.mnc.ai:3443")
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
            logger.error("Failed to connect to Weaviate", extra={"error": str(e)})
            raise

        if not idx:
            raise ValueError('Vector index is required to initialize vectordb.')

        self.collection = self.client.collections.get(idx)
        self.emb = embedding_serving(
            serving_id=embedding_serving_id,
            bearer_token=embedding_bearer_token,
            genos_url=embedding_genos_url,
        )
        

    @staticmethod
    def _extract_value(properties: Dict[str, Any], candidates: List[str]) -> Optional[Any]:
        for key in candidates:
            if key in properties:
                return properties[key]
        return None

    def _format_result(self, properties: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "file_name": self._extract_value(properties, ["file_name", "filename", "source"]),
            "page": self._extract_value(properties, ["page", "page_number", "pageIndex", "page_idx"]),
            "position": self._extract_value(properties, ["position", "offset", "chunk_index", "chunkId"]),
            "content": self._extract_value(properties, ["content", "page_content", "text", "body"]),
        }

    def _format_results(self, objects: List[Any]) -> List[Dict[str, Any]]:
        formatted: List[Dict[str, Any]] = []
        for obj in objects:
            props = getattr(obj, 'properties', None)
            if not props:
                continue
            formatted.append(self._format_result(props))
        return formatted

    def dense_search(self, query:str, topk = 4):
        vector_response = self.emb.call(query)
        if not vector_response:
            logger.error("Embedding service returned no data", extra={"query": query})
            return []

        vector = vector_response[0]['embedding']
        response = self.collection.query.near_vector(near_vector=vector, limit=topk)
        return self._format_results(response.objects)
    
    def bm25_search(self, query:str, topk = 4):
        response = self.collection.query.bm25(query, limit=topk)
        return self._format_results(response.objects)
    
    def hybrid_search(self, query:str, topk:int = 4, alpha:float = 0.5):
        vector_response = self.emb.call(query)
        if not vector_response:
            logger.error("Embedding service returned no data", extra={"query": query})
            return []

        vector = vector_response[0]['embedding']
        response = self.collection.query.hybrid(query=query, vector=vector, alpha=alpha, limit=topk)
        return self._format_results(response.objects)

    def hybrid_search_with_filter(self, query:str, filter:str = '', topk:int = 4, alpha:float = 0.5):
        weaviate_filter =  None
        vector_response = self.emb.call(query)
        if not vector_response:
            logger.error("Embedding service returned no data", extra={"query": query})
            return []

        vector = vector_response[0]['embedding']

        try:
            response = self.collection.query.hybrid(
                query=query,
                vector=vector,
                alpha=alpha,
                limit=topk,
                filters=weaviate_filter,
            )
        except Exception as e:
            logger.warning(
                "Filter application failed; returning unfiltered results",
                extra={"error": str(e)},
            )
            response = self.collection.query.hybrid(
                query=query,
                vector=vector,
                alpha=alpha,
                limit=topk,
            )

        return self._format_results(response.objects)
