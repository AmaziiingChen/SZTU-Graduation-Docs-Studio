from __future__ import annotations
import json
import errno
import io
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from sztu_docs_backend import exporter
from sztu_docs_backend.diagnostic_steps import emitter, step
from sztu_docs_backend.server import serve
from sztu_docs_backend.protocol import ProtocolSession
from sztu_docs_backend.protocol import _diagnostic_details

class DiagnosticDetailsTests(unittest.TestCase):
    def test_arbitrary_exception_values_do_not_enter_trace(self):
        try:
            raise ValueError('/Users/private/student-name thesis text')
        except ValueError as exc:
            value = _diagnostic_details(exc)['diagnostic']
        self.assertEqual(value, {'trace': [], 'stage': 'request'})
        self.assertNotIn('private', json.dumps(value))

    def test_failure_envelope_has_code_locations_without_exception_text(self):
        session = ProtocolSession()
        with patch.object(session, '_dispatch_workspace', side_effect=ValueError('/Users/private/body')):
            response = session.dispatch({'protocol': '1.0', 'id': '11111111-1111-4111-8111-111111111111', 'method': 'workspace.open', 'params': {}})
        diagnostic = response['error']['details']['diagnostic']
        self.assertTrue(diagnostic['trace'])
        self.assertEqual(diagnostic['trace'][0]['module'], 'protocol.py')
        self.assertNotIn('private', json.dumps(response))

    def test_relative_frozen_filename_keeps_only_trusted_module_locations(self):
        scope = {"__name__": "sztu_docs_backend.exporter"}
        exec(compile("def _run(): raise ValueError('/Users/private/name')",
                     "sztu_docs_backend/exporter.py", "exec"), scope)
        try:
            scope["_run"]()
        except ValueError as exc:
            value = _diagnostic_details(exc)["diagnostic"]
        self.assertEqual(value["stage"], "external_render")
        self.assertEqual(value["trace"], [{"module": "exporter.py", "line": 1}])

    def test_progress_is_opt_in_and_correlated_on_the_real_protocol_stream(self):
        request = {"protocol": "1.0", "id": "11111111-1111-4111-8111-111111111111",
                   "method": "environment.check", "params": {}}
        for opted_in in (False, True):
            output = io.StringIO()
            with patch("sztu_docs_backend.protocol.check_environment", return_value={"ready": True}):
                serve(io.StringIO(json.dumps({**request, **({"diagnostics": True} if opted_in else {})}) + "\n"), output)
            messages = list(map(json.loads, output.getvalue().splitlines()))
            self.assertTrue(messages[-1]["ok"])
            self.assertEqual(len(messages), 3 if opted_in else 1)
            if opted_in:
                self.assertEqual(messages[1]["request_id"], request["id"])
                self.assertEqual(messages[1]["step"]["stage"], "environment_probe")
                self.assertEqual(messages[1]["step"]["outcome"], "success")

    def test_nonzero_subprocess_reports_stage_and_classification_without_stderr(self):
        for stage, marker, reason in [
            ("pdf_compile", "Undefined control sequence", "tex_input_rejected"),
            ("glyph_validation", "diagnostic failure", "tool_nonzero"),
            ("word_render", "Permission denied", "permission_denied"),
        ]:
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as root:
                records = []
                token = emitter.set(records.append)
                try:
                    script = f"import sys; print({marker!r} + ' /Users/private/file', file=sys.stderr); sys.exit(23)"
                    with self.assertRaises(exporter.ExportError) as error:
                        exporter._run([sys.executable, "-c", script], cwd=Path(root), diagnostic_stage=stage)
                    self.assertEqual(error.exception.code, "RENDER_FAILED")
                finally:
                    emitter.reset(token)
                self.assertEqual(records[-1]["stage"], stage)
                self.assertEqual(records[-1]["exit_code"], 23)
                self.assertEqual(records[-1]["reason"], reason)
                self.assertNotIn("private", json.dumps(records))

    def test_storage_and_cancel_are_not_generic_renderer_failures(self):
        records = []
        token = emitter.set(records.append)
        try:
            with self.assertRaises(PermissionError):
                with step("draft_save"):
                    raise PermissionError(errno.EACCES, "secret path")
            with self.assertRaises(exporter.ExportError):
                with step("preview_rasterize"):
                    raise exporter.ExportError("EXPORT_CANCELLED", "cancelled")
        finally:
            emitter.reset(token)
        self.assertEqual(records[1]["reason"], "permission_denied")
        self.assertEqual(records[-1]["outcome"], "cancelled")
        self.assertNotIn("secret", json.dumps(records))
