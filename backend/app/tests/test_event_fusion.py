from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.core import event_store
from app.core.event_fusion import (
    fusion_risk_score,
    fusion_summary,
    fusion_timeline,
    fusion_top_attackers,
)


class EventFusionTests(unittest.TestCase):
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

    def _write(self, record: dict) -> None:
        line = json.dumps(record, ensure_ascii=False)
        event_store.EVENT_STORE_DIR.mkdir(parents=True, exist_ok=True)
        with event_store.TIMELINE_FILE.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        category_file = event_store._CATEGORY_FILES[record["category"]]
        with category_file.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    def _seed_records(self) -> None:
        records = [
            {
                "event_id": "evt-pass1-1",
                "category": "alerts",
                "event_type": "ALERT_PASS1",
                "timestamp": "2026-05-21T10:00:10Z",
                "dataset_id": "ds-a",
                "source": "test",
                "tags": ["alert"],
                "schema_version": 1,
                "siem_export_ready": True,
                "payload": {
                    "timestamp": "2026-05-21T10:00:00Z",
                    "dataset_id": "ds-a",
                    "source_ip": "1.2.3.4",
                    "engine": "SSH",
                    "type": "BRUTE_FORCE",
                    "severity": "HIGH",
                    "score": 82,
                    "stage": "pass1",
                    "message": "Repeated SSH failures",
                },
            },
            {
                "event_id": "evt-final-1",
                "category": "alerts",
                "event_type": "ALERT_FINAL",
                "timestamp": "2026-05-21T10:00:40Z",
                "dataset_id": "ds-a",
                "source": "test",
                "tags": ["alert"],
                "schema_version": 1,
                "siem_export_ready": True,
                "payload": {
                    "timestamp": "2026-05-21T10:00:00Z",
                    "dataset_id": "ds-a",
                    "source_ip": "1.2.3.4",
                    "engine": "SSH",
                    "type": "BRUTE_FORCE",
                    "severity": "CRITICAL",
                    "score": 91,
                    "stage": "final",
                    "message": "Repeated SSH failures",
                },
            },
            {
                "event_id": "evt-final-2",
                "category": "alerts",
                "event_type": "ALERT_FINAL",
                "timestamp": "2026-05-21T10:03:00Z",
                "dataset_id": "ds-b",
                "source": "test",
                "tags": ["alert"],
                "schema_version": 1,
                "siem_export_ready": True,
                "payload": {
                    "timestamp": "2026-05-21T10:03:00Z",
                    "dataset_id": "ds-b",
                    "source_ip": "1.2.3.4",
                    "engine": "SSH",
                    "type": "BRUTE_FORCE",
                    "severity": "HIGH",
                    "score": 88,
                    "stage": "final",
                    "message": "Repeated SSH failures on second dataset",
                },
            },
            {
                "event_id": "evt-final-3",
                "category": "alerts",
                "event_type": "ALERT_FINAL",
                "timestamp": "2026-05-21T10:04:00Z",
                "dataset_id": "ds-a",
                "source": "test",
                "tags": ["alert"],
                "schema_version": 1,
                "siem_export_ready": True,
                "payload": {
                    "timestamp": "2026-05-21T10:04:00Z",
                    "dataset_id": "ds-a",
                    "source_ip": "1.2.3.4",
                    "engine": "WEB",
                    "type": "WEB_SCAN",
                    "severity": "HIGH",
                    "score": 79,
                    "stage": "final",
                    "message": "Path scanning from same IP",
                },
            },
            {
                "event_id": "evt-final-4",
                "category": "alerts",
                "event_type": "ALERT_FINAL",
                "timestamp": "2026-05-21T10:06:00Z",
                "dataset_id": "ds-c",
                "source": "test",
                "tags": ["alert"],
                "schema_version": 1,
                "siem_export_ready": True,
                "payload": {
                    "timestamp": "2026-05-21T10:06:00Z",
                    "dataset_id": "ds-c",
                    "source_ip": "5.6.7.8",
                    "engine": "FTP",
                    "type": "DATA_EXFIL",
                    "severity": "CRITICAL",
                    "score": 96,
                    "stage": "final",
                    "message": "Large FTP transfer",
                },
            },
            {
                "event_id": "evt-final-5",
                "category": "alerts",
                "event_type": "ALERT_FINAL",
                "timestamp": "2026-05-21T12:05:00Z",
                "dataset_id": "ds-a",
                "source": "test",
                "tags": ["alert"],
                "schema_version": 1,
                "siem_export_ready": True,
                "payload": {
                    "timestamp": "2026-05-21T12:05:00Z",
                    "dataset_id": "ds-a",
                    "source_ip": "1.2.3.4",
                    "engine": "SSH",
                    "type": "BRUTE_FORCE",
                    "severity": "HIGH",
                    "score": 86,
                    "stage": "final",
                    "message": "Repeated SSH failures after quiet period",
                },
            },
            {
                "event_id": "evt-trust-1",
                "category": "trust",
                "event_type": "TRUST_COMPUTED",
                "timestamp": "2026-05-21T10:02:00Z",
                "dataset_id": "ds-a",
                "source": "test",
                "tags": ["trust"],
                "schema_version": 1,
                "siem_export_ready": True,
                "payload": {
                    "timestamp": "2026-05-21T10:02:00Z",
                    "dataset_id": "ds-a",
                    "confidence_label": "HIGH",
                },
            },
            {
                "event_id": "evt-corrective-1",
                "category": "corrective",
                "event_type": "CORRECTIVE_TOOL_COMPLETED",
                "timestamp": "2026-05-21T10:05:00Z",
                "dataset_id": "ds-a",
                "source": "test",
                "tags": ["corrective"],
                "schema_version": 1,
                "siem_export_ready": True,
                "payload": {
                    "timestamp": "2026-05-21T10:05:00Z",
                    "dataset_id": "ds-a",
                    "title": "Corrective decision produced",
                    "status": "completed",
                },
            },
            {
                "event_id": "evt-fusion-1",
                "category": "fusion",
                "event_type": "FUSION_OUTPUT_READY",
                "timestamp": "2026-05-21T12:06:00Z",
                "dataset_id": "__fusion__",
                "source": "test",
                "tags": ["fusion"],
                "schema_version": 1,
                "siem_export_ready": True,
                "payload": {
                    "timestamp": "2026-05-21T12:06:00Z",
                    "dataset_id": "__fusion__",
                    "title": "Fusion overlay ready",
                },
            },
        ]
        for record in records:
            self._write(record)

    def test_fusion_top_attackers_is_deduped_and_conservative(self) -> None:
        self._seed_records()

        attackers = fusion_top_attackers(top_n=10)

        self.assertEqual(attackers[0]["ip"], "1.2.3.4")
        self.assertEqual(attackers[0]["event_count"], 4)
        self.assertEqual(attackers[0]["dataset_count"], 2)
        self.assertEqual(attackers[0]["behavior_count"], 2)
        self.assertEqual(attackers[0]["correlated_event_count"], 3)
        self.assertEqual(attackers[0]["recurrence_count"], 1)
        self.assertEqual(len(attackers[0]["correlated_behaviors"]), 1)
        self.assertEqual(attackers[0]["correlated_behaviors"][0]["behavior"], "SSH|BRUTE_FORCE")

    def test_fusion_timeline_and_risk_score_are_deterministic(self) -> None:
        self._seed_records()

        timeline = fusion_timeline()
        risk = fusion_risk_score()

        self.assertEqual(len(timeline), 2)
        self.assertEqual(timeline[0]["event_count"], 4)
        self.assertEqual(timeline[0]["attacker_count"], 2)
        self.assertEqual(timeline[0]["supporting_event_counts"]["trust"], 1)
        self.assertEqual(timeline[0]["supporting_event_counts"]["corrective"], 1)
        self.assertEqual(timeline[1]["supporting_event_counts"]["fusion"], 1)
        self.assertEqual(len(risk), 2)
        self.assertGreater(risk[0]["risk_score"], 0.0)
        self.assertGreater(risk[1]["risk_score"], 0.0)

    def test_fusion_summary_reports_deduped_counts(self) -> None:
        self._seed_records()

        summary = fusion_summary()

        self.assertTrue(summary["available"])
        self.assertEqual(summary["source_events"]["replayed_event_count"], 9)
        self.assertEqual(summary["source_events"]["deduped_duplicate_alerts"], 1)
        self.assertEqual(summary["source_events"]["deduped_alert_event_count"], 5)
        self.assertEqual(summary["attacker_count"], 2)
        self.assertEqual(summary["correlated_attacker_count"], 1)
        self.assertEqual(summary["recurrent_attacker_count"], 1)
        self.assertEqual(summary["cluster_count"], 2)
        self.assertEqual(summary["top_attackers"][0]["ip"], "1.2.3.4")

    def test_fusion_alias_uses_cross_dataset_replay(self) -> None:
        self._seed_records()

        default_summary = fusion_summary()
        fusion_alias_summary = fusion_summary(dataset_id="fusion")

        self.assertEqual(
            fusion_alias_summary["top_attackers"][0]["ip"],
            default_summary["top_attackers"][0]["ip"],
        )
        self.assertEqual(
            fusion_alias_summary["source_events"]["deduped_alert_event_count"],
            default_summary["source_events"]["deduped_alert_event_count"],
        )
        self.assertEqual(
            fusion_alias_summary["cluster_count"],
            default_summary["cluster_count"],
        )


if __name__ == "__main__":
    unittest.main()
