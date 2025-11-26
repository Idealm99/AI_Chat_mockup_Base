"""Legacy shim removed in favor of LangChain MCP adapter."""

from __future__ import annotations


def make_mcp_server_tool(*_: object, **__: object) -> object:
    raise RuntimeError(
        "The deprecated app.tools._mcp_server_tool module is no longer supported. "
        "Please use LangGraph workflows backed by app.mcp.mcp_adapter_client.MCPAdapterClient instead."
    )
