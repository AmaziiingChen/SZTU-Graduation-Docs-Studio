"""Exercise the shipped Windows sidecar with synthetic drafts and seven exports.

Keeps evidence in a fresh output directory. Never opens the user's real workspace.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import threading
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KINDS = ("proposal", "task_book", "midterm", "advisor_review", "reviewer_review", "defense_record", "grade_assessment")


class Sidecar:
    def __init__(self, bundle: Path, data: Path, log: Path):
        resources = bundle / "resources"
        runtime = resources / "offline-runtime"
        env = {k: v for k, v in os.environ.items() if not k.startswith("SZTU_") and k not in {"PYTHONPATH", "PYTHONHOME"}}
        env.update({"SZTU_DOCS_DATA_DIR": str(data), "SZTU_DOCS_TEMPLATE_PACKS_DIR": str(resources / "template-packs"),
            "SZTU_DOCS_BUNDLED_ENGINES_DIR": str(resources / "bundled-template-engines"),
            "SZTU_FONT_DIR": str(resources / "document-fonts"), "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
        if runtime.is_dir():
            env["PATH"] = os.pathsep.join([str(runtime / "texlive/bin/windows"), str(runtime / "poppler/Library/bin"), str(Path(env["SYSTEMROOT"]) / "System32")])
        self.log = log.open("w", encoding="utf-8")
        self.process = subprocess.Popen([str(resources / "sidecar/sztu-docs-backend.exe")], cwd=resources / "backend", env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log, text=True, encoding="utf-8")

    def call(self, method: str, params: dict | None = None) -> dict:
        identifier = str(uuid.uuid4())
        assert self.process.stdin and self.process.stdout
        self.process.stdin.write(json.dumps({"protocol": "1.0", "id": identifier, "method": method, "params": params or {}}, ensure_ascii=False) + "\n")
        self.process.stdin.flush()
        replies: queue.Queue[str] = queue.Queue(maxsize=1)
        threading.Thread(target=lambda: replies.put(self.process.stdout.readline()), daemon=True).start()
        response = json.loads(replies.get(timeout=240))
        if response.get("id") != identifier or not response.get("ok"):
            raise RuntimeError(f"{method}: {response.get('error', response)}")
        return response["result"]

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        for stream in (self.process.stdin, self.process.stdout):
            if stream:
                stream.close()
        self.log.close()


def create_profile(sidecar: Sidecar) -> dict:
    return sidecar.call("workspace.saveProfile", {"profile": {"full_name": "合成验收学生", "student_number": "WIN-TEST-001",
        "college": "合成学院", "major": "合成专业", "class_name": "合成班级", "advisor_name": "合成教师",
        "advisor_title": "合成职称", "graduation_cohort": "2026届", "thesis_title": ["合成Windows安装包验收题目"]}})


def create_document(sidecar: Sidecar, profile_id: str, kind: str, content: dict, schema_version: str = "0.1") -> dict:
    document = sidecar.call("workspace.createDocument", {"document": {"profile_id": profile_id, "document_type": kind,
        "template_version": "acceptance", "schema_version": schema_version, "title": f"合成验收-{kind}"}})
    return sidecar.call("workspace.saveDraft", {"document_id": document["id"], "content": content, "expected_revision": 0, "reason": "manual"})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--template-root", type=Path, default=ROOT.parent / "Thesis")
    parser.add_argument("--previous-bundle", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to((ROOT / "tmp").resolve()):
        raise RuntimeError("Acceptance evidence must remain inside this repository's tmp directory")
    output.mkdir(parents=True, exist_ok=False)
    data = output / "synthetic-workspace"
    prior = None
    if args.previous_bundle:
        old = Sidecar(args.previous_bundle.resolve(), data, output / "previous-sidecar.log")
        try:
            old.call("workspace.open", {"mode": "persistent"})
            profile = create_profile(old)
            content = {"acceptance_marker": "synthetic draft preserved across application versions"}
            document = create_document(old, profile["id"], "proposal", content)
            prior = {"profile_id": profile["id"], "document_id": document["id"], "content": content}
        finally:
            old.close()
    sidecar = Sidecar(args.bundle.resolve(), data, output / "current-sidecar.log")
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    report = {"version": version, "input": "synthetic only", "system_python_and_tex_path": "excluded", "previous_draft_restored": False, "documents": []}
    try:
        sidecar.call("system.ping")
        workspace = sidecar.call("workspace.open", {"mode": "persistent"})
        if prior:
            assert workspace["profile"]["id"] == prior["profile_id"]
            assert workspace["document"]["id"] == prior["document_id"]
            assert workspace["document"]["content"] == prior["content"]
            report["previous_draft_restored"] = True
            profile = workspace["profile"]
        else:
            profile = create_profile(sidecar)
        checks = sidecar.call("environment.check")["checks"]
        report["environment"] = {c["id"]: c["status"] for c in checks}
        for kind in KINDS:
            folder = args.template_root / "templates" / kind.replace("_", "-") / "fixtures"
            fixture = folder / "minimal.json"
            if not fixture.is_file():
                fixture = folder / "normal.json"
            payload = json.loads(fixture.read_text(encoding="utf-8"))
            replacements = {"title": "合成Windows安装包验收题目", "student_name": "合成验收学生", "student_id": "WIN-TEST-001",
                "college": "合成学院", "major": "合成专业", "advisor": "合成教师"}
            payload["metadata"].update({key: value for key, value in replacements.items() if key in payload["metadata"]})
            document = create_document(sidecar, profile["id"], kind, {"metadata": payload["metadata"], "sections": payload["sections"]}, payload["schema_version"])
            cancellation_root = data / "cancellations"
            cancellation_root.mkdir(exist_ok=True)
            cancel = str(cancellation_root / f"cancel-{uuid.uuid4().hex}")
            preview = sidecar.call("preview.generate", {"document_id": document["id"], "request_id": str(uuid.uuid4()), "cancellation_file": cancel, "app_version": version})
            target = output / "exports" / kind
            target.mkdir(parents=True)
            preflight = sidecar.call("export.preflight", {"document_id": document["id"], "preview_id": preview["preview_id"], "output_directory": str(target), "formats": ["docx", "pdf"]})
            receipt = sidecar.call("export.run", {"document_id": document["id"], "preview_id": preview["preview_id"], "output_directory": str(target), "formats": ["docx", "pdf"],
                "request_id": str(uuid.uuid4()), "preflight_token": preflight["preflight_token"], "overwrite_confirmed": False, "cancellation_file": cancel, "app_version": version})
            report["documents"].append({"kind": kind, "preview_pages": len(preview["pages"]), "preview": preview,
                "export": receipt, "target_editor_verified": False})
            (output / "acceptance.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({"kind": kind, "preview_pages": len(preview["pages"]), "export": "pass"}), flush=True)
    finally:
        sidecar.close()
    print(json.dumps({"acceptance": "pass", "previous_draft_restored": report["previous_draft_restored"], "document_types": len(report["documents"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
