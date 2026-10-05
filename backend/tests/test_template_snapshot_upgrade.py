from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend import template_engine


class TemplateSnapshotUpgradeTests(unittest.TestCase):
    def test_midterm_and_task_book_snapshots_keep_shared_list_layout_importable(self) -> None:
        for kind, folder, hashes in (
            ("midterm", "midterm", template_engine.MIDTERM_ENGINE_FILE_HASHES),
            ("task_book", "task-book", template_engine.TASK_BOOK_ENGINE_FILE_HASHES),
        ):
            with self.subTest(document_type=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / "source"
                for relative in {*hashes, *template_engine.WORKSPACE_SHARED_SUPPORT_FILE_NAMES}:
                    target = source / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(b"")
                (source / "templates/common/python/list_layout.py").write_text("marker_advance_pt = lambda: 42\n", encoding="utf-8")
                (source / f"templates/{folder}/word/render.py").write_text(
                    "from pathlib import Path\nimport sys\n"
                    "sys.path.insert(0, str(Path(__file__).resolve().parents[2]))\n"
                    "from common.python.list_layout import marker_advance_pt\nprint(marker_advance_pt())\n", encoding="utf-8")
                validator = source / "scripts/validate_cjk_render.py"
                validator.parent.mkdir(parents=True)
                validator.write_bytes(b"synthetic validator")
                descriptor, _, _ = template_engine._snapshot_workspace_engine(root / "data", source, kind, source_label="test-workspace")
                result = subprocess.run([sys.executable, str(descriptor.root / "word/render.py")], check=True, capture_output=True, text=True)
                self.assertEqual(result.stdout.strip(), "42")

    def test_proposal_snapshot_keeps_list_layout_importable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source"
            for relative_name in template_engine.PROPOSAL_WORKSPACE_FILE_NAMES:
                file = source / relative_name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b"")
            (source / "templates/common/python/list_layout.py").write_text(
                "marker_advance_pt = lambda: 42\n", encoding="utf-8"
            )
            (source / "templates/proposal/word/render.py").write_text(
                "from pathlib import Path\n"
                "import sys\n"
                "sys.path.insert(0, str(Path(__file__).resolve().parents[2]))\n"
                "from common.python.list_layout import marker_advance_pt\n"
                "print(marker_advance_pt())\n",
                encoding="utf-8",
            )
            validator = source / "scripts/validate_cjk_render.py"
            validator.parent.mkdir(parents=True)
            validator.write_bytes(b"synthetic validator")

            descriptor, _, created = template_engine._snapshot_workspace_engine(
                root / "data", source, "proposal", source_label="test-workspace"
            )
            result = subprocess.run(
                [sys.executable, str(descriptor.root / "word/render.py")],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertTrue(created)
            self.assertEqual(result.stdout.strip(), "42")

    def test_base_version_change_creates_a_new_immutable_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source"
            data_directory = root / "data"
            renderer = source / "templates" / "midterm" / "word" / "render.py"
            renderer.parent.mkdir(parents=True)
            renderer.write_bytes(b"stable midterm renderer")
            common_runtime = (
                source / "templates" / "common" / "python" / "content.py"
            )
            common_runtime.parent.mkdir(parents=True)
            common_runtime.write_bytes(b"stable common runtime")
            validator = source / "scripts" / "validate_cjk_render.py"
            validator.parent.mkdir(parents=True)
            validator.write_bytes(b"stable validator")

            hashes = {
                "templates/common/python/content.py": hashlib.sha256(
                    common_runtime.read_bytes()
                ).hexdigest(),
                "templates/midterm/word/render.py": hashlib.sha256(
                    renderer.read_bytes()
                ).hexdigest(),
            }
            with patch.object(
                template_engine,
                "MIDTERM_ENGINE_FILE_HASHES",
                hashes,
            ), patch.object(
                template_engine,
                "WORKSPACE_SHARED_SUPPORT_FILE_NAMES",
                (),
            ), patch.object(
                template_engine,
                "MIDTERM_ENGINE_VERSION",
                "0.1+old",
            ):
                old_descriptor, _, old_created = (
                    template_engine._snapshot_workspace_engine(
                        data_directory,
                        source,
                        "midterm",
                        source_label="test-workspace",
                    )
                )

            with patch.object(
                template_engine,
                "MIDTERM_ENGINE_FILE_HASHES",
                hashes,
            ), patch.object(
                template_engine,
                "WORKSPACE_SHARED_SUPPORT_FILE_NAMES",
                (),
            ), patch.object(
                template_engine,
                "MIDTERM_ENGINE_VERSION",
                "0.2+new",
            ):
                new_descriptor, _, new_created = (
                    template_engine._snapshot_workspace_engine(
                        data_directory,
                        source,
                        "midterm",
                        source_label="test-workspace",
                    )
                )
                repeated_descriptor, _, repeated_created = (
                    template_engine._snapshot_workspace_engine(
                        data_directory,
                        source,
                        "midterm",
                        source_label="test-workspace",
                    )
                )

            old_snapshot = old_descriptor.root.parents[1]
            new_snapshot = new_descriptor.root.parents[1]
            self.assertTrue(old_created)
            self.assertTrue(new_created)
            self.assertFalse(repeated_created)
            self.assertNotEqual(old_snapshot, new_snapshot)
            self.assertEqual(new_descriptor.root, repeated_descriptor.root)
            self.assertIn("midterm-0.1-", old_snapshot.name)
            self.assertIn("midterm-0.2-", new_snapshot.name)
            self.assertEqual(
                json.loads(
                    (new_snapshot / template_engine.INSTALL_MANIFEST_NAME).read_text(
                        encoding="utf-8"
                    )
                )["version"],
                new_descriptor.version,
            )


if __name__ == "__main__":
    unittest.main()
