from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.core import event_store


class EventStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        event_store.EVENT_STORE_DIR = root
        event_store.TIMELINE_FILE = root / "timeline.jsonl"
        event_store._CATEGORY_FILES = {
            "alerts": root / "alerts.jsonl",
            "trust": root / "trust.jsonl",
            "corrective": root / "corrective.jsonl",
            "fusion": root / "fusion.jsonl",
        }

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_append_replay_and_analytics(self) -> None:
        first = event_store.append_event(
            category="alerts",
            event_type="ALERT_PASS1",
            payload={"severity": "HIGH", "dataset_id": "dataset_auth", "server_id": "dataset_auth"},
            dataset_id="dataset_auth",
            source="test",
        )
        event_store.append_event(
            category="fusion",
            event_type="FUSION_OUTPUT_READY",
            payload={"severity": "INFO", "dataset_id": "__fusion__"},
            dataset_id="__fusion__",
            source="test",
        )

        replay = event_store.replay_timeline(after_event_id=first["event_id"], limit=10)
        self.assertEqual(len(replay), 1)
        self.assertEqual(replay[0]["category"], "fusion")

        fusion_alias = event_store.replay_timeline(categories=["fusion"], dataset_id="fusion", limit=10)
        self.assertEqual(len(fusion_alias), 1)
        self.assertEqual(fusion_alias[0]["event_type"], "FUSION_OUTPUT_READY")

        analytics = event_store.build_analytics(limit=10)
        self.assertEqual(analytics["categories"]["alerts"], 1)
        self.assertEqual(analytics["categories"]["fusion"], 1)
        self.assertTrue(analytics["siem_export_ready"])


if __name__ == "__main__":
    unittest.main()
