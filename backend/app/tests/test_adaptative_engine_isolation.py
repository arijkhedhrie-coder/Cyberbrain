import os
import sys
import unittest


ROOT = os.path.dirname(os.path.dirname(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.ai.engines.adaptative_engine import DynamicConfig, adjust_thresholds, meta_learning  # noqa: E402


class TestAdaptiveEngineIsolation(unittest.TestCase):
    def test_global_meta_learning_is_disabled(self):
        result = meta_learning()
        self.assertTrue(result["disabled"])
        self.assertEqual(result["scope"], "dataset_local_only")

    def test_global_threshold_adjustment_is_disabled(self):
        result = adjust_thresholds()
        self.assertTrue(result["disabled"])
        self.assertEqual(result["scope"], "dataset_local_only")
        self.assertEqual(DynamicConfig.current_thresholds(), {})


if __name__ == "__main__":
    unittest.main()
