import importlib.util
import json
import pathlib

import pytest
from app.utils import States


WEB_SEARCH_PATH = pathlib.Path(__file__).resolve().parents[1] / "tools" / "web_search.py"
spec = importlib.util.spec_from_file_location("web_search_test_module", WEB_SEARCH_PATH)
assert spec and spec.loader
web_search_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web_search_module)  # type: ignore[arg-type]

_convert_mcp_results = web_search_module._convert_mcp_results


@pytest.fixture()
def empty_states():
    return States()


def test_convert_mcp_results_parses_json_string(empty_states):
    raw_payload = [
        '{"title": "예시 결과", "link": "https://example.com", "summary": "샘플 요약"}'
    ]
    results = _convert_mcp_results(empty_states, raw_payload, "2025-11-18T00:00:00Z")

    assert isinstance(results, list)
    assert len(results) == 1
    first = results[0]
    assert first["title"] == "예시 결과"
    assert first["url"] == "https://example.com"
    assert first["snippet"] == "샘플 요약"


def test_convert_mcp_results_non_json_string_returns_none(empty_states):
    assert _convert_mcp_results(empty_states, "plain text response", "2025-11-18T00:00:00Z") is None


def test_convert_mcp_results_flattens_organic_entries(empty_states):
    payload = [
        json.dumps(
            {
                "search_query": "q",
                "organic_results": [
                    {"title": "A", "link": "https://a", "snippet": "alpha"},
                    {"title": "B", "link": "https://b", "snippet": "beta"},
                ],
            }
        )
    ]

    results = _convert_mcp_results(empty_states, payload, "2025-11-18T00:00:00Z")

    assert isinstance(results, list)
    assert [item["title"] for item in results] == ["A", "B"]
    assert results[0]["url"] == "https://a"
    assert results[1]["snippet"] == "beta"
