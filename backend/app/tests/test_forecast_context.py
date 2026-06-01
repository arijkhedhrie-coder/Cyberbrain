from __future__ import annotations

import os
import sys
import unittest


ROOT = os.path.dirname(os.path.dirname(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.api.routes.dashboard_routes import _build_forecast_context


class ForecastContextTests(unittest.TestCase):
    def test_build_forecast_context_keeps_real_evidence_and_threshold_shift(self) -> None:
        explainability = {
            "available": True,
            "generated_from": "pipeline_payload",
            "summary": "SSH brute force remains the dominant observed signal.",
            "top_alarm": {
                "engine": "SSH",
                "type": "BRUTE_FORCE",
                "score": 92.0,
                "source_ip": "1.2.3.4",
                "human_insight": "Repeated SSH failures were prioritized.",
            },
            "model_context": {
                "agreement": 1.0,
                "agreement_label": "HIGH",
                "trust_score": 0.86,
                "trust_label": "ELEVEE",
                "drift_label": "stable",
                "stability": "stable",
            },
            "evidence": [
                {
                    "label": "Alarm score",
                    "value": "92.0",
                    "detail": "Repeated SSH failures were prioritized.",
                    "weight": 92.0,
                    "tone": "risk",
                    "source": "alarm.score",
                },
                {
                    "label": "Model agreement",
                    "value": "100%",
                    "detail": "Models agree on the current reading.",
                    "weight": 100.0,
                    "tone": "support",
                    "source": "trust.model_agreement",
                },
            ],
            "engine_contributions": [
                {
                    "engine": "SSH",
                    "alarms": 4,
                    "status": "ALARM",
                    "pass1": 38,
                    "pass2": 25,
                    "rerun_p2": True,
                }
            ],
            "threshold_context": {
                "engine": "SSH",
                "pass1": 38,
                "pass2": 25,
                "changed": True,
                "gate_mode": "correlated",
                "gate_accepted": True,
                "threat_level": "HIGH",
                "confidence": 0.86,
            },
            "prediction_context": {
                "score": 17,
                "risk_level": "MEDIUM",
                "flags": [],
                "explanations": [],
                "message": "",
            },
        }

        context = _build_forecast_context(explainability)

        self.assertEqual(context["dominant_engine"], "SSH")
        self.assertIn("DOMINANT_SSH", context["fallback_flags"])
        self.assertIn("THRESHOLD_SHIFT", context["fallback_flags"])
        self.assertIn("MODEL_AGREEMENT_HIGH", context["fallback_flags"])
        self.assertIn("SSH_DOMINANT_SIGNAL", context["fallback_events"])
        self.assertIn("THRESHOLD_SHIFT_RECORDED", context["fallback_events"])
        self.assertGreaterEqual(len(context["fallback_explanations"]), 2)
        self.assertTrue(context["presentation_ready"])


if __name__ == "__main__":
    unittest.main()
