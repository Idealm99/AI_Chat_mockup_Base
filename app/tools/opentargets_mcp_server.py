"""Deprecated OpenTargets MCP wrapper."""

from __future__ import annotations


raise RuntimeError(
	"app.tools.opentargets_mcp_server was removed in favor of the MCPAdapter workflow. "
	"Use app.mcp.mcp_adapter_client.MCPAdapterClient to load OpenTargets tools instead."
)
