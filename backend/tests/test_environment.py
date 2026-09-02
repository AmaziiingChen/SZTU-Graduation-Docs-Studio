from __future__ import annotations

import unittest
from pathlib import Path
from subprocess import CompletedProcess
from types import SimpleNamespace
from unittest.mock import patch

from sztu_docs_backend import environment as environment_module
from sztu_docs_backend.environment import check_environment


class EnvironmentTests(unittest.TestCase):
    def test_document_font_checks_distinguish_required_and_optional_fonts(self) -> None:
        core_index = {
            candidates[0].casefold(): Path("fonts") / candidates[0]
            for candidates in environment_module.CORE_DOCUMENT_FONT_GROUPS.values()
        }
        complete = environment_module._check_core_document_fonts(core_index)

        missing_times_bold_italic = {
            name: path
            for name, path in core_index.items()
            if name != "timesbi.ttf"
        }
        missing = environment_module._check_core_document_fonts(
            missing_times_bold_italic
        )
        optional = environment_module._check_special_document_fonts({})

        self.assertTrue(complete["required"])
        self.assertEqual(complete["status"], "pass")
        self.assertEqual(missing["status"], "fail")
        self.assertIn("Times New Roman 粗斜体", missing["details"]["missing"])
        self.assertFalse(optional["required"])
        self.assertEqual(optional["status"], "warn")

    def test_tex_package_check_reports_the_exact_missing_package(self) -> None:
        with patch.object(
            environment_module.shutil,
            "which",
            return_value="/usr/local/bin/kpsewhich",
        ), patch.object(
            environment_module.subprocess,
            "run",
            return_value=CompletedProcess(
                args=[],
                returncode=0,
                stdout="/tex/geometry.sty\n\n",
                stderr="",
            ),
        ):
            result = environment_module._check_tex_packages(
                "test_tex_packages",
                ("geometry.sty", "xeCJK.sty"),
                required=True,
                label="测试 TeX 宏包",
            )

        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["details"]["missing"], ["xeCJK.sty"])

    def test_thesis_toolchain_is_advisory_until_thesis_is_enabled(self) -> None:
        tools = {
            "xelatex": "/usr/local/bin/xelatex",
            "bibtex": None,
            "latexmk": None,
        }
        with patch.object(
            environment_module.shutil,
            "which",
            side_effect=lambda name: tools.get(name),
        ):
            result = environment_module._check_thesis_toolchain()

        self.assertFalse(result["required"])
        self.assertEqual(result["status"], "warn")
        self.assertEqual(result["details"]["missing"], ["bibtex", "latexmk"])

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
        self.assertTrue(checks["process_tex_packages"]["required"])
        self.assertTrue(checks["pdf_tools"]["required"])
        self.assertTrue(checks["core_document_fonts"]["required"])
        self.assertFalse(checks["special_document_fonts"]["required"])
        self.assertFalse(checks["thesis_toolchain"]["required"])
        self.assertFalse(checks["thesis_tex_packages"]["required"])
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
