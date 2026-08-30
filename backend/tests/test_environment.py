from __future__ import annotations

import unittest

from sztu_docs_backend.environment import check_environment


class EnvironmentTests(unittest.TestCase):
    def test_environment_result_shape_and_readiness_rule(self) -> None:
        result = check_environment()
        self.assertIsInstance(result["ready"], bool)
        self.assertEqual(
            set(result["platform"]), {"system", "release", "machine", "python"}
        )
        self.assertGreaterEqual(len(result["checks"]), 4)
        for check in result["checks"]:
            self.assertIn(check["status"], {"pass", "warn", "fail"})
            self.assertIsInstance(check["required"], bool)
        expected_ready = not any(
            check["required"] and check["status"] == "fail"
            for check in result["checks"]
        )
        self.assertEqual(result["ready"], expected_ready)


if __name__ == "__main__":
    unittest.main()
