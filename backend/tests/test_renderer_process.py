"""Exercise subprocess streams rather than mocking Windows pipe behavior."""
import sys
import tempfile
import unittest
from pathlib import Path

from sztu_docs_backend.exporter import ExportError, _run


class RendererProcessTests(unittest.TestCase):
    def test_legacy_console_bytes_do_not_crash_pipe_readers(self):
        with tempfile.TemporaryDirectory() as directory:
            output = _run(
                [sys.executable, "-c", "import sys; sys.stdout.buffer.write(b'PDF diagnostic: \\xff\\n'); sys.stderr.buffer.write(b'warning: \\xfe\\n')"],
                cwd=Path(directory),
            )
            self.assertIn("PDF diagnostic:", output)
            self.assertIn("warning:", output)

    def test_chinese_renderer_failure_maps_to_stable_error(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ExportError) as error:
                _run([sys.executable, "-c", "import sys; print('公式命令不受支持', file=sys.stderr); sys.exit(1)"], cwd=Path(directory))
            self.assertEqual(error.exception.code, "THESIS_EQUATION_INVALID")
