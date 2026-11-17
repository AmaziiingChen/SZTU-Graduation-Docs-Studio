from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend.exporter import ExportError, _run_process


def _failing_shell(message: str) -> list[str]:
    """Emit the message verbatim: quoting shells would eat backticks and apostrophes."""
    return ["/bin/sh", "-c", "cat >&2 <<'SZTU_STDERR'\n" + message + "\nSZTU_STDERR\nexit 1\n"]


@unittest.skipIf(os.name == "nt", "uses a POSIX shell to stand in for XeLaTeX")
class RenderEngineFailureTests(unittest.TestCase):
    def test_a_missing_texmf_configuration_is_named_instead_of_generic_render_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ExportError) as caught:
                _run_process(
                    _failing_shell("warning: kpathsea: configuration file texmf.cnf not found in these directories: /nonexistent"),
                    cwd=Path(directory),
                    evidence={},
                    environment=dict(os.environ),
                )

        self.assertEqual(caught.exception.code, "ENGINE_CONFIGURATION_MISSING")
        self.assertIn("运行安装包", str(caught.exception))

    def test_a_non_ascii_engine_root_is_reported_as_the_cause(self):
        with tempfile.TemporaryDirectory() as directory, patch(
            "sztu_docs_backend.exporter.portable_tex_root", return_value=Path(directory) / "引擎" / "texlive"
        ):
            with self.assertRaises(ExportError) as caught:
                _run_process(
                    _failing_shell("I can't find the format file `xelatex.fmt'!"),
                    cwd=Path(directory),
                    evidence={},
                    environment=dict(os.environ),
                )

        self.assertEqual(caught.exception.code, "ENGINE_PATH_UNSUPPORTED")
        self.assertIn("ProgramData", str(caught.exception))
        self.assertEqual(caught.exception.details["engine_root"], str(Path(directory) / "引擎" / "texlive"))
