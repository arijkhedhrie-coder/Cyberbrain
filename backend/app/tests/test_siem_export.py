from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.core import event_store
from app.core.siem_export import (
    export_elastic_events,
    export_json_events,
    export_splunk_events,
)


class SiemExportTests(unittest.TestCase):
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

        self.alert = event_store.append_event(
            category="alerts",
            event_type="ALERT_FINAL",
            payload={"severity": "HIGH", "dataset_id": "dataset_auth", "server_id": "server-a"},
            dataset_id="dataset_auth",
            source="websocket_broadcast",
            tags=["websocket", "alert"],
        )
        self.trust = event_store.append_event(
            category="trust",
            event_type="TRUST_COMPUTED",
            payload={"confidence_label": "HIGH", "dataset_id": "dataset_auth"},
            dataset_id="dataset_auth",
            source="session_logger",
            tags=["trust", "analytics"],
        )
        self.corrective = event_store.append_event(
            category="corrective",
            event_type="CORRECTIVE_TOOL_COMPLETED",
            payload={"status": "completed", "dataset_id": "dataset_auth"},
            dataset_id="dataset_auth",
            source="websocket_broadcast",
            tags=["websocket", "corrective"],
        )
        self.fusion = event_store.append_event(
            category="fusion",
            event_type="FUSION_OUTPUT_READY",
            payload={"analysis_only": True, "dataset_id": "__fusion__"},
            dataset_id="__fusion__",
            source="websocket_broadcast",
            tags=["websocket", "fusion"],
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_json_export_preserves_original_schema(self) -> None:
        exported = export_json_events(limit=0)

        self.assertEqual(exported["format"], "json")
        self.assertEqual(exported["count"], 4)
        self.assertEqual([event["event_id"] for event in exported["events"]], [
            self.alert["event_id"],
            self.trust["event_id"],
            self.corrective["event_id"],
            self.fusion["event_id"],
        ])
        self.assertEqual(exported["events"][0], self.alert)
        self.assertIn("timestamp", exported["events"][0])
        self.assertIn("source", exported["events"][0])
        self.assertIn("payload", exported["events"][0])

    def test_elastic_export_builds_compatible_documents(self) -> None:
        exported = export_elastic_events(limit=0, index_prefix="security-events")

        self.assertEqual(exported["format"], "elastic")
        self.assertEqual(exported["count"], 4)
        first = exported["documents"][0]
        self.assertTrue(first["_index"].startswith("security-events-alerts-"))
        self.assertEqual(first["index"], first["_index"])
        self.assertEqual(first["event_type"], "ALERT_FINAL")
        self.assertEqual(first["event"]["category"], "alerts")
        self.assertEqual(first["event"]["type"], ["ALERT_FINAL"])
        self.assertIn("@timestamp", first)
        self.assertEqual(first["payload"]["server_id"], "server-a")
        self.assertTrue(first["metadata"]["siem_export_ready"])

    def test_splunk_export_builds_hec_records(self) -> None:
        exported = export_splunk_events(limit=0, default_source="idps-backend", sourcetype_prefix="idps:event")

        self.assertEqual(exported["format"], "splunk")
        self.assertEqual(exported["count"], 4)
        first = exported["records"][0]
        self.assertIsInstance(first["time"], float)
        self.assertEqual(first["source"], "websocket_broadcast")
        self.assertEqual(first["sourcetype"], "idps:event:alerts")
        self.assertEqual(first["event"]["event_id"], self.alert["event_id"])
        self.assertEqual(first["event"]["event_type"], "ALERT_FINAL")
        self.assertEqual(first["event"]["payload"]["server_id"], "server-a")
        self.assertTrue(first["event"]["metadata"]["siem_export_ready"])


if __name__ == "__main__":
    unittest.main()
