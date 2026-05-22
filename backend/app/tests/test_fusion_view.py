import os
import sys
import unittest


ROOT = os.path.dirname(os.path.dirname(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.core.fusion_view import FUSION_DATASET, build_fusion_payload, is_fusion_dataset


class TestFusionView(unittest.TestCase):
    def test_fusion_aliases_are_explicit(self):
        self.assertTrue(is_fusion_dataset("fusion"))
        self.assertTrue(is_fusion_dataset("__fusion__"))
        self.assertTrue(is_fusion_dataset("merged"))
        self.assertFalse(is_fusion_dataset(""))
        self.assertFalse(is_fusion_dataset("dataset_auth"))

    def test_build_fusion_payload_creates_read_only_overlay(self):
        payload = build_fusion_payload({
            "dataset_auth": {
                "alarms": [
                    {
                        "timestamp": "2026-05-20T10:00:00",
                        "ip": "1.2.3.4",
                        "severity": "CRITICAL",
                        "score": 92,
                        "engine": "SSH",
                        "message": "Auth brute force",
                    }
                ],
                "kpis": {
                    "health_score": 81,
                    "row_count": 100,
                    "deduped_count": 95,
                    "noise_ratio": 0.1,
                },
                "trust": {
                    "drift_score": 0.4,
                    "confidence_in_metrics": 0.8,
                },
                "data_sources": ["auth"],
                "sessions": [],
                "decisions": [],
                "log_lines": [],
                "prediction": {"prediction_score": 70, "flags": ["ssh_burst"]},
                "minimization": [{"timestamp": "10:00", "alarmes": 3, "risque": 44}],
            },
            "dataset_web": {
                "alarms": [
                    {
                        "timestamp": "2026-05-20T10:05:00",
                        "ip": "1.2.3.4",
                        "severity": "HIGH",
                        "score": 76,
                        "engine": "WEB",
                        "type": "WEB_SCAN",
                        "message": "Web scan",
                    },
                    {
                        "timestamp": "2026-05-20T10:07:00",
                        "ip": "1.2.3.4",
                        "severity": "HIGH",
                        "score": 81,
                        "engine": "WEB",
                        "type": "WEB_BRUTE_FORCE",
                        "message": "Repeat web probe",
                    },
                ],
                "kpis": {
                    "health_score": 90,
                    "row_count": 120,
                    "deduped_count": 118,
                    "noise_ratio": 0.05,
                },
                "trust": {
                    "drift_score": 0.2,
                    "confidence_in_metrics": 0.9,
                },
                "data_sources": ["web"],
                "sessions": [],
                "decisions": [],
                "log_lines": [],
                "prediction": {"prediction_score": 40, "flags": ["scan"]},
                "minimization": [{"timestamp": "10:00", "alarmes": 2, "risque": 30}],
            },
        })

        self.assertEqual(payload["dataset_id"], FUSION_DATASET)
        self.assertTrue(payload["analysis_only"])
        self.assertEqual(payload["mode"], "fusion")
        self.assertEqual(payload["memory"]["analysis_only"], True)
        self.assertEqual(payload["server_ids"], ["dataset_auth", "dataset_web"])
        self.assertEqual(payload["fusion"]["global_kpis"]["datasets_covered"], 2)
        self.assertEqual(payload["fusion"]["cross_dataset_ip_correlation"][0]["ip"], "1.2.3.4")
        self.assertEqual(payload["fusion"]["cross_dataset_ip_correlation"][0]["dataset_count"], 2)
        self.assertEqual(payload["fusion"]["cross_dataset_ip_correlation"][0]["total_alarm_count"], 3)
        self.assertEqual(payload["fusion"]["cross_dataset_ip_correlation"][0]["window_minutes"], 30)
        self.assertTrue(any(item["dataset_id"] == FUSION_DATASET for item in payload["fusion"]["global_alert_ranking"]))
        self.assertEqual(payload["alarms"][0]["action"], "MONITOR")
        self.assertEqual(payload["trust"]["confidence_label"], "FUSION ONLY")

    def test_build_fusion_payload_filters_loose_same_ip_matches(self):
        payload = build_fusion_payload({
            "dataset_auth": {
                "alarms": [
                    {
                        "timestamp": "2026-05-20T10:00:00",
                        "ip": "9.9.9.9",
                        "severity": "HIGH",
                        "score": 72,
                        "engine": "SSH",
                        "message": "SSH probe",
                    }
                ],
                "kpis": {"health_score": 80, "row_count": 10, "deduped_count": 10, "noise_ratio": 0.0},
                "trust": {"drift_score": 0.1, "confidence_in_metrics": 0.7},
                "data_sources": ["auth"],
                "sessions": [],
                "decisions": [],
                "log_lines": [],
                "prediction": {"prediction_score": 0, "flags": []},
                "minimization": [],
            },
            "dataset_web": {
                "alarms": [
                    {
                        "timestamp": "2026-05-20T12:10:00",
                        "ip": "9.9.9.9",
                        "severity": "HIGH",
                        "score": 74,
                        "engine": "WEB",
                        "message": "Late web probe",
                    }
                ],
                "kpis": {"health_score": 82, "row_count": 12, "deduped_count": 12, "noise_ratio": 0.0},
                "trust": {"drift_score": 0.1, "confidence_in_metrics": 0.8},
                "data_sources": ["web"],
                "sessions": [],
                "decisions": [],
                "log_lines": [],
                "prediction": {"prediction_score": 0, "flags": []},
                "minimization": [],
            },
        })

        self.assertEqual(payload["fusion"]["cross_dataset_ip_correlation"], [])


if __name__ == "__main__":
    unittest.main()
