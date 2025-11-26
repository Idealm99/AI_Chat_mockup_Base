"""Deprecated OpenFDA MCP wrapper."""

from __future__ import annotations


raise RuntimeError(
	"app.tools.openfda_mcp_server was removed in favor of the MCPAdapter workflow. "
	"Use app.mcp.mcp_adapter_client.MCPAdapterClient to load OpenFDA tools instead."
)
