import os
import tempfile
import unittest
from pathlib import Path
from sztu_docs_backend.runtime_paths import windows_tool_path, offline_tex_environment


class RuntimePathTests(unittest.TestCase):
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
