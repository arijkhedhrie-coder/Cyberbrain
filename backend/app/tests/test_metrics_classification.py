import os
import sys
import unittest


ROOT = os.path.dirname(os.path.dirname(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.utils.metriques import classify_attack_profile


class TestMetricsClassification(unittest.TestCase):
    def test_concentrated_low_entropy_is_automated(self):
        result = classify_attack_profile(
            attack_velocity=12.0,
            is_velocity_spike=False,
            unique_attacking_ips=3,
            ip_entropy=0.011,
        )

        self.assertEqual(result["attack_origin"], "AUTOMATED")
        self.assertEqual(result["threat_severity"], "HIGH")
        self.assertEqual(result["traffic_concentration"], "CONCENTRATED")

    def test_high_spike_is_critical(self):
        result = classify_attack_profile(
            attack_velocity=240.0,
            is_velocity_spike=True,
            unique_attacking_ips=2,
            ip_entropy=0.2,
        )

        self.assertEqual(result["attack_origin"], "AUTOMATED")
        self.assertEqual(result["threat_severity"], "CRITICAL")

    def test_wide_slow_entropy_is_human(self):
        result = classify_attack_profile(
            attack_velocity=10.0,
            is_velocity_spike=False,
            unique_attacking_ips=14,
            ip_entropy=2.8,
        )

        self.assertEqual(result["attack_origin"], "HUMAN")
        self.assertEqual(result["threat_severity"], "NORMAL")
        self.assertEqual(result["traffic_concentration"], "BALANCED")


if __name__ == "__main__":
    unittest.main()
