from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
COMPOSE_FILE = REPO_ROOT / "docker-compose.mcp.yml"


@pytest.mark.skipif(not COMPOSE_FILE.exists(), reason="docker-compose.mcp.yml not found")
def test_all_mcp_containers_running():
    """Ensure every MCP service container is up and not stuck restarting."""

    cmd = [
        "docker",
        "compose",
        "-f",
        str(COMPOSE_FILE),
        "ps",
        "--format",
        "json",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)

    entries = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    mcp_entries = [entry for entry in entries if entry.get("Service", "").startswith("mcp-")]
    assert mcp_entries, "No MCP containers were found. Did you run docker compose -f docker-compose.mcp.yml up?"

    unhealthy = {}
    for entry in mcp_entries:
        state = (entry.get("State") or "").lower()
        status = (entry.get("Status") or "").lower()
        if state != "running" or "restarting" in status:
            unhealthy[entry.get("Name", entry.get("Service"))] = entry.get("Status")

    assert not unhealthy, f"Some MCP containers are not healthy: {unhealthy}"
