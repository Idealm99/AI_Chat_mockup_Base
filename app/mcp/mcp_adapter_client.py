from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
from typing import Dict, Iterable, List, Sequence

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.tools import load_mcp_tools

from app.logger import get_logger
from app.mcp.mcp_tools import LocalServerEntry, _parse_local_server_config

log = get_logger(__name__)


@dataclass(frozen=True)
class ResolvedMCPTool:
    """Container that keeps the originating MCP server with the converted tool."""

    server_name: str
    tool: BaseTool

    @property
    def label(self) -> str:
        return f"{self.server_name}:{self.tool.name}"


class MCPAdapterClient:
    """Loads LangChain tools from local MCP servers on demand."""

    def __init__(self) -> None:
        self._servers = self._load_server_entries()
        self._tool_cache: Dict[str, List[BaseTool]] = {}
        self._locks: Dict[str, asyncio.Lock] = {}

    @staticmethod
    def _load_server_entries() -> Dict[str, LocalServerEntry]:
        entries = _parse_local_server_config()
        if not entries:
            log.warning("로컬 MCP 서버 구성이 비어 있습니다. config/mcp_servers.local.json을 확인하세요.")
            return {}
        return {entry.name: entry for entry in entries}

    def refresh(self) -> None:
        """Reload server definitions and clear cached tools."""
        self._servers = self._load_server_entries()
        self._tool_cache.clear()
        self._locks.clear()

    def available_servers(self) -> List[str]:
        return list(self._servers.keys())

    def has_server(self, server_name: str) -> bool:
        return server_name in self._servers

    async def get_stage_tools(self, server_names: Sequence[str]) -> List[ResolvedMCPTool]:
        ordered_servers = self._dedupe(server_names)
        resolved: List[ResolvedMCPTool] = []
        if not ordered_servers:
            return resolved
        for server_name in ordered_servers:
            tools = await self._get_tools_for_server(server_name)
            resolved.extend(ResolvedMCPTool(server_name=server_name, tool=tool) for tool in tools)
        return resolved

    async def _get_tools_for_server(self, server_name: str) -> List[BaseTool]:
        cached = self._tool_cache.get(server_name)
        if cached is not None:
            return cached

        entry = self._servers.get(server_name)
        if entry is None:
            log.warning("요청된 MCP 서버를 찾을 수 없습니다.", extra={"server": server_name})
            self._tool_cache[server_name] = []
            return []

        lock = self._locks.setdefault(server_name, asyncio.Lock())
        async with lock:
            cached = self._tool_cache.get(server_name)
            if cached is not None:
                return cached

            connection = copy.deepcopy(entry.connection)
            try:
                tools = await load_mcp_tools(
                    session=None,
                    connection=connection,
                    server_name=server_name,
                )
            except Exception:
                log.exception("MCP 서버에서 LangChain 도구를 불러오지 못했습니다.", extra={"server": server_name})
                tools = []

            self._tool_cache[server_name] = tools
            return tools

    @staticmethod
    def _dedupe(values: Iterable[str]) -> List[str]:
        seen = set()
        ordered: List[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            ordered.append(value)
        return ordered


__all__ = ["MCPAdapterClient", "ResolvedMCPTool"]
