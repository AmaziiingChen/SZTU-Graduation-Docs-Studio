from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = BACKEND_ROOT / "src"


class CommandLineTests(unittest.TestCase):
    def run_sidecar(
        self, requests: list[dict[str, object]], data_dir: Path
    ) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(SOURCE_ROOT)
        environment["SZTU_DOCS_DATA_DIR"] = str(data_dir)
        return subprocess.run(
            [sys.executable, "-m", "sztu_docs_backend"],
            cwd=BACKEND_ROOT,
            env=environment,
            input="".join(
                json.dumps(request, ensure_ascii=False, separators=(",", ":")) + "\n"
                for request in requests
            ),
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=False,
            timeout=10,
        )

    @staticmethod
    def request(method: str, params: dict[str, object]) -> dict[str, object]:
        return {
            "protocol": "1.0",
            "id": str(uuid.uuid4()),
            "method": method,
            "params": params,
        }

    def test_stdout_contains_only_jsonl_and_logs_use_stderr(self) -> None:
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(SOURCE_ROOT)
        first_id = str(uuid.uuid4())
        last_id = str(uuid.uuid4())
        completed = subprocess.run(
            [sys.executable, "-m", "sztu_docs_backend"],
            cwd=BACKEND_ROOT,
            env=environment,
            input=(
                f'{{"protocol":"1.0","id":"{first_id}","method":"system.ping"}}\n'
                "{bad json}\n"
                f'{{"protocol":"1.0","id":"{last_id}","method":"unknown.method"}}\n'
            ),
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=False,
            timeout=10,
        )

        self.assertEqual(completed.returncode, 0)
        responses = [json.loads(line) for line in completed.stdout.splitlines()]
        self.assertEqual(len(responses), 3)
        self.assertEqual(responses[0]["id"], first_id)
        self.assertEqual(responses[1]["error"]["code"], "INVALID_JSON")
        self.assertEqual(responses[2]["error"]["code"], "METHOD_NOT_FOUND")
        self.assertIn("Rejected malformed JSON input", completed.stderr)
        self.assertNotIn("WARNING", completed.stdout)

    def test_persistent_workspace_recovers_across_process_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory) / "app-data"
            profile_id: str
            document_id: str

            first_requests = [
                self.request("workspace.open", {"mode": "persistent"}),
                self.request(
                    "workspace.saveProfile",
                    {
                        "profile": {
                            "full_name": "进程重启合成学生",
                            "student_number": "CLI-0001",
                            "college": "命令行示例学院",
                            "major": "命令行示例专业",
                        }
                    },
                ),
            ]
            first = self.run_sidecar(first_requests, data_dir)
            self.assertEqual(first.returncode, 0)
            first_responses = [
                json.loads(line) for line in first.stdout.splitlines()
            ]
            profile_id = first_responses[1]["result"]["id"]

            second_requests = [
                self.request("workspace.open", {"mode": "persistent"}),
                self.request(
                    "workspace.createDocument",
                    {
                        "document": {
                            "profile_id": profile_id,
                            "document_type": "proposal",
                            "template_version": "fixture-1",
                            "schema_version": "fixture-1",
                            "title": "进程重启合成开题报告",
                        }
                    },
                ),
            ]
            second = self.run_sidecar(second_requests, data_dir)
            self.assertEqual(second.returncode, 0)
            second_responses = [
                json.loads(line) for line in second.stdout.splitlines()
            ]
            document_id = second_responses[1]["result"]["id"]

            third = self.run_sidecar(
                [
                    self.request("workspace.open", {"mode": "persistent"}),
                    self.request(
                        "workspace.saveDraft",
                        {
                            "document_id": document_id,
                            "content": {"restart": "真实进程恢复"},
                            "expected_revision": 0,
                            "reason": "manual",
                        },
                    ),
                ],
                data_dir,
            )
            self.assertEqual(third.returncode, 0)

            reopened = self.run_sidecar(
                [self.request("workspace.open", {"mode": "persistent"})],
                data_dir,
            )
            self.assertEqual(reopened.returncode, 0)
            result = json.loads(reopened.stdout)["result"]
            self.assertEqual(result["profile"]["id"], profile_id)
            self.assertEqual(result["document"]["id"], document_id)
            self.assertEqual(result["document"]["content"], {"restart": "真实进程恢复"})


if __name__ == "__main__":
    unittest.main()
