import os
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException


ROOT = os.path.dirname(os.path.dirname(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.api.routes.corrective import (  # noqa: E402
    SuggestionPayload,
    ValidationDecision,
    _load_pending_suggestions,
    _pending_suggestions,
    _persist_pending_suggestions,
    _upsert_pending_suggestion,
    get_stats,
    store_suggestion,
    validate_suggestion,
)


class TestCorrectiveScope(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._env = patch.dict(
            os.environ,
            {"CORRECTIVE_SUGGESTIONS_FILE": os.path.join(self._tmp.name, "suggestions.json")},
            clear=False,
        )
        self._env.start()
        _pending_suggestions.clear()
        _persist_pending_suggestions()

    def tearDown(self):
        _pending_suggestions.clear()
        _persist_pending_suggestions()
        self._env.stop()
        self._tmp.cleanup()

    def test_store_suggestion_rejects_fusion_scope(self):
        with self.assertRaises(HTTPException) as ctx:
            store_suggestion(
                SuggestionPayload(
                    anomaly_type="CROSS_DATASET_IP_CORRELATION",
                    ip="1.2.3.4",
                    severity="HIGH",
                    action_type="BLOCK_NOW",
                    dataset_id="__fusion__",
                    description="Should never execute from fusion",
                    confidence=0.9,
                    mode="SUGGESTION",
                )
            )

        self.assertEqual(ctx.exception.status_code, 400)

    def test_validate_suggestion_rejects_fusion_scope(self):
        _pending_suggestions["sug-fusion"] = {
            "suggestion_id": "sug-fusion",
            "dataset_id": "__fusion__",
            "command": "echo blocked",
            "description": "Invalid fusion action",
            "severity": "HIGH",
            "action_type": "BLOCK_NOW",
            "anomaly_type": "CROSS_DATASET_IP_CORRELATION",
            "confidence": 0.99,
            "status": "PENDING",
        }

        with self.assertRaises(HTTPException) as ctx:
            validate_suggestion(
                ValidationDecision(
                    suggestion_id="sug-fusion",
                    decision="APPROVE",
                )
            )

        self.assertEqual(ctx.exception.status_code, 400)

    def test_fusion_stats_are_analysis_only(self):
        stats = get_stats(dataset="fusion")
        self.assertTrue(stats["memory"]["analysis_only"])
        self.assertEqual(stats["memory"]["dataset_id"], "__fusion__")

    def test_suggestions_are_persisted_and_reloaded(self):
        suggestion_id = "sug-persisted"
        _upsert_pending_suggestion(
            {
                "suggestion_id": suggestion_id,
                "anomaly_type": "PORT SCAN",
                "ip": "1.2.3.4",
                "severity": "HIGH",
                "action_type": "BLACKLIST_IP",
                "dataset_id": "dataset-a",
                "command": "iptables -A INPUT -s 1.2.3.4 -j DROP && echo '1.2.3.4' >> /etc/blacklist.txt",
                "description": "Persist me",
                "confidence": 0.91,
                "mode": "SUGGESTION",
                "timestamp": "2026-05-22T00:00:00",
                "status": "PENDING",
            }
        )

        self.assertIn(suggestion_id, _pending_suggestions)
        _pending_suggestions.clear()
        _load_pending_suggestions()

        self.assertIn(suggestion_id, _pending_suggestions)
        self.assertEqual(_pending_suggestions[suggestion_id]["status"], "PENDING")


if __name__ == "__main__":
    unittest.main()
