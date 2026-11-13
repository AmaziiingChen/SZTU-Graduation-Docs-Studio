from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend import exporter
from sztu_docs_backend.full_diagnostics import Case, current_case, finalize_desktop_case, recover_interrupted_case, record_machine
from sztu_docs_backend.server import serve


class FullDiagnosticsTests(unittest.TestCase):
    def test_manually_creates_archive_even_when_no_operation_failed(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"SZTU_DOCS_DATA_DIR": root}):
            case_id = str(uuid.uuid4())
            source = io.StringIO(json.dumps({
                "protocol": "1.0", "id": case_id, "method": "diagnostic.prepare",
                "diagnostics": True, "params": {},
            }) + "\n")
            output = io.StringIO()
            environment = {"ready": True, "checks": [{"status": "pass"}]}
            with patch("sztu_docs_backend.protocol.check_environment", return_value=environment):
                serve(source, output)
            response = json.loads(output.getvalue().splitlines()[-1])
            self.assertEqual(response["result"]["diagnostic_case_id"], case_id)
            archive_path = Path(root) / "diagnostics/full" / case_id / "case.zip"
            with zipfile.ZipFile(archive_path) as archive:
                self.assertEqual(json.loads(archive.read("environment.json")), environment)
                self.assertIn("工作区尚未打开", json.loads(archive.read("manifest.json"))["missing"])

    def test_stream_archives_original_error_and_keeps_success_out_of_diagnostics(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"SZTU_DOCS_DATA_DIR": root}):
            failed_id = str(uuid.uuid4())
            successful_id = str(uuid.uuid4())
            def check(params):
                if params.get("force"):
                    os.write(2, bytes([255, 254]) + b"synthetic engine error\n")
                    raise OSError("合成故障 /Users/example/草稿.docx")
                return {"checks": [{"status": "pass"}]}

            with patch("sztu_docs_backend.protocol.SYSTEM_METHODS", {"environment.check": check}):
                source = io.StringIO("".join(json.dumps({
                    "protocol": "1.0", "id": case_id, "method": "environment.check", "diagnostics": True,
                    "params": {"force": case_id == failed_id},
                }) + "\n" for case_id in [failed_id, successful_id]))
                output = io.StringIO()
                with self.assertLogs("sztu_docs_backend.protocol", level="ERROR"):
                    serve(source, output)
            failed, successful = map(json.loads, output.getvalue().splitlines())
            self.assertEqual(failed["error"]["details"]["diagnostic_case_id"], failed_id)
            self.assertNotIn("草稿.docx", output.getvalue())
            self.assertTrue(successful["ok"])
            base = Path(root) / "diagnostics/full"
            self.assertFalse((base / successful_id).exists())
            with zipfile.ZipFile(base / failed_id / "case.zip") as archive:
                self.assertIn("草稿.docx", archive.read("exceptions/001.txt").decode())
                self.assertEqual(json.loads(archive.read("request.json"))["id"], failed_id)
                self.assertEqual(archive.read("engine-stderr.bin"), bytes([255, 254]) + b"synthetic engine error\n")

    def test_raw_bytes_partial_artifact_and_recovery_survive_archive(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"SZTU_DOCS_DATA_DIR": root}):
            case = Case(str(uuid.uuid4()), "preview.generate")
            record_machine(case)
            case.stage({"stage": "pdf_compile", "outcome": "started"})
            token = current_case.set(case)
            try:
                with self.assertRaises(exporter.ExportError):
                    exporter._run(
                        [sys.executable, "-c",
                         "import os; from pathlib import Path; "
                         "p = Path(os.environ['SZTU_DOCS_RENDER_EVIDENCE_DIR']); p.mkdir(); "
                         "(p / 'compiler.bin').write_bytes(bytes([253])); "
                         "os.write(1, bytes([255])); os.write(2, bytes([254])); raise SystemExit(23)"],
                        cwd=Path(root),
                    )
                case.write("render-work/partial.pdf", b"%PDF-raw-partial")
            finally:
                current_case.reset(token)
            recover_interrupted_case(case.case_id)
            with zipfile.ZipFile(case.path / "case.zip") as archive:
                self.assertEqual(archive.read("tools/001/stdout.bin"), bytes([255]))
                self.assertEqual(archive.read("tools/001/stderr.bin"), bytes([254]))
                self.assertEqual(archive.read("tools/001/nested/compiler.bin"), bytes([253]))
                self.assertEqual(archive.read("render-work/partial.pdf"), b"%PDF-raw-partial")
                self.assertEqual(json.loads(archive.read("stages.json")), [{"stage": "pdf_compile", "outcome": "started"}])
                self.assertTrue(json.loads(archive.read("manifest.json"))["missing"])

    def test_desktop_verification_failure_keeps_successful_engine_evidence(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"SZTU_DOCS_DATA_DIR": root}):
            case = Case(str(uuid.uuid4()), "preview.generate")
            record_machine(case)
            case.write("render-work/main.pdf", b"synthetic-pdf")
            case.finish({"ok": True, "result": {"verified_by_engine": True}}, defer_success=True)
            self.assertFalse((case.path / "case.zip").exists())
            finalize_desktop_case(case.case_id, error={"stack": "synthetic desktop validation failure"})
            with zipfile.ZipFile(case.path / "case.zip") as archive:
                self.assertTrue(json.loads(archive.read("engine-response.json"))["result"]["verified_by_engine"])
                self.assertIn(b"synthetic desktop", archive.read("desktop-error.json"))
                self.assertEqual(archive.read("render-work/main.pdf"), b"synthetic-pdf")
