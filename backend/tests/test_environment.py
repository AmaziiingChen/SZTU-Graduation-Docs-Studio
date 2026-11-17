from __future__ import annotations

import os
import stat
import unittest
import tempfile
import sys
from contextlib import nullcontext
from pathlib import Path
from subprocess import CompletedProcess
from types import SimpleNamespace
from unittest.mock import patch

from sztu_docs_backend import environment as environment_module
from sztu_docs_backend.environment import check_environment


class EnvironmentTests(unittest.TestCase):
    def test_explicit_font_file_override_matches_renderer_even_with_custom_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            font = Path(directory) / 'private-title-font.ttf'
            font.write_bytes(b'synthetic path-discovery fixture; not rendered')
            with patch.object(environment_module, '_font_search_roots', return_value=[]), patch.dict(
                environment_module.os.environ, {'SZTU_FZXIAOBIAOSONG_FONT': str(font)}, clear=True
            ):
                check = environment_module._check_special_document_fonts(environment_module._font_index())
            self.assertEqual(check['details']['fonts']['方正小标宋简体'], str(font.resolve()))
            self.assertNotIn('方正小标宋简体', check['details']['missing'])

    def test_registered_custom_wps_install_is_found_without_default_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "custom-wps" / "office6" / "wps.exe"
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b"synthetic executable marker; never executed")
            def open_key(hive, key, reserved, access):
                if hive == 1 and access == 0x202 and key.endswith("\\wps.exe"):
                    return nullcontext(str(executable))
                raise FileNotFoundError(key)
            registry = SimpleNamespace(
                HKEY_CURRENT_USER=1, HKEY_LOCAL_MACHINE=2,
                KEY_WOW64_64KEY=0x100, KEY_WOW64_32KEY=0x200, KEY_READ=2,
                OpenKey=open_key, QueryValueEx=lambda key, name: (f'"{key}"', 1),
            )
            with patch.dict(sys.modules, {"winreg": registry}), patch.object(
                environment_module.platform, "system", return_value="Windows"
            ), patch.dict(environment_module.os.environ, {}, clear=True):
                result = environment_module._check_office_editor()
            self.assertEqual(result["status"], "pass")
            self.assertEqual(result["details"]["path"], str(executable))

    def test_stale_registry_path_is_not_reported_as_installed(self):
        with patch.object(environment_module.platform, "system", return_value="Windows"), patch.object(
            environment_module, "_windows_office_registry_candidates", return_value=["missing-office/WINWORD.EXE"]
        ), patch.dict(environment_module.os.environ, {}, clear=True):
            result = environment_module._check_office_editor()
        self.assertEqual(result["status"], "warn")

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

    def test_assessment_engines_are_registered_and_unavailable_is_per_document(self) -> None:
        engine = SimpleNamespace(version="0.1+test", pack_sha256="a" * 64, source="linked-workspace", font_directories=())
        with patch.object(environment_module, "resolve_engine", return_value=engine):
            result = check_environment()
        checks = {check["id"]: check for check in result["checks"]}
        self.assertNotIn("thesis_engine", checks)
        for kind in environment_module.ASSESSMENT_DOCUMENT_TYPES:
            with self.subTest(kind=kind):
                self.assertEqual(checks[f"{kind}_engine"]["status"], "pass")
                self.assertFalse(checks[f"{kind}_engine"]["required"])
                self.assertTrue(checks[f"{kind}_engine"]["details"]["live_workspace"])
        with patch.object(environment_module, "resolve_engine", side_effect=environment_module.ExportError("TEMPLATE_ENGINE_UNAVAILABLE", "模板不可用")):
            warning = environment_module._check_assessment_engine("advisor_review")
        self.assertEqual(warning["status"], "warn")
        self.assertFalse(warning["required"])

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


class XelatexProbeTests(unittest.TestCase):
    def test_failure_output_is_classified_instead_of_collapsed(self):
        self.assertEqual(
            environment_module._tex_failure_code(
                "warning: kpathsea: configuration file texmf.cnf not found in these directories: /x"
            ),
            "ENV_TEX_CONFIG_MISSING",
        )
        self.assertEqual(
            environment_module._tex_failure_code("I can't find the format file `xelatex.fmt'!"),
            "ENV_TEX_FORMAT_MISSING",
        )
        self.assertEqual(environment_module._tex_failure_code("! Undefined control sequence."), "ENV_TEX_FAILED")

    def test_a_missing_binary_is_reported_without_running_a_probe(self):
        with patch.object(environment_module.shutil, "which", return_value=None), patch.object(
            environment_module, "_probe_xelatex"
        ) as probe:
            check = environment_module._check_xelatex()

        probe.assert_not_called()
        self.assertEqual(check["status"], "fail")
        self.assertEqual(check["details"]["code"], "ENV_TEX_MISSING")

    def test_a_non_ascii_engine_root_is_named_before_compiling(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = Path(directory) / "引擎" / "texlive"
            with patch.object(environment_module.shutil, "which", return_value="/usr/bin/xelatex"), patch.object(
                environment_module, "portable_tex_root", return_value=engine
            ), patch.object(environment_module, "_probe_xelatex") as probe:
                check = environment_module._check_xelatex()

        probe.assert_not_called()
        self.assertEqual(check["status"], "fail")
        self.assertEqual(check["details"]["code"], "ENV_TEX_PATH_UNSUPPORTED")
        self.assertEqual(check["details"]["path"], str(engine))

    @unittest.skipIf(os.name == "nt", "a POSIX shell stub cannot run on Windows")
    def test_a_failing_binary_is_classified_from_its_own_output(self):
        with tempfile.TemporaryDirectory() as directory:
            stub = Path(directory) / "xelatex"
            stub.write_text(
                "#!/bin/sh\n"
                'echo "warning: kpathsea: configuration file texmf.cnf not found in these directories: /none" >&2\n'
                "echo \"I can't find the format file \\`xelatex.fmt'!\" >&2\n"
                "exit 1\n",
                encoding="utf-8",
            )
            stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
            probe = environment_module._probe_xelatex(str(stub))

        self.assertEqual(probe["code"], "ENV_TEX_CONFIG_MISSING")
        self.assertIn("texmf.cnf not found", probe["reason"])

    @unittest.skipIf(os.name == "nt", "a POSIX shell stub cannot run on Windows")
    def test_a_successful_compile_reports_the_running_version(self):
        with tempfile.TemporaryDirectory() as directory:
            stub = Path(directory) / "xelatex"
            stub.write_text(
                "#!/bin/sh\n"
                "printf '' > probe.pdf\n"
                'echo "This is XeTeX, Version 3.141592653-2.6-0.999997 (TeX Live 2025)"\n'
                "exit 0\n",
                encoding="utf-8",
            )
            stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
            probe = environment_module._probe_xelatex(str(stub))

        self.assertEqual(probe["code"], "ENV_TEX_OK")
        self.assertEqual(probe["version"], "3.141592653-2.6-0.999997")
