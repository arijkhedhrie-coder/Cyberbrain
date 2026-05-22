import json
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException


ROOT = os.path.dirname(os.path.dirname(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.api.routes import corrective as corrective_route  # noqa: E402
from app.api.routes.corrective import (  # noqa: E402
    ValidationDecision,
    _pending_suggestions,
    _persist_pending_suggestions,
    _upsert_pending_suggestion,
    validate_suggestion,
)
from app.ai.agents.trust_gate import should_adapt  # noqa: E402


class TestCorrectiveHardening(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._env = patch.dict(
            os.environ,
            {"CORRECTIVE_SUGGESTIONS_FILE": os.path.join(self._tmp.name, "suggestions.json")},
            clear=False,
        )
        self._env.start()
        _pending_suggestions.clear()
        _persist_pending_suggestions()

    def tearDown(self) -> None:
        _pending_suggestions.clear()
        _persist_pending_suggestions()
        self._env.stop()
        self._tmp.cleanup()

    def _store_fail2ban_suggestion(self) -> str:
        suggestion_id = "sug-banip"
        _upsert_pending_suggestion(
            {
                "suggestion_id": suggestion_id,
                "anomaly_type": "BRUTE-FORCE SSH",
                "ip": "1.2.3.4",
                "severity": "CRITICAL",
                "action_type": "BAN_FAIL2BAN",
                "dataset_id": "dataset-a",
                "command": "fail2ban-client set sshd banip 1.2.3.4",
                "description": "Ban attacking IP",
                "confidence": 0.93,
                "mode": "SUGGESTION",
                "timestamp": "2026-05-22T00:00:00",
                "status": "PENDING",
            }
        )
        return suggestion_id

    def test_validate_approve_uses_structured_executor(self) -> None:
        suggestion_id = self._store_fail2ban_suggestion()

        with patch.object(corrective_route, "_is_linux", return_value=True):
            with patch.object(corrective_route, "_broadcast_activity", return_value=None):
                with patch.object(corrective_route, "_broadcast_corrective_result", return_value=None):
                    with patch.object(corrective_route, "learn_from_feedback", return_value=None):
                        with patch.object(
                            corrective_route.subprocess,
                            "run",
                            return_value=SimpleNamespace(stdout="ok", stderr=""),
                        ) as run_mock:
                            result = validate_suggestion(
                                ValidationDecision(
                                    suggestion_id=suggestion_id,
                                    decision="APPROVE",
                                )
                            )

        self.assertEqual(result["status"], "EXECUTED")
        self.assertEqual(run_mock.call_args.args[0], ["fail2ban-client", "set", "sshd", "banip", "1.2.3.4"])
        self.assertFalse(run_mock.call_args.kwargs["shell"])

    def test_validate_modify_rejects_command_outside_allowlist(self) -> None:
        suggestion_id = self._store_fail2ban_suggestion()

        with self.assertRaises(HTTPException) as ctx:
            validate_suggestion(
                ValidationDecision(
                    suggestion_id=suggestion_id,
                    decision="MODIFY",
                    modified_command="echo hacked",
                )
            )

        self.assertEqual(ctx.exception.status_code, 400)

    def test_trust_gate_uses_actual_anomaly_type(self) -> None:
        with patch(
            "app.ai.agents.trust_gate.compute_session_stability",
            return_value={"confidence": "HIGH", "stable_signals": 3, "drift_flagged": False},
        ):
            with patch("app.ai.agents.trust_gate.get_success_rate", return_value=0.82) as success_rate:
                result = should_adapt(
                    context="CORRECTIVE_ACTION",
                    dataset_id="dataset-a",
                    anomaly_type="PORT SCAN",
                )

        self.assertTrue(result["allow"])
        self.assertEqual(result["anomaly_type"], "PORT SCAN")
        success_rate.assert_called_once_with("PORT SCAN", dataset_id="dataset-a")

    def test_trust_gate_allows_suggestion_mode_with_medium_stability(self) -> None:
        with patch(
            "app.ai.agents.trust_gate.compute_session_stability",
            return_value={"confidence": "MEDIUM", "stable_signals": 2, "drift_flagged": False},
        ):
            with patch("app.ai.agents.trust_gate.get_success_rate", return_value=0.82):
                result = should_adapt(
                    context="CORRECTIVE_ACTION",
                    dataset_id="dataset-a",
                    anomaly_type="PORT SCAN",
                    corrective_mode="SUGGESTION",
                )

        self.assertTrue(result["allow"])
        self.assertEqual(result["corrective_mode"], "SUGGESTION")

    def test_trust_gate_keeps_auto_mode_strict(self) -> None:
        with patch(
            "app.ai.agents.trust_gate.compute_session_stability",
            return_value={"confidence": "MEDIUM", "stable_signals": 2, "drift_flagged": False},
        ):
            with patch("app.ai.agents.trust_gate.get_success_rate", return_value=0.82):
                result = should_adapt(
                    context="CORRECTIVE_ACTION",
                    dataset_id="dataset-a",
                    anomaly_type="PORT SCAN",
                    corrective_mode="AUTO",
                )

        self.assertFalse(result["allow"])
        self.assertEqual(result["corrective_mode"], "AUTO")
        self.assertIn("MEDIUM < HIGH", result["reason"])

    def test_auto_mode_blocks_without_history(self) -> None:
        try:
            from app.ai.agents import agents as corrective_agents
        except Exception as exc:  # pragma: no cover - depends on local AI deps
            self.skipTest(f"agents module unavailable: {exc}")

        tool = corrective_agents.OutilActionCorrective()
        anomaly = {
            "type": "BRUTE-FORCE SSH",
            "ip": "1.2.3.4",
            "severite": "CRITIQUE",
        }

        with patch.object(corrective_agents, "AGENT_MODE", "AUTO"):
            with patch.object(corrective_agents, "_appeler_mcp", return_value=""):
                with patch.object(corrective_agents, "get_success_rate", return_value=0.0):
                    raw = tool._run(anomalie_json=json.dumps(anomaly))

        payload = json.loads(raw)
        self.assertEqual(payload["mode"], "AUTO_BLOCKED")
        self.assertFalse(payload["executed"])
        self.assertIn("historique", payload["reason"].lower())


if __name__ == "__main__":
    unittest.main()
