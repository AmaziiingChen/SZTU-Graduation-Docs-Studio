from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sztu_docs_backend import environment as environment_module
from sztu_docs_backend.environment import check_environment


class EnvironmentTests(unittest.TestCase):
    def test_process_document_engines_return_independent_success_checks(self) -> None:
        engine = SimpleNamespace(
            version="0.1+test",
            pack_sha256="a" * 64,
            source="linked-workspace",
        )
        with patch.object(environment_module, "resolve_engine", return_value=engine):
            proposal = environment_module._check_proposal_engine()
            midterm = environment_module._check_midterm_engine()
            task_book = environment_module._check_task_book_engine()

        self.assertEqual(proposal["id"], "proposal_engine")
        self.assertEqual(proposal["status"], "pass")
        self.assertTrue(proposal["details"]["live_workspace"])
        self.assertEqual(midterm["id"], "midterm_engine")
        self.assertEqual(midterm["status"], "pass")
        self.assertTrue(midterm["details"]["live_workspace"])
        self.assertEqual(task_book["id"], "task_book_engine")
        self.assertEqual(task_book["status"], "pass")
        self.assertTrue(task_book["details"]["live_workspace"])

    def test_task_book_docx_font_is_a_non_global_pass_or_warning(self) -> None:
        engine = SimpleNamespace(font_directories=())
        with patch.object(
            environment_module, "resolve_engine", return_value=engine
        ), patch.object(
            environment_module,
            "_find_task_book_checkbox_font",
            return_value=Path("Wingdings 2.ttf"),
        ):
            available = environment_module._check_task_book_docx_font()
        with patch.object(
            environment_module, "resolve_engine", return_value=engine
        ), patch.object(
            environment_module,
            "_find_task_book_checkbox_font",
            return_value=None,
        ):
            missing = environment_module._check_task_book_docx_font()

        self.assertEqual(available["id"], "task_book_docx_font")
        self.assertFalse(available["required"])
        self.assertEqual(available["status"], "pass")
        self.assertTrue(available["details"]["found"])
        self.assertEqual(missing["id"], "task_book_docx_font")
        self.assertFalse(missing["required"])
        self.assertEqual(missing["status"], "warn")
        self.assertFalse(missing["details"]["found"])
        self.assertIn("PDF 和 LaTeX 不受影响", missing["message"])

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
        checks = {check["id"]: check for check in result["checks"]}
        self.assertTrue(checks["document_dependencies"]["required"])
        self.assertTrue(checks["xelatex"]["required"])
        self.assertTrue(checks["pdf_tools"]["required"])
        self.assertIn("task_book_engine", checks)
        self.assertFalse(checks["task_book_engine"]["required"])
        self.assertIn("task_book_docx_font", checks)
        self.assertFalse(checks["task_book_docx_font"]["required"])
        expected_ready = not any(
            check["required"] and check["status"] == "fail"
            for check in result["checks"]
        )
        self.assertEqual(result["ready"], expected_ready)


if __name__ == "__main__":
    unittest.main()
