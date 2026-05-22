from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.routes import dashboard_routes
from app.core import event_store
from app.services import auth_service


class EventFusionApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)

        self._event_store_dir = event_store.EVENT_STORE_DIR
        self._timeline_file = event_store.TIMELINE_FILE
        self._category_files = dict(event_store._CATEGORY_FILES)

        event_store.EVENT_STORE_DIR = root
        event_store.TIMELINE_FILE = root / "timeline.jsonl"
        event_store._CATEGORY_FILES = {
            "alerts": root / "alerts.jsonl",
            "trust": root / "trust.jsonl",
            "corrective": root / "corrective.jsonl",
            "fusion": root / "fusion.jsonl",
        }

        self._env = patch.dict(
            os.environ,
            {
                "WS_REDIS_ENABLED": "false",
                "WS_FALLBACK_ENABLED": "false",
            },
            clear=False,
        )
        self._env.start()

        self._seed_events()

    def tearDown(self) -> None:
        self._env.stop()
        event_store.EVENT_STORE_DIR = self._event_store_dir
        event_store.TIMELINE_FILE = self._timeline_file
        event_store._CATEGORY_FILES = self._category_files
        self._tmp.cleanup()

    def _seed_events(self) -> None:
        event_store.append_event(
            category="alerts",
            event_type="ALERT_PASS1",
            payload={
                "timestamp": "2026-05-21T10:00:00Z",
                "dataset_id": "ds-a",
                "source_ip": "1.2.3.4",
                "engine": "SSH",
                "type": "BRUTE_FORCE",
                "severity": "HIGH",
                "score": 80,
                "stage": "pass1",
                "message": "Repeated SSH failures",
            },
            dataset_id="ds-a",
            source="test",
        )
        event_store.append_event(
            category="alerts",
            event_type="ALERT_FINAL",
            payload={
                "timestamp": "2026-05-21T10:00:00Z",
                "dataset_id": "ds-a",
                "source_ip": "1.2.3.4",
                "engine": "SSH",
                "type": "BRUTE_FORCE",
                "severity": "CRITICAL",
                "score": 92,
                "stage": "final",
                "message": "Repeated SSH failures",
            },
            dataset_id="ds-a",
            source="test",
        )
        event_store.append_event(
            category="alerts",
            event_type="ALERT_FINAL",
            payload={
                "timestamp": "2026-05-21T10:03:00Z",
                "dataset_id": "ds-b",
                "source_ip": "1.2.3.4",
                "engine": "SSH",
                "type": "BRUTE_FORCE",
                "severity": "HIGH",
                "score": 87,
                "stage": "final",
                "message": "Repeated SSH failures on second dataset",
            },
            dataset_id="ds-b",
            source="test",
        )
        event_store.append_event(
            category="fusion",
            event_type="FUSION_OUTPUT_READY",
            payload={
                "timestamp": "2026-05-21T10:04:00Z",
                "dataset_id": "__fusion__",
                "title": "Fusion overlay ready",
            },
            dataset_id="__fusion__",
            source="test",
        )

    def test_read_only_fusion_endpoints_support_fusion_alias(self) -> None:
        with TestClient(auth_service.app) as client:
            summary = client.get("/api/events/fusion/summary", params={"dataset": "fusion"})
            timeline = client.get("/api/events/fusion/timeline", params={"dataset": "fusion"})
            attackers = client.get("/api/events/fusion/top-attackers", params={"dataset": "fusion", "top_n": 5})
            risk = client.get("/api/events/fusion/risk-score", params={"dataset": "fusion"})

        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertEqual(timeline.status_code, 200, timeline.text)
        self.assertEqual(attackers.status_code, 200, attackers.text)
        self.assertEqual(risk.status_code, 200, risk.text)

        summary_json = summary.json()
        timeline_json = timeline.json()
        attackers_json = attackers.json()
        risk_json = risk.json()

        self.assertTrue(summary_json["available"])
        self.assertEqual(summary_json["generated_from"], "event_store")
        self.assertEqual(summary_json["dataset_id"], "fusion")
        self.assertEqual(summary_json["attacker_count"], 1)

        self.assertEqual(timeline_json["dataset_id"], "fusion")
        self.assertEqual(timeline_json["count"], 1)
        self.assertEqual(timeline_json["timeline"][0]["attacker_count"], 1)

        self.assertEqual(attackers_json["dataset_id"], "fusion")
        self.assertEqual(attackers_json["count"], 1)
        self.assertEqual(attackers_json["attackers"][0]["ip"], "1.2.3.4")

        self.assertEqual(risk_json["dataset_id"], "fusion")
        self.assertEqual(risk_json["count"], 1)
        self.assertGreater(risk_json["points"][0]["risk_score"], 0.0)

    def test_dataset_selector_exposes_fusion_without_legacy_merged_payload(self) -> None:
        with patch.object(dashboard_routes, "_available_dataset_ids", return_value=["ds-a", "ds-b"]):
            with patch.dict(dashboard_routes.PIPELINE_RESULTS, {}, clear=True):
                with TestClient(auth_service.app) as client:
                    rich = client.get("/api/datasets", params={"format": "rich"})
                    plain = client.get("/api/datasets")

        self.assertEqual(rich.status_code, 200, rich.text)
        self.assertEqual(plain.status_code, 200, plain.text)

        rich_json = rich.json()
        plain_json = plain.json()

        self.assertIn("fusion", plain_json)
        self.assertEqual(rich_json[-1]["id"], "fusion")
        self.assertEqual(rich_json[-1]["display"], "FUSION VIEW")
        self.assertEqual(rich_json[-1]["sources"], ["ds-a", "ds-b"])


if __name__ == "__main__":
    unittest.main()
