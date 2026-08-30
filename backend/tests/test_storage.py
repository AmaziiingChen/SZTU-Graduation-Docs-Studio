from __future__ import annotations

import io
import json
import logging
import os
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend.storage import (
    MigrationError,
    NotFoundError,
    RevisionConflictError,
    ValidationError,
    Workspace,
)
from sztu_docs_backend.storage.database import BACKUP_PREFIX, DATABASE_FILENAME, Database
from sztu_docs_backend.storage.migrations import DEFAULT_MIGRATIONS, Migration
from sztu_docs_backend.storage.migrations import (
    v0002_export_pipeline,
    v0003_student_profile_shared_fields,
    v0004_student_profile_thesis_title,
)
from sztu_docs_backend.storage.paths import DATA_DIR_ENV


SYNTHETIC_SHA256 = "a" * 64


def synthetic_profile(number: str = "SYN-0001") -> dict[str, object]:
    return {
        "full_name": "合成学生甲",
        "student_number": number,
        "college": "示例学院",
        "major": "示例专业",
        "class_name": "示例班",
        "advisor_name": "合成教师乙",
        "advisor_title": "副教授",
        "graduation_cohort": "2026届",
        "thesis_title": [
            {"runs": [{"text": "合成", "bold": True}, {"text": "论文题目"}]}
        ],
    }


def synthetic_document(profile_id: str | None = None) -> dict[str, str | None]:
    return {
        "profile_id": profile_id,
        "document_type": "proposal",
        "template_version": "fixture-1",
        "schema_version": "fixture-1",
        "title": "合成开题报告",
    }


def synthetic_profile_draft(**updates: object) -> dict[str, object]:
    draft = {
        "full_name": "",
        "student_number": "",
        "college": "",
        "major": "",
        "class_name": "",
        "advisor_name": "",
        "advisor_title": "",
        "graduation_cohort": "",
        "thesis_title": None,
    }
    draft.update(updates)
    return draft


class StorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temporary_directory.name) / "app-data"

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_schema_migration_creates_all_owned_tables(self) -> None:
        with Database.open_persistent(self.data_dir) as database:
            tables = {
                row["name"]
                for row in database.connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            self.assertTrue(
                {
                    "schema_migrations",
                    "student_profiles",
                    "documents",
                    "draft_revisions",
                    "export_jobs",
                    "export_artifacts",
                    "template_installations",
                    "settings",
                }.issubset(tables)
            )
            version = database.connection.execute(
                "SELECT MAX(version) FROM schema_migrations"
            ).fetchone()[0]
            self.assertEqual(version, 4)

    def test_environment_variable_supplies_persistent_data_directory(self) -> None:
        with patch.dict(os.environ, {DATA_DIR_ENV: str(self.data_dir)}):
            with Workspace.open_persistent() as workspace:
                self.assertFalse(workspace.is_temporary)
        self.assertTrue((self.data_dir / DATABASE_FILENAME).is_file())

    def test_relative_data_directory_is_rejected(self) -> None:
        with self.assertRaises(ValidationError) as caught:
            Workspace.open_persistent("relative/app-data")
        self.assertEqual(caught.exception.code, "VALIDATION")

    @unittest.skipIf(os.name == "nt", "POSIX permission bits are not Windows ACLs")
    def test_local_database_uses_private_posix_permissions(self) -> None:
        with Workspace.open_persistent(self.data_dir):
            pass
        directory_mode = stat.S_IMODE(self.data_dir.stat().st_mode)
        database_mode = stat.S_IMODE((self.data_dir / DATABASE_FILENAME).stat().st_mode)
        self.assertEqual(directory_mode, 0o700)
        self.assertEqual(database_mode, 0o600)

    def test_profile_create_update_and_restart_persistence(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            created = workspace.save_profile(synthetic_profile())
            profile_id = created["id"]
            updated_payload = synthetic_profile()
            updated_payload.update({"id": profile_id, "major": "更新后的示例专业"})
            updated = workspace.save_profile(updated_payload)
            self.assertEqual(updated["major"], "更新后的示例专业")

        with Workspace.open_persistent(self.data_dir) as reopened:
            restored = reopened.get_profile(profile_id)
            self.assertEqual(restored["student_number"], "SYN-0001")
            self.assertEqual(restored["major"], "更新后的示例专业")
            self.assertEqual(restored["advisor_title"], "副教授")
            self.assertEqual(restored["graduation_cohort"], "2026届")
            self.assertEqual(restored["thesis_title"], synthetic_profile()["thesis_title"])

    def test_legacy_profile_update_preserves_new_optional_fields(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            created = workspace.save_profile(synthetic_profile())
            legacy_payload = {
                key: value
                for key, value in synthetic_profile().items()
                if key not in {"advisor_title", "graduation_cohort", "thesis_title"}
            }
            legacy_payload["id"] = created["id"]
            updated = workspace.save_profile(legacy_payload)
            self.assertEqual(updated["advisor_title"], "副教授")
            self.assertEqual(updated["graduation_cohort"], "2026届")
            self.assertEqual(updated["thesis_title"], synthetic_profile()["thesis_title"])

            legacy_payload.update(
                {
                    "advisor_title": None,
                    "graduation_cohort": None,
                    "thesis_title": None,
                }
            )
            cleared = workspace.save_profile(legacy_payload)
            self.assertIsNone(cleared["advisor_title"])
            self.assertIsNone(cleared["graduation_cohort"])
            self.assertIsNone(cleared["thesis_title"])

    def test_lists_and_active_selection_discover_records_after_restart(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            profile = workspace.save_profile(synthetic_profile())
            document = workspace.create_document(synthetic_document(profile["id"]))
            workspace.save_draft(document["id"], {"resume": "重启恢复"}, 0)
            workspace.save_active(
                profile_id=profile["id"], document_id=document["id"]
            )

        with Workspace.open_persistent(self.data_dir) as reopened:
            profiles = reopened.list_profiles()
            documents = reopened.list_documents(profile_id=profile["id"])
            active = reopened.load_active()
            self.assertEqual([item["id"] for item in profiles], [profile["id"]])
            self.assertEqual([item["id"] for item in documents], [document["id"]])
            self.assertEqual(active["profile"]["id"], profile["id"])
            self.assertEqual(active["document"]["id"], document["id"])
            self.assertEqual(active["document"]["content"], {"resume": "重启恢复"})

    def test_profile_student_number_is_unique(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            workspace.save_profile(synthetic_profile())
            with self.assertRaises(ValidationError) as caught:
                workspace.save_profile(synthetic_profile())
            self.assertEqual(caught.exception.details["field"], "student_number")

    def test_foreign_key_prevents_deleting_referenced_profile(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            profile = workspace.save_profile(synthetic_profile())
            workspace.create_document(synthetic_document(profile["id"]))
            with self.assertRaises(sqlite3.IntegrityError):
                with workspace.database.transaction(immediate=True) as connection:
                    connection.execute(
                        "DELETE FROM student_profiles WHERE id = ?", (profile["id"],)
                    )

    def test_document_profile_assignment_is_one_way_and_transactional(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            first_profile = workspace.save_profile(synthetic_profile("SYN-0001"))
            second_profile = workspace.save_profile(synthetic_profile("SYN-0002"))
            document = workspace.create_document(synthetic_document())
            assigned = workspace.assign_profile(document["id"], first_profile["id"])
            self.assertEqual(assigned["profile_id"], first_profile["id"])
            idempotent = workspace.assign_profile(
                document["id"], first_profile["id"]
            )
            self.assertEqual(idempotent["profile_id"], first_profile["id"])
            with self.assertRaises(ValidationError) as caught:
                workspace.assign_profile(document["id"], second_profile["id"])
            self.assertEqual(caught.exception.details["reason"], "already_assigned")
            self.assertEqual(
                workspace.get_document(document["id"])["profile_id"],
                first_profile["id"],
            )

    def test_draft_save_uses_optimistic_revision_and_survives_restart(self) -> None:
        with Workspace.open_persistent(self.data_dir) as first:
            document = first.create_document(synthetic_document())
            document_id = document["id"]
            saved = first.save_draft(
                document_id, {"topic": "合成主题一"}, 0, reason="manual"
            )
            self.assertEqual(saved["revision"], 1)
            with self.assertRaises(RevisionConflictError) as caught:
                first.save_draft(document_id, {"topic": "冲突内容"}, 0)
            self.assertEqual(caught.exception.code, "REVISION_CONFLICT")
            self.assertEqual(first.get_document(document_id)["current_revision"], 1)

        with Workspace.open_persistent(self.data_dir) as reopened:
            restored = reopened.get_document(document_id)
            self.assertEqual(restored["content"], {"topic": "合成主题一"})
            self.assertEqual(restored["save_reason"], "manual")

    def test_two_connections_detect_stale_autosave(self) -> None:
        with Workspace.open_persistent(self.data_dir) as first:
            document = first.create_document(synthetic_document())
            with Workspace.open_persistent(self.data_dir) as second:
                first.save_draft(document["id"], {"body": "先保存"}, 0)
                with self.assertRaises(RevisionConflictError) as caught:
                    second.save_draft(document["id"], {"body": "后保存"}, 0)
                self.assertEqual(caught.exception.details["actual_revision"], 1)

    def test_autosave_keeps_only_the_current_draft(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            document = workspace.create_document(synthetic_document())
            document_id = document["id"]
            for expected in range(4):
                workspace.save_draft(
                    document_id, {"sequence": expected + 1}, expected
                )
            revisions = [
                row[0]
                for row in workspace.database.connection.execute(
                    """
                    SELECT revision_number FROM draft_revisions
                    WHERE document_id = ? ORDER BY revision_number
                    """,
                    (document_id,),
                )
            ]
            self.assertEqual(revisions, [4])
            current = workspace.get_document(document_id)
            self.assertEqual(current["content"], {"sequence": 4})
            self.assertEqual(current["save_reason"], "auto")

    def test_temporary_workspace_never_creates_a_database_and_close_clears_it(self) -> None:
        with patch.dict(os.environ, {DATA_DIR_ENV: str(self.data_dir)}):
            workspace = Workspace.create_temporary()
            profile = workspace.save_profile(synthetic_profile())
            document = workspace.create_document(synthetic_document(profile["id"]))
            workspace.save_draft(document["id"], {"temporary": True}, 0)
            self.assertTrue(workspace.get_document(document["id"])["is_temporary"])
            self.assertFalse(self.data_dir.exists())
            workspace.close()
            with self.assertRaises(sqlite3.ProgrammingError):
                workspace.database.connection.execute("SELECT 1")
        self.assertFalse(self.data_dir.exists())

    def test_close_temporary_document_cascades_revisions(self) -> None:
        with Workspace.create_temporary() as workspace:
            document = workspace.create_document(synthetic_document())
            workspace.save_draft(document["id"], {"temporary": True}, 0)
            result = workspace.close_temporary_document(document["id"])
            self.assertTrue(result["deleted"])
            count = workspace.database.connection.execute(
                "SELECT COUNT(*) FROM draft_revisions"
            ).fetchone()[0]
            self.assertEqual(count, 0)

    def test_settings_round_trip_json(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            saved = workspace.set_setting("workbench.autosave", {"enabled": True})
            self.assertEqual(saved["value"], {"enabled": True})
            self.assertEqual(
                workspace.get_setting("workbench.autosave")["value"],
                {"enabled": True},
            )

    def test_incomplete_profile_draft_round_trips_without_document_revision(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            expected = synthetic_profile_draft(
                full_name="只填写到姓名",
                graduation_cohort="2028届",
            )
            self.assertEqual(
                workspace.save_profile_draft(
                    {"full_name": "只填写到姓名", "graduation_cohort": "2028届"}
                ),
                expected,
            )
            revision_count = workspace.database.connection.execute(
                "SELECT COUNT(*) FROM draft_revisions"
            ).fetchone()[0]
            self.assertEqual(revision_count, 0)

        with Workspace.open_persistent(self.data_dir) as reopened:
            self.assertEqual(reopened.load_profile_draft(), expected)
            cleared = reopened.save_profile_draft(synthetic_profile_draft())
            self.assertEqual(cleared, synthetic_profile_draft())

        with Workspace.open_persistent(self.data_dir) as reopened:
            self.assertEqual(reopened.load_profile_draft(), synthetic_profile_draft())

    def test_complete_profile_save_synchronizes_profile_input_draft(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            workspace.save_profile_draft(
                synthetic_profile_draft(full_name="不应覆盖正式档案")
            )
            profile = workspace.save_profile(synthetic_profile())
            self.assertEqual(
                workspace.load_profile_draft(),
                {
                    field: profile.get(field) or ""
                    for field in synthetic_profile_draft()
                },
            )

    def test_incomplete_profile_draft_does_not_relax_complete_profile(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            workspace.save_profile_draft({"full_name": "尚未填完"})
            with self.assertRaises(ValidationError) as caught:
                workspace.save_profile({"full_name": "尚未填完"})
            self.assertEqual(caught.exception.details["field"], "student_number")
            self.assertEqual(
                workspace.load_profile_draft()["full_name"], "尚未填完"
            )

    def test_export_snapshot_is_json_and_omits_host_output_path(self) -> None:
        forbidden_path = "/synthetic/private/export"
        with Workspace.open_persistent(self.data_dir) as workspace:
            profile = workspace.save_profile(synthetic_profile())
            document = workspace.create_document(synthetic_document(profile["id"]))
            workspace.save_draft(document["id"], {"body": "合成正文"}, 0)
            with workspace.database.transaction(immediate=True) as connection:
                connection.execute(
                    """
                    INSERT INTO export_jobs(
                        id, document_id, requested_formats_json, status, progress,
                        output_directory, created_at, updated_at
                    ) VALUES ('job-fixture', ?, '["docx"]', 'queued', 0, ?, 'now', 'now')
                    """,
                    (document["id"], forbidden_path),
                )
            snapshot = workspace.export_snapshot()
            encoded = json.dumps(snapshot, ensure_ascii=False)
            self.assertNotIn(forbidden_path, encoded)
            self.assertIn("合成正文", encoded)
            self.assertEqual(snapshot["export_jobs"][0]["requested_formats"], ["docx"])
            self.assertIsNone(snapshot["export_jobs"][0]["snapshot"])
            self.assertIsNone(snapshot["export_jobs"][0]["receipt"])
            self.assertEqual(snapshot["student_profiles"][0]["advisor_title"], "副教授")
            self.assertEqual(
                snapshot["student_profiles"][0]["graduation_cohort"], "2026届"
            )
            self.assertEqual(
                snapshot["student_profiles"][0]["thesis_title"],
                synthetic_profile()["thesis_title"],
            )

    def test_export_pipeline_migration_is_idempotent(self) -> None:
        with Database.open_persistent(self.data_dir) as database:
            with database.transaction(immediate=True) as connection:
                v0002_export_pipeline.apply(connection)
                v0002_export_pipeline.apply(connection)
            job_columns = [
                row["name"]
                for row in database.connection.execute("PRAGMA table_info(export_jobs)")
            ]
            self.assertEqual(len(job_columns), len(set(job_columns)))
            self.assertTrue(
                {
                    "snapshot_json",
                    "receipt_json",
                    "completed_at",
                    "overwrite_confirmed",
                }.issubset(job_columns)
            )
            indexes = {
                row["name"]
                for row in database.connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'index'"
                )
            }
            self.assertIn("idx_export_jobs_request_id", indexes)
            self.assertIn("idx_export_jobs_active_document", indexes)

    def test_student_profile_shared_fields_migration_is_idempotent(self) -> None:
        with Database.open_persistent(self.data_dir) as database:
            with database.transaction(immediate=True) as connection:
                v0003_student_profile_shared_fields.apply(connection)
                v0003_student_profile_shared_fields.apply(connection)
            columns = [
                row["name"]
                for row in database.connection.execute(
                    "PRAGMA table_info(student_profiles)"
                )
            ]
            self.assertEqual(len(columns), len(set(columns)))
            self.assertTrue({"advisor_title", "graduation_cohort"} <= set(columns))

    def test_student_profile_thesis_title_migration_is_idempotent(self) -> None:
        with Database.open_persistent(self.data_dir) as database:
            with database.transaction(immediate=True) as connection:
                v0004_student_profile_thesis_title.apply(connection)
                v0004_student_profile_thesis_title.apply(connection)
            columns = [
                row["name"]
                for row in database.connection.execute(
                    "PRAGMA table_info(student_profiles)"
                )
            ]
            self.assertEqual(len(columns), len(set(columns)))
            self.assertIn("thesis_title_json", columns)

    def test_v1_active_job_is_recovered_during_v2_migration(self) -> None:
        v1_only = (DEFAULT_MIGRATIONS[0],)
        with Database.open_persistent(self.data_dir, migrations=v1_only) as database:
            now = "2026-08-30T00:00:00Z"
            with database.transaction(immediate=True) as connection:
                connection.execute(
                    """
                    INSERT INTO student_profiles(
                        id, full_name, student_number, college, major,
                        created_at, updated_at
                    ) VALUES ('profile-v1', '合成人员', 'V1-001', '示例学院',
                              '示例专业', ?, ?)
                    """,
                    (now, now),
                )
                connection.execute(
                    """
                    INSERT INTO documents(
                        id, profile_id, document_type, template_version,
                        schema_version, title, created_at, updated_at
                    ) VALUES ('document-v1', 'profile-v1', 'proposal', 'v1',
                              'v1', '合成文档', ?, ?)
                    """,
                    (now, now),
                )
                connection.execute(
                    """
                    INSERT INTO export_jobs(
                        id, document_id, requested_formats_json, status,
                        progress, created_at, updated_at
                    ) VALUES ('job-v1', 'document-v1', '["docx"]',
                              'running', 20, ?, ?)
                    """,
                    (now, now),
                )

        with Database.open_persistent(self.data_dir) as migrated:
            row = migrated.connection.execute(
                """
                SELECT status, progress, error_code, completed_at
                FROM export_jobs WHERE id = 'job-v1'
                """
            ).fetchone()
            version = migrated.connection.execute(
                "SELECT MAX(version) FROM schema_migrations"
            ).fetchone()[0]
            self.assertEqual(version, 4)
            self.assertEqual(row["status"], "failed")
            self.assertEqual(row["progress"], 100)
            self.assertEqual(row["error_code"], "EXPORT_INTERRUPTED")
            self.assertIsNotNone(row["completed_at"])
            self.assertIsNotNone(migrated.last_backup)
            profile = migrated.connection.execute(
                """
                SELECT advisor_title, graduation_cohort, thesis_title_json
                FROM student_profiles WHERE id = 'profile-v1'
                """
            ).fetchone()
            self.assertIsNone(profile["advisor_title"])
            self.assertIsNone(profile["graduation_cohort"])
            self.assertIsNone(profile["thesis_title_json"])

    def test_export_job_unique_active_constraint_and_history(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            document = workspace.create_document(synthetic_document())
            first = workspace.create_export_job(
                document_id=document["id"],
                request_id="request-active-1",
                formats=["docx"],
                output_directory="/synthetic/output",
                input_sha256=SYNTHETIC_SHA256,
                template_id="synthetic.template",
                template_version="1.0",
                template_sha256="b" * 64,
                snapshot={"revision": 1},
            )
            self.assertEqual(first["status"], "queued")
            with self.assertRaises(ValidationError) as active_error:
                workspace.create_export_job(
                    document_id=document["id"],
                    request_id="request-active-2",
                    formats=["pdf"],
                    output_directory="/synthetic/output",
                    input_sha256=SYNTHETIC_SHA256,
                    template_id="synthetic.template",
                    template_version="1.0",
                    template_sha256="b" * 64,
                    snapshot={"revision": 1},
                )
            self.assertEqual(
                active_error.exception.details["reason"], "active_export_exists"
            )
            workspace.fail_export_job(first["id"], error_code="SYNTHETIC_FAILURE")
            second = workspace.create_export_job(
                document_id=document["id"],
                request_id="request-active-2",
                formats=["pdf"],
                output_directory="/synthetic/output",
                input_sha256=SYNTHETIC_SHA256,
                template_id="synthetic.template",
                template_version="1.0",
                template_sha256="b" * 64,
                snapshot={"revision": 1},
            )
            self.assertEqual(second["status"], "queued")
            history = workspace.list_export_jobs(document_id=document["id"])
            self.assertEqual([item["id"] for item in history], [second["id"], first["id"]])

    def test_export_snapshot_receipt_and_artifacts_round_trip(self) -> None:
        forbidden_directory = "/synthetic/private/export"
        frozen_snapshot = {
            "schema_version": "1.0",
            "output_directory": forbidden_directory,
            "document": {"revision": 7},
        }
        receipt = {
            "schema_version": "1.0",
            "status": "succeeded",
            "artifacts": [
                {"format": "docx", "path": f"{forbidden_directory}/proposal.docx"}
            ],
        }
        checks = [{"check_id": "docx-structure", "status": "pass"}]
        with Workspace.open_persistent(self.data_dir) as workspace:
            document = workspace.create_document(synthetic_document())
            job = workspace.create_export_job(
                document_id=document["id"],
                request_id="request-round-trip",
                formats=["docx"],
                output_directory=forbidden_directory,
                input_sha256=SYNTHETIC_SHA256,
                template_id="synthetic.template",
                template_version="1.0",
                template_sha256="b" * 64,
                snapshot=frozen_snapshot,
                overwrite_confirmed=True,
            )
            workspace.start_export_job(job["id"])
            completed = workspace.complete_export_job(
                job["id"],
                receipt=receipt,
                artifacts=[
                    {
                        "format": "docx",
                        "relative_path": "proposal.docx",
                        "sha256": "c" * 64,
                        "size_bytes": 1234,
                        "checks": checks,
                        "replaced_existing": True,
                    }
                ],
            )
            self.assertEqual(completed["snapshot"], frozen_snapshot)
            self.assertEqual(completed["receipt"], receipt)
            self.assertTrue(completed["overwrite_confirmed"])
            self.assertEqual(completed["artifacts"][0]["checks"], checks)
            self.assertTrue(completed["artifacts"][0]["replaced_existing"])

        with Workspace.open_persistent(self.data_dir) as reopened:
            restored = reopened.get_export_job(job["id"])
            self.assertEqual(restored["snapshot"], frozen_snapshot)
            self.assertEqual(restored["receipt"], receipt)
            self.assertEqual(restored["artifacts"][0]["relative_path"], "proposal.docx")
            owned_snapshot = reopened.export_snapshot()
            serialized = json.dumps(owned_snapshot, ensure_ascii=False)
            self.assertNotIn(forbidden_directory, serialized)
            self.assertEqual(
                owned_snapshot["export_jobs"][0]["snapshot"]["document"],
                {"revision": 7},
            )

    def test_interrupted_export_is_terminal_after_reopen(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            document = workspace.create_document(synthetic_document())
            job = workspace.create_export_job(
                document_id=document["id"],
                request_id="request-interrupted",
                formats=["pdf"],
                output_directory="/synthetic/output",
                input_sha256=SYNTHETIC_SHA256,
                template_id="synthetic.template",
                template_version="1.0",
                template_sha256="b" * 64,
                snapshot={"revision": 1},
            )
            workspace.start_export_job(job["id"])

        with Workspace.open_persistent(self.data_dir) as reopened:
            recovered = reopened.get_export_job(job["id"])
            self.assertEqual(recovered["status"], "failed")
            self.assertEqual(recovered["progress"], 100)
            self.assertEqual(recovered["error_code"], "EXPORT_INTERRUPTED")
            self.assertIsNotNone(recovered["completed_at"])
            self.assertIsNone(recovered["receipt"])

    def test_template_installation_metadata_round_trip_and_snapshot_privacy(self) -> None:
        install_path = "/synthetic/private/template"
        metadata = {"source": "synthetic", "contract_versions": {"proposal": "0.2"}}
        with Workspace.open_persistent(self.data_dir) as workspace:
            installed = workspace.upsert_template_installation(
                template_id="synthetic.template",
                version="1.0",
                manifest_sha256="d" * 64,
                install_path=install_path,
                metadata=metadata,
            )
            self.assertEqual(installed["metadata"], metadata)
            self.assertEqual(installed["install_path"], install_path)
            self.assertTrue(installed["enabled"])
            enabled = workspace.list_template_installations(enabled_only=True)
            self.assertEqual(enabled, [installed])
            serialized = json.dumps(workspace.export_snapshot(), ensure_ascii=False)
            self.assertNotIn(install_path, serialized)
            self.assertIn("synthetic.template", serialized)

    def test_delete_all_data_is_explicit_scoped_and_removes_app_backups(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            profile = workspace.save_profile(synthetic_profile())
            document = workspace.create_document(synthetic_document(profile["id"]))
            workspace.save_draft(document["id"], {"body": "待删除"}, 0)
            workspace.set_setting("fixture", True)
            backup_directory = self.data_dir / "backups"
            backup_directory.mkdir()
            owned_backup = backup_directory / f"{BACKUP_PREFIX}1-to-v2-fixture.sqlite3"
            owned_backup.write_bytes(b"fixture")
            unrelated = backup_directory / "keep-this-file.txt"
            unrelated.write_text("unrelated", encoding="utf-8")

            result = workspace.delete_all_data()
            self.assertTrue(result["deleted"])
            self.assertGreaterEqual(sum(result["record_counts"].values()), 4)
            self.assertFalse(owned_backup.exists())
            self.assertTrue(unrelated.exists())
            snapshot = workspace.export_snapshot()
            self.assertTrue(all(not snapshot[table] for table in (
                "student_profiles", "documents", "draft_revisions", "settings"
            )))

    def test_migration_failure_rolls_back_old_database_and_keeps_backup(self) -> None:
        with Workspace.open_persistent(self.data_dir) as workspace:
            profile = workspace.save_profile(synthetic_profile())
            profile_id = profile["id"]

        def failing_migration(connection: sqlite3.Connection) -> None:
            connection.execute("CREATE TABLE migration_partial(value TEXT)")
            connection.execute("UPDATE student_profiles SET major = '不应提交'")
            raise RuntimeError("synthetic migration failure")

        plan = DEFAULT_MIGRATIONS + (
            Migration(5, "synthetic_failure", failing_migration),
        )
        with self.assertRaises(MigrationError) as caught:
            Database.open_persistent(self.data_dir, migrations=plan)
        self.assertEqual(caught.exception.code, "MIGRATION_FAILED")

        raw = sqlite3.connect(self.data_dir / DATABASE_FILENAME)
        try:
            major = raw.execute(
                "SELECT major FROM student_profiles WHERE id = ?", (profile_id,)
            ).fetchone()[0]
            partial = raw.execute(
                "SELECT 1 FROM sqlite_master WHERE name = 'migration_partial'"
            ).fetchone()
            version = raw.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
        finally:
            raw.close()
        self.assertEqual(major, "示例专业")
        self.assertIsNone(partial)
        self.assertEqual(version, 4)

        backups = list((self.data_dir / "backups").glob(f"{BACKUP_PREFIX}*.sqlite3"))
        self.assertEqual(len(backups), 1)
        backup = sqlite3.connect(backups[0])
        try:
            backed_up_number = backup.execute(
                "SELECT student_number FROM student_profiles WHERE id = ?", (profile_id,)
            ).fetchone()[0]
        finally:
            backup.close()
        self.assertEqual(backed_up_number, "SYN-0001")

    def test_expected_failures_do_not_log_identity_content_or_full_paths(self) -> None:
        log_stream = io.StringIO()
        handler = logging.StreamHandler(log_stream)
        root_logger = logging.getLogger()
        root_logger.addHandler(handler)
        try:
            with Workspace.open_persistent(self.data_dir) as workspace:
                profile = workspace.save_profile(synthetic_profile())
                document = workspace.create_document(synthetic_document(profile["id"]))
                workspace.save_draft(document["id"], {"secret": "合成敏感正文"}, 0)
                with self.assertRaises(RevisionConflictError):
                    workspace.save_draft(
                        document["id"], {"secret": "另一个合成正文"}, 0
                    )
        finally:
            root_logger.removeHandler(handler)
        logs = log_stream.getvalue()
        self.assertNotIn("合成学生甲", logs)
        self.assertNotIn("SYN-0001", logs)
        self.assertNotIn("合成敏感正文", logs)
        self.assertNotIn(str(self.data_dir), logs)


if __name__ == "__main__":
    unittest.main()
