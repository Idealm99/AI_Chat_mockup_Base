import importlib.util

import pytest

_REQUIRED_MODULES = ("langgraph", "rapidfuzz", "redis.asyncio", "html2text")
_missing_dep = next((dep for dep in _REQUIRED_MODULES if importlib.util.find_spec(dep) is None), None)

pytestmark = pytest.mark.skipif(
    _missing_dep is not None,
    reason=f"Missing optional dependency: {_missing_dep}",
)

if _missing_dep is None:
    from app.langgraph_agent import LangGraphSearchAgent
else:  # pragma: no cover - the module is skipped when dependencies are absent
    class LangGraphSearchAgent:  # type: ignore[override]
        ...


def _make_agent() -> LangGraphSearchAgent:
    # Bypass __init__ to avoid loading external services during tests.
    return LangGraphSearchAgent.__new__(LangGraphSearchAgent)


def test_structure_panel_builds_pdb_url_from_summary_text():
    agent = _make_agent()
    workflow_results = {
        "StructureAgent": {
            "AlphaFold:get_structure_info": [
                {
                    "summary": "The BRCA1 protein structure with PDB ID 3fa2 has been identified and analyzed.",
                    "details": "High quality structure. PDB Id 3fa2 is suitable for docking studies.",
                }
            ]
        }
    }
    state = {}

    panel = agent._build_structure_panel(
        workflow_results=workflow_results,
        target_name="BRCA1",
        compound_name="Lead compound",
        state=state,
    )

    assert panel is not None
    assert panel["pdbUrl"] == "https://files.rcsb.org/download/3FA2.pdb"
    assert panel["pdbId"] == "3FA2"
    assert state["visualization"]["pdb_url"].endswith("3FA2.pdb")


def test_extract_pdb_id_detects_mixed_case_identifier():
    agent = _make_agent()
    text = "Structure code: pdb Id 1abz shows strong binding."

    extracted = agent._extract_pdb_id_from_text(text)

    assert extracted == "1ABZ"
