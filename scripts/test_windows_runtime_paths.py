"""Regression gates for Windows installer MAX_PATH and UTF-16 path lengths."""
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path, PureWindowsPath

from prepare_windows_runtime_installer import ROOT, runtime_content_hash, validate_runtime_paths, windows_units
from windows_bundle_runtime import bundle_runtime


def setUpModule() -> None:
    # Fixtures stay inside the repository so Windows MAX_PATH cases reproduce real lengths.
    (ROOT / "tmp").mkdir(exist_ok=True)


class RuntimePathTests(unittest.TestCase):
    def test_machine_wide_engine_root_shortens_deep_dependency_paths(self):
        identity = "bdb4c8e1ac7053a7c7af5c236bc62d3eff05d9d539f4ce456a7571df5a7464ee"
        relative = PureWindowsPath("texlive/texmf-dist/tex/generic/pgf/frontendlayer/tikz/libraries/datavisualization/tikzlibrarydatavisualization.formats.functions.code.tex")
        published = PureWindowsPath("C:/Users/Administrator/AppData/Local/SZTU-Docs-Studio/runtimes") / identity / relative
        per_user = PureWindowsPath("C:/Users/Administrator/AppData/Local/SZTU-Docs/r") / identity[:16] / relative
        machine = PureWindowsPath("C:/ProgramData/SZTU-Docs/engine") / identity[:16] / relative
        self.assertEqual(windows_units(str(published)), 265)
        self.assertEqual(windows_units(str(per_user)), 203)
        # The engine root no longer depends on the account name at all.
        self.assertEqual(windows_units(str(machine)), 186)
        # Includes every actual file and directory, not just the reported file.
        staged = ROOT / "build/offline-runtime"
        if not staged.is_dir():
            self.skipTest("offline runtime is not staged")
        self.assertGreater(validate_runtime_paths(staged, identity), 0)

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

    def test_descriptor_roots_resolve_the_machine_wide_engine(self):
        identity = "c" * 64
        manifest = b'{"tools": {}}'
        with tempfile.TemporaryDirectory(prefix="runtime-descriptor-", dir=ROOT / "tmp") as folder:
            root = Path(folder)
            resources = root / "resources"
            resources.mkdir()
            engine = root / "programdata/SZTU-Docs/engine" / identity[:16]
            (engine / "texlive").mkdir(parents=True)
            (engine / "runtime-manifest.json").write_bytes(manifest)
            (engine / "complete.txt").write_text(identity, encoding="utf-8")
            (resources / "offline-runtime-location.json").write_text(json.dumps({
                "schema_version": "3.0", "runtime_id": identity,
                "manifest_sha256": hashlib.sha256(manifest).hexdigest(),
                "roots": [{"kind": "path", "value": "%PROGRAMDATA%/SZTU-Docs/engine/" + identity[:16]}],
            }), encoding="utf-8")
            original = os.environ.get("PROGRAMDATA")
            os.environ["PROGRAMDATA"] = str(root / "programdata")
            try:
                self.assertEqual(bundle_runtime(resources).resolve(), engine.resolve())
                (engine / "complete.txt").write_text("d" * 64, encoding="utf-8")
                with self.assertRaisesRegex(RuntimeError, "Incomplete"):
                    bundle_runtime(resources)
            finally:
                if original is None:
                    os.environ.pop("PROGRAMDATA", None)
                else:
                    os.environ["PROGRAMDATA"] = original

    def test_non_ascii_completed_engine_is_refused(self):
        identity = "e" * 64
        manifest = b'{"tools": {}}'
        with tempfile.TemporaryDirectory(prefix="runtime-cjk-", dir=ROOT / "tmp") as folder:
            root = Path(folder)
            resources = root / "resources"
            resources.mkdir()
            engine = root / "程序数据/SZTU-Docs/engine" / identity[:16]
            (engine / "texlive").mkdir(parents=True)
            (engine / "runtime-manifest.json").write_bytes(manifest)
            (engine / "complete.txt").write_text(identity, encoding="utf-8")
            (resources / "offline-runtime-location.json").write_text(json.dumps({
                "schema_version": "3.0", "runtime_id": identity,
                "manifest_sha256": hashlib.sha256(manifest).hexdigest(),
                "roots": [{"kind": "path", "value": "%PROGRAMDATA%/SZTU-Docs/engine/" + identity[:16]}],
            }), encoding="utf-8")
            original = os.environ.get("PROGRAMDATA")
            os.environ["PROGRAMDATA"] = str(root / "程序数据")
            try:
                with self.assertRaisesRegex(RuntimeError, "ASCII"):
                    bundle_runtime(resources)
                # Verification builds pass the staged runtime explicitly.
                self.assertEqual(bundle_runtime(resources, engine).resolve(), engine.resolve())
            finally:
                if original is None:
                    os.environ.pop("PROGRAMDATA", None)
                else:
                    os.environ["PROGRAMDATA"] = original


if __name__ == "__main__":
    unittest.main()
