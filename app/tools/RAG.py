class vectordb:
    def __init__(self, genos_ip:str = "192.168.74.164",
                 http_port: int = 32208,
                 grpc_port: int = 32122,
                 idx:str = None,
                 embedding_serving_id:int = 10,
                 embedding_bearer_token:str = '1ed5a9dbe58043219b6c1be758910450',
                 embedding_genos_url:str = 'https://genos.mnc.ai:3443'):
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
            print(f'Weaviate 접속 중 오류 발생, 접속 정보를 확인하세요. {e}')
        self.collection = 'vdb collection이 설정되지 않았습니다.'
        if not idx:
            print('벡터 인덱스가 설정되지 않았습니다. 벡터 인덱스를 설정하세요.')
        else:
            self.collection = self.client.collections.get(idx)
            print('VDB를 설정했습니다.')
            # print('----VDB 내부 property sample 3개----')
            # for i, obj in enumerate(self.collection.iterator()):
            #     print(obj.properties['text'])
            #     if i == 2:
            #         break
        print(f'유사도 검색을 위한 임베딩 모델로 {embedding_serving_id}번 임베딩 모델을 사용합니다.')
        self.emb = embedding_serving(serving_id = embedding_serving_id, bearer_token = embedding_bearer_token,
                                                   genos_url = embedding_genos_url)
        self.converter = WeaviateGraphQLFilterConverter()
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
    def hybrid_search_with_filter(self, query:str, filter:str = '', topk:int = 4, alpha:float = 0.5):
        filter = self.converter.json_to_filter(filter)
        vector = self.emb.call(query)[0]['embedding']
        if filter:
            try:
                results = [i.properties for i in self.collection.query.hybrid(
                    query=query,
                    vector=vector,
                    alpha=alpha,
                    limit=topk,
                    filters = filter).objects]
            except Exception as e:
                print(f'필터 적용 중 오류 발생: {e}')
                prefix = ['필터가 적용되지 않아 전체 검색 결과를 반환합니다.']
                results = [i.properties for i in self.collection.query.hybrid(query = query,
                                                                        vector = vector,
                                                                        alpha = alpha, limit = topk).objects]
                prefix.extend(results)
                results = prefix
        else:
            prefix = ['필터가 적용되지 않아 전체 검색 결과를 반환합니다.']
            results = [i.properties for i in self.collection.query.hybrid(query = query,
                                                                    vector = vector,
                                                                    alpha = alpha, limit = topk).objects]
            prefix.extend(results)
            results = prefix
        return results
    

class embedding_serving:
        def __init__(self, serving_id:int = 10, bearer_token:str = '1ed5a9dbe58043219b6c1be758910450',
                    genos_url:str = 'https://genos.mnc.ai:3443'):
            self.serving_id = serving_id
            self.url = f"{genos_url}/api/gateway/rep/serving/{serving_id}"
            self.headers = dict(Authorization=f"Bearer {bearer_token}")
            if serving_id and bearer_token:
                print(f'embedding model: {serving_id}번과 토큰이 입력되었습니다.')
            else:
                print('serving id 혹은 인증키가 입력되지 않았습니다.')
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
                print(response.json())
                print(f'embedding 서빙 호출 중 keyerror 발생: {e}')
                return None
            except httpx.RequestError as e:
                print(f'embedding 서빙 호출 중 오류 발생 : {e}')
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
                print(response.json())
                print(f'embedding 서빙 호출 중 keyerror 발생: {e}')
                return None
            except httpx.RequestError as e:
                print(f'embedding 서빙 호출 중 오류 발생 : {e}')
                return None
            return vector