from __future__ import annotations

import unittest

from sztu_docs_backend.environment import check_environment
from sztu_docs_backend.template_catalog import discover_trusted_template_packs


class TemplateCatalogTests(unittest.TestCase):
    def test_runtime_discovers_the_trusted_development_pack(self) -> None:
        packs = discover_trusted_template_packs()
        self.assertEqual(len(packs), 1)
        self.assertEqual(packs[0]["template_id"], "sztu.proposal.2026.dev")
        self.assertTrue(packs[0]["trusted"])
        self.assertEqual(packs[0]["files_verified"], 8)
        self.assertNotIn("directory", packs[0])

    def test_environment_check_uses_the_same_verified_descriptor(self) -> None:
        expected = discover_trusted_template_packs()[0]
        result = check_environment()
        check = next(item for item in result["checks"] if item["id"] == "template_pack")
        self.assertEqual(check["status"], "pass")
        self.assertEqual(check["details"]["templates"], [expected])


if __name__ == "__main__":
    unittest.main()
