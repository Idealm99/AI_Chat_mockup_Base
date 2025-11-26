"""Deprecated AlphaFold MCP wrapper."""

from __future__ import annotations


raise RuntimeError(
	"app.tools.alphafold_mcp_server was removed in favor of the MCPAdapter workflow. "
	"Use app.mcp.mcp_adapter_client.MCPAdapterClient to load AlphaFold tools instead."
)
