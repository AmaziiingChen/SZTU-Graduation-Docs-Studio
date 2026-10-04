"""Document navigation remains bounded and traversable beyond one page."""

import tempfile
import unittest
import uuid
from pathlib import Path

from sztu_docs_backend.protocol import ProtocolSession
from sztu_docs_backend.storage import Workspace


class DocumentPaginationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sztu-pagination-test-")
        self.workspace = Workspace.open_persistent(Path(self.temp.name))
        self.session = ProtocolSession()
        self.session.workspace, self.session.mode = self.workspace, "persistent"
        self.profile_payload = {
            "full_name": "虚构甲", "student_number": "PAGE-001",
            "college": "测试学院", "major": "测试专业",
        }
        self.profile = self.workspace.save_profile(self.profile_payload)

    def tearDown(self):
        self.session.close()
        self.temp.cleanup()

    def request(self, method, params):
        return self.session.dispatch({
            "protocol": "1.0", "id": str(uuid.uuid4()), "method": method, "params": params,
        })

    def create(self, profile_id, count):
        return [self.workspace.create_document({
            "profile_id": profile_id, "document_type": "proposal",
            "template_version": "test", "schema_version": "0.2", "title": f"虚构分页文档 {index}",
        }) for index in range(count)]

    def page(self, profile_id, *, deleted=False, cursor=None, limit=100):
        response = self.request("workspace.listDocuments", {
            "profile_id": profile_id, "deleted": deleted, "cursor": cursor, "limit": limit,
        })
        self.assertTrue(response["ok"], response)
        return response["result"]

    def test_snapshot_keeps_old_active_document_and_can_reach_every_metadata_row(self):
        documents = self.create(self.profile["id"], 115)
        active = documents[0]
        with self.workspace.database.transaction() as connection:
            connection.execute("UPDATE documents SET updated_at = '2026-10-02T00:00:00.000Z'")
            connection.execute("UPDATE documents SET updated_at = '2026-10-01T00:00:00.000Z' WHERE id = ?", (active["id"],))
        self.workspace.save_active(profile_id=self.profile["id"], document_id=active["id"])
        snapshot = self.request("workspace.load", {})["result"]
        self.assertEqual(snapshot["document"]["id"], active["id"])
        self.assertEqual(len(snapshot["documents"]), 100)
        self.assertNotIn(active["id"], {row["id"] for row in snapshot["documents"]})
        metadata = snapshot["documents_page"]
        self.assertTrue(metadata["has_more"])
        second = self.page(metadata["profile_id"], cursor=metadata["next_cursor"])
        self.assertEqual(len(second["documents"]), 15)
        self.assertFalse(second["has_more"])
        self.assertIsNone(second["next_cursor"])
        all_rows = snapshot["documents"] + second["documents"]
        self.assertEqual({row["id"] for row in all_rows}, {row["id"] for row in documents})
        self.assertEqual(len({row["id"] for row in all_rows}), 115)
        self.assertTrue(all("content" not in row for row in all_rows))
        self.assertEqual([row["id"] for row in all_rows[:-1]], sorted(row["id"] for row in all_rows[:-1]))

    def test_recycle_bin_fallback_keeps_its_actual_profile_scope_on_later_pages(self):
        active = self.create(self.profile["id"], 1)[0]
        other = self.workspace.save_profile({**self.profile_payload, "student_number": "PAGE-002"})
        recycled = self.create(other["id"], 105)
        for document in recycled:
            self.workspace.delete_document(document["id"])
        self.workspace.save_active(profile_id=self.profile["id"], document_id=active["id"])
        snapshot = self.request("workspace.load", {})["result"]
        self.assertEqual(snapshot["documents_page"]["profile_id"], self.profile["id"])
        metadata = snapshot["deleted_documents_page"]
        self.assertIsNone(metadata["profile_id"])
        self.assertTrue(metadata["has_more"])
        second = self.page(metadata["profile_id"], deleted=True, cursor=metadata["next_cursor"])
        rows = snapshot["deleted_documents"] + second["documents"]
        self.assertEqual({row["id"] for row in rows}, {row["id"] for row in recycled})
        self.assertTrue(all(row["profile_id"] == other["id"] for row in rows))
        self.assertEqual(self.page(self.profile["id"], deleted=True)["documents"], [])
        self.assertEqual(self.page(other["id"])["documents"], [])

    def test_more_than_500_unassigned_documents_are_bound_without_touching_deleted_or_other_profiles(self):
        documents = self.create(None, 503)
        deleted = self.create(None, 1)[0]
        self.workspace.delete_document(deleted["id"])
        other = self.workspace.save_profile({**self.profile_payload, "student_number": "PAGE-002"})
        other_document = self.create(other["id"], 1)[0]
        response = self.request("workspace.saveProfile", {
            "profile": {**self.profile_payload, "id": self.profile["id"]},
        })
        self.assertTrue(response["ok"], response)
        rows = self.workspace.database.connection.execute(
            "SELECT id FROM documents WHERE profile_id = ?", (self.profile["id"],)
        ).fetchall()
        self.assertEqual({row["id"] for row in rows}, {row["id"] for row in documents})
        self.assertIsNone(self.workspace.documents.get(deleted["id"], include_deleted=True)["profile_id"])
        self.assertEqual(self.workspace.get_document(other_document["id"])["profile_id"], other["id"])

    def test_cursor_and_limit_boundaries_are_rejected_without_echoing_input(self):
        valid = {"updated_at": "2026-10-03T00:00:00.000Z", "id": "a" * 32}
        invalid = [
            {"limit": 0}, {"limit": 101}, {"limit": True}, {"deleted": "yes"},
            {"profile_id": 42}, {"profile_id": ""}, {"cursor": "private-input"},
            {"cursor": {}}, {"cursor": {**valid, "extra": "private-input"}},
            {"cursor": {**valid, "id": "../private-input"}},
            {"cursor": {**valid, "updated_at": "2026-02-30T00:00:00.000Z"}},
        ]
        for change in invalid:
            with self.subTest(change=change):
                response = self.request("workspace.listDocuments", {
                    "profile_id": self.profile["id"], "deleted": False, **change,
                })
                self.assertFalse(response["ok"], response)
                self.assertEqual(response["error"]["code"], "VALIDATION")
                self.assertNotIn("private-input", str(response))
        self.assertEqual(self.page(None, cursor=valid, limit=1)["documents"], [])

    def test_workspace_refresh_resets_cursor_after_a_save_moves_an_old_document(self):
        documents = self.create(self.profile["id"], 3)
        with self.workspace.database.transaction() as connection:
            connection.execute("UPDATE documents SET updated_at = '2026-10-01T00:00:00.000Z'")
        first = self.page(self.profile["id"], limit=2)
        last = self.page(self.profile["id"], cursor=first["next_cursor"], limit=2)["documents"][0]
        self.workspace.save_draft(last["id"], {"body": "更新的虚构正文"}, 0)
        refreshed = self.request("workspace.load", {})["result"]
        self.assertEqual(refreshed["documents"][0]["id"], last["id"])
        self.assertEqual({row["id"] for row in refreshed["documents"]}, {row["id"] for row in documents})


if __name__ == "__main__":
    unittest.main()
