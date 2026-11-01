from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend.exporter import build_export_document, validate_document
from sztu_docs_backend.protocol import ProtocolSession
from sztu_docs_backend.reference_sample import SAMPLE_SETTING, initialize_reference_sample
from sztu_docs_backend.storage import Workspace


class ReferenceSampleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.directory.name) / "app-data"
        self.workspace = Workspace.open_persistent(self.data_dir)

    def tearDown(self) -> None:
        self.workspace.close()
        self.directory.cleanup()

    def test_fresh_workspace_has_editable_profile_and_three_valid_documents(self) -> None:
        self.assertTrue(initialize_reference_sample(self.workspace))
        profile = self.workspace.list_profiles()[0]
        self.assertEqual(profile["full_name"], "林知远")
        self.assertEqual(profile["student_number"], "202300302001")
        self.assertEqual(self.workspace.load_profile_draft()["full_name"], "林知远")
        scripts = {run.get("script") for run in profile["thesis_title"][0]["runs"]}
        self.assertTrue({"sub", "super"} <= scripts)
        documents = self.workspace.list_documents()
        self.assertEqual({item["document_type"] for item in documents}, {"task_book", "proposal", "midterm"})
        self.assertEqual(self.workspace.load_active()["document"]["document_type"], "task_book")
        for record in documents:
            self.assertFalse(record["is_temporary"])
            self.assertEqual(record["current_revision"], 1)
            document = self.workspace.get_document(record["id"])
            validate_document(record["document_type"], build_export_document(self.workspace, document))
            if record["document_type"] in {"task_book", "proposal"}:
                bibliography = document["content"]["editor_state"]["bibliography"]
                self.assertIn("@article{hannink2000toughening", bibliography["source_text"])
                self.assertEqual(bibliography["entry_count"], 3)
            if record["document_type"] == "task_book":
                for stage in document["content"]["sections"]["schedule"]:
                    self.assertRegex(stage["period"], r"^\d{4}年\d{1,2}月\d{1,2}日—\d{4}年\d{1,2}月\d{1,2}日$")
        assets = list((self.data_dir / "document-assets").glob("*.png"))
        self.assertEqual(len(assets), 3)
        for asset in assets:
            self.assertEqual(asset.stem, hashlib.sha256(asset.read_bytes()).hexdigest())
        midterm = next(item for item in documents if item["document_type"] == "midterm")
        content = self.workspace.get_document(midterm["id"])["content"]
        images = content["sections"]["main_research_content"]
        image = next(item for item in images if isinstance(item, dict) and item["type"] == "image")
        self.assertTrue(Path(image["path"]).is_file())

    def test_restart_keeps_edits_and_does_not_duplicate_the_sample(self) -> None:
        initialize_reference_sample(self.workspace)
        profile = self.workspace.list_profiles()[0]
        self.workspace.save_profile({**profile, "full_name": "修改后的合成学生"})
        self.workspace.close()
        self.workspace = Workspace.open_persistent(self.data_dir)
        self.assertFalse(initialize_reference_sample(self.workspace))
        self.assertEqual(self.workspace.list_profiles()[0]["full_name"], "修改后的合成学生")
        self.assertEqual(len(self.workspace.list_profiles()), 1)
        self.assertEqual(len(self.workspace.list_documents()), 3)

    def test_existing_unsaved_profile_input_prevents_initialization(self) -> None:
        self.workspace.save_profile_draft({"full_name": "尚未填完的合成资料"})
        self.assertFalse(initialize_reference_sample(self.workspace))
        self.assertEqual(self.workspace.load_profile_draft()["full_name"], "尚未填完的合成资料")
        self.assertEqual(self.workspace.list_profiles(), [])
        self.assertFalse((self.data_dir / "document-assets").exists())

    def test_existing_profile_without_sample_marker_is_untouched(self) -> None:
        profile = self.workspace.save_profile({
            "full_name": "已有合成用户", "student_number": "EXISTING-0001",
            "college": "合成学院", "major": "合成专业",
        })
        self.assertFalse(initialize_reference_sample(self.workspace))
        self.assertEqual(self.workspace.get_profile(profile["id"]), profile)
        self.assertEqual(self.workspace.list_documents(), [])

    def test_existing_unassigned_document_or_recycle_bin_prevents_initialization(self) -> None:
        document = self.workspace.create_document({
            "document_type": "proposal", "template_version": "fixture",
            "schema_version": "0.2", "title": "已有的合成草稿",
        })
        self.assertFalse(initialize_reference_sample(self.workspace))
        self.workspace.delete_document(document["id"])
        self.assertFalse(initialize_reference_sample(self.workspace))
        self.assertEqual(self.workspace.list_profiles(), [])
        self.assertEqual(len(self.workspace.list_deleted_documents()), 1)

    def test_removing_sample_records_does_not_recreate_them(self) -> None:
        initialize_reference_sample(self.workspace)
        with self.workspace.database.transaction(immediate=True) as connection:
            connection.execute("DELETE FROM documents")
            connection.execute("DELETE FROM student_profiles")
            connection.execute("DELETE FROM settings WHERE key != ?", (SAMPLE_SETTING,))
        self.assertFalse(initialize_reference_sample(self.workspace))
        self.assertEqual(self.workspace.list_documents(), [])

    def test_temporary_workspace_stays_empty(self) -> None:
        with Workspace.create_temporary() as workspace:
            self.assertFalse(initialize_reference_sample(workspace))
            self.assertEqual(workspace.list_profiles(), [])
            self.assertEqual(workspace.list_documents(), [])

    def test_failure_leaves_no_partial_records_and_next_start_can_retry(self) -> None:
        with patch("sztu_docs_backend.reference_sample.validate_document", side_effect=RuntimeError("fixture")):
            with self.assertRaises(RuntimeError):
                initialize_reference_sample(self.workspace)
        self.assertEqual(self.workspace.list_profiles(), [])
        self.assertEqual(self.workspace.list_documents(), [])
        self.assertIsNone(self.workspace.load_profile_draft())
        self.assertTrue(initialize_reference_sample(self.workspace))

    def test_destination_failure_rolls_back_already_inserted_records(self) -> None:
        self.workspace.database.connection.execute(f"""
            CREATE TRIGGER fail_sample BEFORE INSERT ON settings
            WHEN NEW.key = '{SAMPLE_SETTING}'
            BEGIN SELECT RAISE(ABORT, 'fixture'); END
        """)
        with self.assertRaises(sqlite3.IntegrityError):
            initialize_reference_sample(self.workspace)
        self.assertEqual(self.workspace.list_profiles(), [])
        self.assertEqual(self.workspace.list_documents(), [])
        self.assertIsNone(self.workspace.load_profile_draft())
        self.workspace.database.connection.execute("DROP TRIGGER fail_sample")
        self.assertTrue(initialize_reference_sample(self.workspace))

    def test_desktop_open_returns_sample_and_render_open_does_not_seed(self) -> None:
        self.workspace.close()
        with patch.dict(os.environ, {"SZTU_DOCS_DATA_DIR": str(self.data_dir)}):
            session = ProtocolSession()
            try:
                response = session.dispatch({
                    "protocol": "1.0", "id": str(uuid.uuid4()), "method": "workspace.open",
                    "params": {"mode": "persistent", "initialize_reference": True},
                })
                self.assertTrue(response["ok"], response)
                result = response["result"]
                self.assertEqual(result["profile"]["full_name"], "林知远")
                self.assertEqual(len(result["documents"]), 3)
                self.assertEqual(result["document"]["document_type"], "task_book")
                json.dumps(result)
            finally:
                session.close()
        with patch.dict(os.environ, {
            "SZTU_DOCS_DATA_DIR": str(self.data_dir.parent / "render-only"),
            "SZTU_DOCS_SIDECAR_ROLE": "render",
        }):
            session = ProtocolSession()
            try:
                response = session.dispatch({
                    "protocol": "1.0", "id": str(uuid.uuid4()), "method": "workspace.open",
                    "params": {"mode": "persistent", "initialize_reference": True},
                })
                self.assertTrue(response["ok"], response)
                self.assertEqual(session.workspace.list_documents(), [])
            finally:
                session.close()


if __name__ == "__main__":
    unittest.main()
