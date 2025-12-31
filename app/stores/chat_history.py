import sqlite3
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Union, Dict, Any
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from app.logger import get_logger

log = get_logger(__name__)

# Docker 환경과 로컬 환경 모두 지원
if os.getenv("DOCKER_ENV"):
    # Docker 환경: /app 경로 사용
    DB_PATH = "/data/chat_history.db"
else:
    # 로컬 환경: 프로젝트 루트에 생성
    DB_PATH = str(Path(__file__).parent.parent.parent / "chat_history.db")


class ChatHistoryStore:
    """SQLite 기반의 채팅 히스토리 저장소 - LangChain 멀티턴 대화 지원"""
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        # 디렉토리가 없으면 생성
        db_dir = os.path.dirname(self.db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
        self._init_db()
    
    def _ensure_column(self, cursor: sqlite3.Cursor, table: str, column: str, definition: str) -> None:
        cursor.execute(f"PRAGMA table_info({table})")
        columns = [row[1] for row in cursor.fetchall()]
        if column not in columns:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def _init_db(self):
        """데이터베이스 초기화"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # 채팅 세션 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    chat_id TEXT PRIMARY KEY,
                    user_id TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    title TEXT
                )
            ''')
            
            # 메시지 테이블
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (chat_id) REFERENCES chat_sessions(chat_id)
                )
            ''')
            
            # 스키마 확장: metadata 및 usage 컬럼이 없으면 추가
            self._ensure_column(cursor, "chat_messages", "metadata", "TEXT")
            self._ensure_column(cursor, "chat_sessions", "prompt_tokens", "INTEGER DEFAULT 0")
            self._ensure_column(cursor, "chat_sessions", "completion_tokens", "INTEGER DEFAULT 0")
            self._ensure_column(cursor, "chat_sessions", "total_tokens", "INTEGER DEFAULT 0")
            self._ensure_column(cursor, "chat_sessions", "cost", "REAL DEFAULT 0")

            # 인덱싱
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_chat_id ON chat_messages(chat_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_id ON chat_sessions(user_id)')
            
            conn.commit()
            conn.close()
            log.info(f"Chat history database initialized at {self.db_path}")
        except Exception as e:
            log.error(f"Failed to initialize database: {e}")
            raise
    
    async def get_chat_history(self, chat_id: str, limit: int = 10) -> List[dict]:
        """
        특정 채팅 세션의 메시지 히스토리 조회
        최근 limit개 메시지만 반환 (기본값: 10개 - 멀티턴 윈도우)
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # 총 메시지 수 조회
            cursor.execute('SELECT COUNT(*) FROM chat_messages WHERE chat_id = ?', (chat_id,))
            total_count = cursor.fetchone()[0]
            
            # 최근 limit개만 가져오기
            offset = max(0, total_count - limit)
            
            cursor.execute('''
                SELECT id, role, content, created_at, metadata
                FROM chat_messages
                WHERE chat_id = ?
                ORDER BY id ASC
                LIMIT ? OFFSET ?
            ''', (chat_id, limit, offset))
            
            messages = []
            rows = cursor.fetchall()

            for row in rows:
                # row: id, role, content, created_at, metadata
                _id, role, content, created_at, metadata_json = row
                msg = {
                    "id": _id,
                    "role": role,
                    "content": content,
                    "created_at": created_at,
                }
                if metadata_json:
                    try:
                        msg["metadata"] = json.loads(metadata_json)
                    except Exception:
                        msg["metadata"] = {"raw": metadata_json}
                else:
                    msg["metadata"] = None
                messages.append(msg)
            
            conn.close()
            return messages
        except Exception as e:
            log.error(f"Failed to get chat history: {e}")
            return []
    
    @staticmethod
    def _generate_title(source: Optional[str], max_length: int = 60) -> Optional[str]:
        if not source:
            return None
        cleaned = " ".join(source.strip().split())
        if not cleaned:
            return None
        if len(cleaned) > max_length:
            return cleaned[:max_length].rstrip() + "…"
        return cleaned

    async def save_message(
        self,
        chat_id: str,
        role: str,
        content: str,
        *,
        user_id: Optional[str] = None,
        title: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """메시지 저장"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # 세션 존재 여부 확인, 없으면 생성
            cursor.execute('SELECT user_id, title FROM chat_sessions WHERE chat_id = ?', (chat_id,))
            row = cursor.fetchone()
            title_candidate = title or (self._generate_title(content) if role == "user" else None)

            if not row:
                cursor.execute(
                    '''
                    INSERT INTO chat_sessions (chat_id, user_id, title, created_at, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ''',
                    (chat_id, user_id, title_candidate),
                )
            else:
                existing_user_id, existing_title = row
                set_clauses = []
                params: List[Any] = []
                if user_id and not existing_user_id:
                    set_clauses.append("user_id = ?")
                    params.append(user_id)
                if title_candidate and not existing_title:
                    set_clauses.append("title = ?")
                    params.append(title_candidate)
                set_clauses.append("updated_at = CURRENT_TIMESTAMP")
                update_sql = f"UPDATE chat_sessions SET {', '.join(set_clauses)} WHERE chat_id = ?"
                params.append(chat_id)
                cursor.execute(update_sql, params)
            
            # 메시지 저장
            metadata_json = json.dumps(metadata, ensure_ascii=False) if metadata else None
            cursor.execute(
                '''
                INSERT INTO chat_messages (chat_id, role, content, metadata)
                VALUES (?, ?, ?, ?)
                ''',
                (chat_id, role, content, metadata_json),
            )
            
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            log.error(f"Failed to save message: {e}")
            return False
    
    async def save_messages(
        self,
        chat_id: str,
        messages: List[dict],
        *,
        user_id: Optional[str] = None,
        title: Optional[str] = None,
    ) -> bool:
        """여러 메시지 일괄 저장"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # 세션 존재 여부 확인, 없으면 생성
            cursor.execute('SELECT user_id, title FROM chat_sessions WHERE chat_id = ?', (chat_id,))
            row = cursor.fetchone()
            title_candidate = title
            if not title_candidate:
                for msg in messages:
                    if msg.get('role') == 'user':
                        title_candidate = self._generate_title(msg.get('content'))
                        if title_candidate:
                            break

            if not row:
                cursor.execute(
                    '''
                    INSERT INTO chat_sessions (chat_id, user_id, title, created_at, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ''',
                    (chat_id, user_id, title_candidate),
                )
            else:
                existing_user_id, existing_title = row
                set_clauses = []
                params: List[Any] = []
                if user_id and not existing_user_id:
                    set_clauses.append("user_id = ?")
                    params.append(user_id)
                if title_candidate and not existing_title:
                    set_clauses.append("title = ?")
                    params.append(title_candidate)
                set_clauses.append("updated_at = CURRENT_TIMESTAMP")
                update_sql = f"UPDATE chat_sessions SET {', '.join(set_clauses)} WHERE chat_id = ?"
                params.append(chat_id)
                cursor.execute(update_sql, params)
            
            # 메시지 저장
            for msg in messages:
                role = msg.get('role')
                content = msg.get('content', '')
                metadata_json = None
                if 'metadata' in msg and msg['metadata'] is not None:
                    try:
                        metadata_json = json.dumps(msg['metadata'], ensure_ascii=False)
                    except Exception:
                        metadata_json = json.dumps({'fallback': str(msg['metadata'])}, ensure_ascii=False)

                cursor.execute(
                    '''
                    INSERT INTO chat_messages (chat_id, role, content, metadata)
                    VALUES (?, ?, ?, ?)
                    ''',
                    (chat_id, role, content, metadata_json),
                )
            
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            log.error(f"Failed to save messages: {e}")
            return False

    async def update_session_usage(
        self,
        chat_id: str,
        usage: Optional[Dict[str, Any]] = None,
        cost: Optional[float] = None,
    ) -> bool:
        """세션별 토큰/비용 누적 업데이트"""
        try:
            prompt_delta = int((usage or {}).get("prompt_tokens") or 0)
            completion_delta = int((usage or {}).get("completion_tokens") or 0)
            total_delta = int((usage or {}).get("total_tokens") or 0)
            cost_delta = float(cost or 0)

            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute(
                '''
                UPDATE chat_sessions
                SET prompt_tokens = prompt_tokens + ?,
                    completion_tokens = completion_tokens + ?,
                    total_tokens = total_tokens + ?,
                    cost = cost + ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE chat_id = ?
                ''',
                (prompt_delta, completion_delta, total_delta, cost_delta, chat_id),
            )

            if cursor.rowcount == 0:
                cursor.execute(
                    '''
                    INSERT INTO chat_sessions (
                        chat_id,
                        prompt_tokens,
                        completion_tokens,
                        total_tokens,
                        cost,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ''',
                    (chat_id, prompt_delta, completion_delta, total_delta, cost_delta),
                )

            conn.commit()
            conn.close()
            return True
        except Exception as e:
            log.error(f"Failed to update session usage: {e}")
            return False
    
    async def clear_chat_history(self, chat_id: str) -> bool:
        """채팅 히스토리 삭제"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('DELETE FROM chat_messages WHERE chat_id = ?', (chat_id,))
            cursor.execute('DELETE FROM chat_sessions WHERE chat_id = ?', (chat_id,))
            
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            log.error(f"Failed to clear chat history: {e}")
            return False
    
    async def get_session_count(self, user_id: Optional[str] = None) -> int:
        """세션 수 조회"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            if user_id:
                cursor.execute('SELECT COUNT(*) FROM chat_sessions WHERE user_id = ?', (user_id,))
            else:
                cursor.execute('SELECT COUNT(*) FROM chat_sessions')
            
            count = cursor.fetchone()[0]
            conn.close()
            return count
        except Exception as e:
            log.error(f"Failed to get session count: {e}")
            return 0
    
    async def get_chat_history_as_messages(self, chat_id: str, limit: int = 10) -> List[BaseMessage]:
        """
        특정 채팅 세션의 메시지 히스토리를 LangChain 메시지 객체 리스트로 조회
        """
        history = await self.get_chat_history(chat_id, limit)
        messages = []
        for msg in history:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "user":
                messages.append(HumanMessage(content=content))
            elif role == "assistant" or role == "ai":
                messages.append(AIMessage(content=content))
            elif role == "system":
                messages.append(SystemMessage(content=content))
            else:
                messages.append(BaseMessage(content=content, type=role))
        return messages

    async def list_sessions(self, user_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """최근 채팅 세션 목록 조회"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            params: List[Any] = []
            query = (
                "SELECT chat_id, title, updated_at, prompt_tokens, completion_tokens, total_tokens, cost, "
                "(SELECT content FROM chat_messages WHERE chat_id = chat_sessions.chat_id ORDER BY id DESC LIMIT 1) as last_message "
                "FROM chat_sessions"
            )
            if user_id:
                query += " WHERE user_id = ?"
                params.append(user_id)
            query += " ORDER BY updated_at DESC LIMIT ?"
            params.append(limit)
            cursor.execute(query, params)
            rows = cursor.fetchall()
            conn.close()
            sessions = []
            for row in rows:
                chat_id, title, updated_at, prompt_tokens, completion_tokens, total_tokens, cost, last_message = row
                sessions.append(
                    {
                        "chat_id": chat_id,
                        "title": title,
                        "updated_at": updated_at,
                        "prompt_tokens": prompt_tokens or 0,
                        "completion_tokens": completion_tokens or 0,
                        "total_tokens": total_tokens or 0,
                        "cost": cost or 0.0,
                        "last_message": last_message,
                    }
                )
            return sessions
        except Exception as e:
            log.error(f"Failed to list chat sessions: {e}")
            return []
