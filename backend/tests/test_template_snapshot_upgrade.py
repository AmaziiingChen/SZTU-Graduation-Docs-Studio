from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend import template_engine


class TemplateSnapshotUpgradeTests(unittest.TestCase):
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
