import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from sztu_docs_backend.runtime_paths import (
    offline_tex_environment,
    offline_tex_root,
    windows_process_environment,
    windows_tool_path,
)


class RuntimePathTests(unittest.TestCase):
    def test_other_platform_does_not_rewrite_process_environment(self):
        if os.name != "nt":
            value = {"PATH": "/synthetic/tools"}
            self.assertEqual(windows_process_environment(value), value)

    @unittest.skipUnless(os.name == "nt", "Windows PDF driver environment")
    def test_actual_renderer_repairs_missing_interpreter_and_expands_system_path(self):
        from sztu_docs_backend.exporter import _renderer_environment
        with patch.dict(os.environ, {"COMSPEC": "", "PATH": r"%SystemRoot%\system32"}):
            result = _renderer_environment()
        self.assertTrue(Path(result["COMSPEC"]).is_file())
        self.assertNotIn("%SystemRoot%", result["PATH"])
        self.assertIn(str(Path(os.environ["SYSTEMROOT"]) / "System32").casefold(), result["PATH"].casefold())

    def test_plain_path_keeps_semantics(self):
        value = os.pathsep.join(("nonexistent/tools", "nonexistent/other"))
        self.assertEqual(windows_tool_path(value), value)
        self.assertEqual(offline_tex_environment(value), {})

    @unittest.skipUnless(os.name == "nt", "Windows portable toolchain")
    def test_portable_tex_configuration_is_derived_after_moving(self):
        with tempfile.TemporaryDirectory(prefix="sztu runtime test ") as directory:
            runtime = Path(directory) / "offline-runtime"
            bin_directory = runtime / "texlive/bin/windows"
            bin_directory.mkdir(parents=True)
            (runtime / "runtime-manifest.json").write_text("{}", encoding="utf-8")
            (runtime / "texlive/texmf.cnf").write_text("% synthetic", encoding="utf-8")
            paths = windows_tool_path(str(bin_directory))
            resolved = offline_tex_environment(paths)
            self.assertEqual(Path(resolved["TEXMFROOT"]).resolve(), (runtime / "texlive").resolve())
            self.assertIn("/texmf-dist/web2c", resolved["TEXMFCNF"])

    @unittest.skipUnless(os.name == "nt", "Windows portable toolchain")
    def test_non_ascii_root_is_refused_instead_of_reaching_tex(self):
        # kpathsea rewrites non-ASCII bytes to '?', so a Chinese profile path turns into
        # "I can't find the format file 'xelatex.fmt'". Refuse the root while it is still
        # identifiable, rather than exporting a TEXMFROOT that cannot work.
        with tempfile.TemporaryDirectory(prefix="sztu runtime test ") as directory:
            engines = Path(directory) / "engine"
            runtime = engines / "引擎目录"
            bin_directory = runtime / "texlive/bin/windows"
            bin_directory.mkdir(parents=True)
            (runtime / "runtime-manifest.json").write_text("{}", encoding="utf-8")
            (runtime / "texlive/texmf.cnf").write_text("% synthetic", encoding="utf-8")
            self.assertIsNone(offline_tex_root(str(bin_directory)))
            self.assertEqual(offline_tex_environment(str(bin_directory)), {})

            ascii_runtime = engines / "runtime"
            ascii_bin = ascii_runtime / "texlive/bin/windows"
            ascii_bin.mkdir(parents=True)
            (ascii_runtime / "runtime-manifest.json").write_text("{}", encoding="utf-8")
            (ascii_runtime / "texlive/texmf.cnf").write_text("% synthetic", encoding="utf-8")
            resolved = offline_tex_environment(str(ascii_bin))
            self.assertEqual(Path(resolved["TEXMFROOT"]).resolve(), (ascii_runtime / "texlive").resolve())
