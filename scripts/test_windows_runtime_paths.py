"""Regression gates for Windows installer MAX_PATH and UTF-16 path lengths."""
import tempfile
import unittest
from pathlib import Path, PureWindowsPath

from prepare_windows_runtime_installer import ROOT, runtime_content_hash, validate_runtime_paths, windows_units


class RuntimePathTests(unittest.TestCase):
    def test_reported_administrator_path_and_long_usernames(self):
        identity = "bdb4c8e1ac7053a7c7af5c236bc62d3eff05d9d539f4ce456a7571df5a7464ee"
        relative = PureWindowsPath("texlive/texmf-dist/tex/generic/pgf/frontendlayer/tikz/libraries/datavisualization/tikzlibrarydatavisualization.formats.functions.code.tex")
        old = PureWindowsPath("C:/Users/Administrator/AppData/Local/SZTU-Docs-Studio/runtimes") / identity / relative
        new = PureWindowsPath("C:/Users/Administrator/AppData/Local/SZTU-Docs/r") / identity[:16] / relative
        self.assertEqual(windows_units(str(old)), 265)
        self.assertEqual(windows_units(str(new)), 203)
        # Includes every actual file and directory, not just the reported file.
        self.assertGreater(validate_runtime_paths(ROOT / "build/offline-runtime", identity), 0)

    def test_rejects_future_deeper_dependencies(self):
        with tempfile.TemporaryDirectory(prefix="runtime-path-gate-", dir=ROOT / "tmp") as folder:
            root = Path(folder)
            target = root / ("x" * 120) / ("y" * 90)
            target.parent.mkdir()
            target.write_text("synthetic", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "Windows limit"):
                validate_runtime_paths(root, "a" * 64)

    def test_windows_lengths_count_utf16_units(self):
        self.assertEqual(windows_units("用户"), 2)
        self.assertEqual(windows_units("\U0001f600"), 2)

    def test_font_cache_changes_do_not_replace_unchanged_tools(self):
        with tempfile.TemporaryDirectory(prefix="runtime-identity-", dir=ROOT / "tmp") as folder:
            root = Path(folder)
            tool = root / "texlive/bin/windows/xelatex.exe"
            cache = root / "texlive/texmf-var/fonts/cache/synthetic.cache"
            tool.parent.mkdir(parents=True)
            cache.parent.mkdir(parents=True)
            tool.write_bytes(b"synthetic tool version 1")
            cache.write_bytes(b"font cache version 1")
            initial = runtime_content_hash(root)
            cache.write_bytes(b"font cache version 2")
            self.assertEqual(initial, runtime_content_hash(root))
            tool.write_bytes(b"synthetic tool version 2")
            self.assertNotEqual(initial, runtime_content_hash(root))


if __name__ == "__main__":
    unittest.main()
