from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
PACKS = ROOT / "template-packs"
DEV_PACK = PACKS / "sztu-proposal-2026-dev"

spec = importlib.util.spec_from_file_location("validate_pack", PACKS / "validate_pack.py")
assert spec is not None and spec.loader is not None
validate_pack_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = validate_pack_module
spec.loader.exec_module(validate_pack_module)


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise AssertionError(f"{path} root must be an object")
    return value


def assert_strict_proposal_shape(test: unittest.TestCase, value: dict[str, Any]) -> None:
    test.assertEqual(set(value), {"schema_version", "metadata", "sections"})
    test.assertEqual(value["schema_version"], "0.2")
    test.assertEqual(
        set(value["metadata"]),
        {"title", "student_name", "student_id", "major", "college", "advisor"},
    )
    test.assertEqual(
        set(value["sections"]),
        {
            "significance_and_status",
            "research_content",
            "methods_and_means",
            "research_steps",
            "references",
        },
    )
    test.assertGreaterEqual(len(value["sections"]["significance_and_status"]), 2)
    for paragraphs in value["sections"].values():
        test.assertTrue(paragraphs)
        test.assertTrue(all(isinstance(item, (str, dict)) for item in paragraphs))


class ContractTests(unittest.TestCase):
    def test_all_contracts_are_json_objects(self) -> None:
        paths = sorted(CONTRACTS.glob("*.schema.json"))
        self.assertEqual(
            {path.name for path in paths},
            {
                "assessment-form.schema.json",
                "check-result.schema.json",
                "content-block.schema.json",
                "document-draft.schema.json",
                "environment-check-result.schema.json",
                "export-operations.schema.json",
                "export-receipt.schema.json",
                "export-request.schema.json",
                "ipc-envelope.schema.json",
                "midterm.schema.json",
                "proposal.schema.json",
                "qa-policy.schema.json",
                "qa-record-operation.schema.json",
                "student-profile.schema.json",
                "task-book.schema.json",
                "telemetry-batch.schema.json",
                "template-install-operation.schema.json",
                "template-manifest.schema.json",
                "update-manifest.schema.json",
            },
        )
        schema_ids: set[str] = set()
        for path in paths:
            with self.subTest(path=path.name):
                content = load_json(path)
                self.assertEqual(
                    content["$schema"], "https://json-schema.org/draft/2020-12/schema"
                )
                self.assertNotIn(content["$id"], schema_ids)
                schema_ids.add(content["$id"])

    def test_update_manifest_contract_matches_both_runtime_versions(self) -> None:
        schema = load_json(CONTRACTS / "update-manifest.schema.json")
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(set(schema["required"]), {"payload", "signature"})
        self.assertEqual(
            schema["properties"]["payload"]["oneOf"],
            [
                {"$ref": "#/$defs/payloadV1"},
                {"$ref": "#/$defs/payloadV2"},
            ],
        )

        definitions = schema["$defs"]
        payload_v1 = definitions["payloadV1"]
        payload_v2 = definitions["payloadV2"]
        common_fields = {
            "schema_version",
            "channel",
            "version",
            "published_at",
            "artifacts",
        }
        for payload, fields in (
            (payload_v1, common_fields),
            (payload_v2, common_fields | {"control"}),
        ):
            self.assertFalse(payload["additionalProperties"])
            self.assertEqual(set(payload["required"]), fields)
            self.assertEqual(set(payload["properties"]), fields)

        self.assertEqual(payload_v1["properties"]["schema_version"], {"const": "1.0"})
        self.assertEqual(payload_v2["properties"]["schema_version"], {"const": "2.0"})
        self.assertEqual(
            payload_v1["properties"]["artifacts"],
            {
                "allOf": [
                    {"$ref": "#/$defs/artifacts"},
                    {"minItems": 1},
                ]
            },
        )
        self.assertEqual(
            payload_v2["properties"]["artifacts"],
            {"$ref": "#/$defs/artifacts"},
        )

        artifact_fields = {"platform", "arch", "url", "sha256", "size_bytes"}
        control_fields = {
            "update_policy",
            "minimum_supported_version",
            "service_status",
            "help_url",
            "announcement",
        }
        announcement_fields = {
            "id",
            "title",
            "body",
            "severity",
            "starts_at",
            "ends_at",
            "dismissible",
        }
        for definition_name, fields in (
            ("artifact", artifact_fields),
            ("control", control_fields),
            ("announcement", announcement_fields),
        ):
            definition = definitions[definition_name]
            self.assertFalse(definition["additionalProperties"])
            self.assertEqual(set(definition["required"]), fields)
            self.assertEqual(set(definition["properties"]), fields)

    def test_proposal_schema_matches_recorded_source(self) -> None:
        imported = CONTRACTS / "proposal.schema.json"
        self.assertEqual(
            hashlib.sha256(imported.read_bytes()).hexdigest(),
            "83b09f19d51d5c97474b2e0190f57243b7e82ebf33f490afca9a5f4377278565",
        )
        source_form = imported.read_text(encoding="utf-8").replace(
            "content-block.schema.json#",
            "../../common/schema/content-block.schema.json#",
        )
        self.assertEqual(
            hashlib.sha256(source_form.encode("utf-8")).hexdigest(),
            "5f1e91693aea33b50f30efe5caf50eb393640d4a4697a421676f094d9f4d0315",
        )
        thesis_root = os.environ.get("SZTU_THESIS_ROOT")
        if thesis_root:
            source = (
                Path(thesis_root)
                / "templates"
                / "proposal"
                / "schema"
                / "proposal.schema.json"
            )
            self.assertEqual(source_form.encode("utf-8"), source.read_bytes())

    def test_midterm_schema_and_common_blocks_match_recorded_source_contract(self) -> None:
        common = CONTRACTS / "content-block.schema.json"
        midterm = CONTRACTS / "midterm.schema.json"
        self.assertEqual(
            hashlib.sha256(common.read_bytes()).hexdigest(),
            "afe86f7b383979c08e46189d591cb51245906fd982d21b3f30d54ab8782cb340",
        )
        self.assertEqual(
            hashlib.sha256(midterm.read_bytes()).hexdigest(),
            "bb2b3c315d85a99f8710aa74e3699e41535c8e838f76df6108f8c88bcc6d7bc6",
        )
        source_form = midterm.read_text(encoding="utf-8").replace(
            "content-block.schema.json#",
            "../../common/schema/content-block.schema.json#",
        )
        self.assertEqual(
            hashlib.sha256(source_form.encode("utf-8")).hexdigest(),
            "8e616c350a863c0d1d5aee7db5b1de2823765882622fb83d08009cadbd082199",
        )
        thesis_root = os.environ.get("SZTU_THESIS_ROOT")
        if thesis_root:
            source_root = Path(thesis_root) / "templates"
            self.assertEqual(
                common.read_bytes(),
                (source_root / "common/schema/content-block.schema.json").read_bytes(),
            )
            self.assertEqual(
                source_form.encode("utf-8"),
                (source_root / "midterm/schema/midterm.schema.json").read_bytes(),
            )

    def test_common_lists_are_explicit_trees_capped_at_four_levels(self) -> None:
        common = load_json(CONTRACTS / "content-block.schema.json")["$defs"]
        self.assertEqual(
            common["orderedList"]["allOf"],
            [
                {"$ref": "#/$defs/listLevel1"},
                {"properties": {"type": {"const": "ordered_list"}}},
            ],
        )
        self.assertEqual(
            common["unorderedList"]["allOf"],
            [
                {"$ref": "#/$defs/listLevel1"},
                {"properties": {"type": {"const": "unordered_list"}}},
            ],
        )
        self.assertEqual(
            common["textContentBlock"]["oneOf"],
            [
                {"$ref": "#/$defs/paragraph"},
                {"$ref": "#/$defs/listBlock"},
                {"$ref": "#/$defs/figureGroup"},
                {"$ref": "#/$defs/dataTable"},
                {"$ref": "#/$defs/equation"},
            ],
        )
        self.assertEqual(common["richParagraph"]["properties"]["runs"]["items"]["oneOf"][1], {"$ref": "#/$defs/inlineEquation"})
        for level in range(1, 5):
            list_level = common[f"listLevel{level}"]
            item = list_level["properties"]["items"]["items"]["properties"]
            self.assertIn("marker", item)
            self.assertEqual(
                list_level["allOf"][0]["then"]["properties"]["items"]["items"],
                {"not": {"required": ["marker"]}},
            )
            if level < 4:
                self.assertEqual(
                    item["children"]["$ref"], f"#/$defs/listLevel{level + 1}"
                )
            else:
                self.assertNotIn("children", item)

    def test_proposal_only_enables_lists_in_three_body_sections(self) -> None:
        proposal = load_json(CONTRACTS / "proposal.schema.json")
        properties = proposal["properties"]["sections"]["properties"]
        for name in ("research_content", "methods_and_means", "research_steps"):
            self.assertEqual(properties[name]["$ref"], "#/$defs/textContentBlocks")
        self.assertEqual(
            proposal["$defs"]["textContentBlock"]["$ref"],
            "content-block.schema.json#/$defs/textContentBlock",
        )
        self.assertEqual(
            properties["significance_and_status"]["$ref"],
            "#/$defs/significanceParagraphs",
        )
        self.assertEqual(
            properties["references"]["$ref"], "#/$defs/referenceParagraphs"
        )

    def test_task_book_schema_matches_submitted_source_contract(self) -> None:
        task_book = CONTRACTS / "task-book.schema.json"
        self.assertEqual(
            hashlib.sha256(task_book.read_bytes()).hexdigest(),
            "9e9326b4332d3c6c04dcceb97f3e280f3f93666426484b98e483b19630d5e1ce",
        )
        source_form = task_book.read_text(encoding="utf-8").replace(
            "content-block.schema.json#",
            "../../common/schema/content-block.schema.json#",
        )
        self.assertEqual(
            hashlib.sha256(source_form.encode("utf-8")).hexdigest(),
            "16cfd7b8071c7164e356663fd4c5239cb10c4a738414a72882017129d1582ae4",
        )
        thesis_root = os.environ.get("SZTU_THESIS_ROOT")
        if thesis_root:
            source = (
                Path(thesis_root)
                / "templates/task-book/schema/task-book.schema.json"
            )
            self.assertEqual(source_form.encode("utf-8"), source.read_bytes())

    def test_draft_is_incomplete_but_export_uses_strict_proposal(self) -> None:
        draft = load_json(CONTRACTS / "document-draft.schema.json")
        incomplete = draft["$defs"]["incompleteProposal"]
        self.assertNotIn("required", incomplete)
        self.assertNotIn("required", incomplete["properties"]["metadata"])
        self.assertNotIn("required", incomplete["properties"]["sections"])
        self.assertEqual(
            draft["properties"]["document_type"]["enum"],
            ["proposal", "midterm", "task_book", "advisor_review", "reviewer_review", "defense_record", "grade_assessment"],
        )
        self.assertIn("incompleteTaskBook", draft["$defs"])
        self.assertNotIn("required", draft["$defs"]["incompleteTaskBook"])
        proposal_sections = incomplete["properties"]["sections"]["properties"]
        for name in ("research_content", "methods_and_means", "research_steps"):
            self.assertEqual(
                proposal_sections[name]["$ref"],
                "#/$defs/textContentBlocks",
            )
        self.assertEqual(
            draft["$defs"]["textContentBlock"]["oneOf"],
            [
                {"$ref": "#/$defs/paragraph"},
                {"$ref": "#/$defs/draftListLevel1"},
                {"$ref": "content-block.schema.json#/$defs/equation"},
            ],
        )
        self.assertEqual(
            draft["$defs"]["paragraph"]["oneOf"][0],
            {"type": "string", "maxLength": 5000},
        )
        for level in range(1, 5):
            properties = draft["$defs"][f"draftListLevel{level}"]["properties"]
            content = properties["items"]["items"]["properties"]
            self.assertEqual(content["content"]["$ref"], "#/$defs/paragraph")
            if level < 4:
                self.assertEqual(
                    content["children"]["$ref"],
                    f"#/$defs/draftListLevel{level + 1}",
                )
            else:
                self.assertNotIn("children", content)
        self.assertEqual(
            proposal_sections["significance_and_status"]["$ref"],
            "#/$defs/paragraphs",
        )
        self.assertEqual(
            proposal_sections["references"]["$ref"],
            "#/$defs/paragraphs",
        )
        for section_name in ("main_research_content", "progress"):
            self.assertEqual(
                draft["$defs"]["incompleteMidterm"]["properties"]["sections"]
                ["properties"][section_name]["$ref"],
                "#/$defs/textContentBlocks",
            )
        for section_name in (
            "basic_content_and_requirements",
            "required_materials",
        ):
            self.assertEqual(
                draft["$defs"]["incompleteTaskBook"]["properties"]["sections"]
                ["properties"][section_name]["$ref"],
                "#/$defs/textContentBlocks",
            )
        export = load_json(CONTRACTS / "export-request.schema.json")
        self.assertEqual(
            export["properties"]["document"]["oneOf"],
            [
                {"$ref": "proposal.schema.json"},
                {"$ref": "midterm.schema.json"},
                {"$ref": "task-book.schema.json"},
                {"$ref": "assessment-form.schema.json"},
            ],
        )
        strict = load_json(CONTRACTS / "proposal.schema.json")
        self.assertEqual(strict["required"], ["schema_version", "metadata", "sections"])
        midterm = load_json(CONTRACTS / "midterm.schema.json")
        self.assertEqual(midterm["required"], ["schema_version", "metadata", "sections"])
        task_book = load_json(CONTRACTS / "task-book.schema.json")
        self.assertEqual(task_book["required"], ["schema_version", "metadata", "sections"])

    def test_student_profile_contract_adds_optional_shared_fields(self) -> None:
        profile = load_json(CONTRACTS / "student-profile.schema.json")
        self.assertEqual(profile["properties"]["schema_version"]["const"], "1.2")
        student = profile["properties"]["student"]
        advisor = profile["properties"]["advisor"]
        self.assertIn("graduation_cohort", student["properties"])
        self.assertIn("advisor_title", advisor["properties"])
        self.assertIn("thesis_title", profile["properties"])
        self.assertEqual(profile["properties"]["thesis_title_en"]["oneOf"][1]["maxLength"], 300)
        self.assertEqual(
            profile["properties"]["thesis_title"]["oneOf"][1]["maxItems"],
            1,
        )
        self.assertNotIn("graduation_cohort", student["required"])
        self.assertTrue(advisor["properties"]["title"]["deprecated"])

    def test_telemetry_contract_never_accepts_arbitrary_attributes(self) -> None:
        schema = load_json(CONTRACTS / "telemetry-batch.schema.json")
        event = schema["properties"]["events"]["items"]
        rules = event["allOf"]
        self.assertEqual(len(rules), 4)
        for rule in rules:
            attributes = rule["then"]["properties"]["attributes"]
            variants = attributes.get("oneOf", [attributes])
            for variant in variants:
                self.assertIs(variant["additionalProperties"], False)
        serialized = json.dumps(schema, ensure_ascii=False)
        for forbidden in (
            "student_name",
            "student_number",
            "thesis_title",
            "file_path",
            "free_text",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_ipc_identifiers_are_uuid_strings_and_progress_is_distinct(self) -> None:
        envelope = load_json(CONTRACTS / "ipc-envelope.schema.json")
        identifier = envelope["$defs"]["identifier"]
        self.assertEqual(identifier["type"], "string")
        self.assertEqual(identifier["format"], "uuid")
        self.assertNotIn("integer", json.dumps(identifier))
        self.assertIn(
            {"$ref": "#/$defs/progressNotification"}, envelope["oneOf"]
        )
        self.assertEqual(
            envelope["$defs"]["cancelParams"]["properties"]["request_id"]["$ref"],
            "#/$defs/identifier",
        )

    def test_relative_contract_refs_have_targets(self) -> None:
        for path in CONTRACTS.glob("*.schema.json"):
            content = path.read_text(encoding="utf-8")
            for ref in __import__("re").findall(r'"\\$ref"\s*:\s*"([^"#][^"]*)"', content):
                target = ref.split("#", 1)[0]
                self.assertTrue((CONTRACTS / target).is_file(), f"missing $ref {ref} from {path.name}")

    def test_template_install_operation_selects_a_supported_document_type(self) -> None:
        operation = load_json(CONTRACTS / "template-install-operation.schema.json")["$defs"]
        params = operation["params"]
        self.assertEqual(params["required"], ["source_directory", "document_type"])
        self.assertEqual(
            params["properties"]["document_type"]["enum"],
            ["proposal", "midterm", "task_book", "advisor_review", "reviewer_review", "defense_record", "grade_assessment"],
        )
        self.assertEqual(
            operation["result"]["properties"]["status"]["enum"],
            ["linked", "updated", "already_current"],
        )
        self.assertEqual(
            operation["result"]["properties"]["source"]["const"],
            "linked-workspace",
        )

    def test_export_operation_fragments_are_explicit_and_closed(self) -> None:
        operations = load_json(CONTRACTS / "export-operations.schema.json")["$defs"]
        expected = {
            "preflightParams",
            "preflightResult",
            "runParams",
            "cancelParams",
            "cancelResult",
            "historyParams",
            "historyResult",
            "resolveArtifactParams",
            "resolvedArtifact",
            "openArtifactResult",
        }
        self.assertTrue(expected <= set(operations))
        for name in expected:
            with self.subTest(fragment=name):
                self.assertFalse(operations[name]["additionalProperties"])
        self.assertEqual(operations["formats"]["maxItems"], 3)
        self.assertEqual(operations["format"]["enum"], ["docx", "pdf", "tex"])
        self.assertEqual(
            operations["preflightResult"]["properties"]["preflight_token"]["pattern"],
            "^[a-f0-9]{64}$",
        )
        self.assertTrue(operations["resolvedArtifact"]["properties"]["verified"]["const"])
        self.assertEqual(
            operations["resolveArtifactParams"]["properties"]["artifact_id"]["$ref"],
            "#/$defs/internalId",
        )

    def test_manual_qa_contract_keeps_visual_gates_separate(self) -> None:
        qa = load_json(CONTRACTS / "qa-record-operation.schema.json")["$defs"]
        self.assertEqual(
            qa["params"]["properties"]["gate"]["enum"],
            ["full_page_layout", "target_editor"],
        )
        self.assertEqual(
            qa["params"]["properties"]["editor"]["enum"],
            ["word", "wps"],
        )
        self.assertEqual(qa["params"]["properties"]["status"]["enum"], ["pass", "fail"])
        checks = load_json(CONTRACTS / "check-result.schema.json")
        self.assertIn("full_page_layout", checks["properties"]["gate"]["enum"])
        self.assertIn("target_editor", checks["properties"]["gate"]["enum"])

    def test_python_contract_types_are_importable_without_dependencies(self) -> None:
        type_spec = importlib.util.spec_from_file_location(
            "python_contract_types", CONTRACTS / "python_contract_types.py"
        )
        self.assertIsNotNone(type_spec)
        self.assertIsNotNone(type_spec.loader)
        module = importlib.util.module_from_spec(type_spec)
        type_spec.loader.exec_module(module)
        self.assertTrue(hasattr(module, "ExportPreflightResult"))
        self.assertTrue(hasattr(module, "QaRecordParams"))


class TemplatePackTests(unittest.TestCase):
    def _copy_pack(self, temp: str) -> Path:
        destination = Path(temp) / "pack"
        shutil.copytree(DEV_PACK, destination)
        return destination

    def _assert_code(self, code: str, callable_: Any) -> None:
        with self.assertRaises(validate_pack_module.PackValidationError) as context:
            callable_()
        self.assertEqual(context.exception.code, code)

    def test_development_pack_is_trusted_and_discoverable(self) -> None:
        result = validate_pack_module.validate_pack(DEV_PACK)
        self.assertTrue(result["trusted"])
        self.assertEqual(result["template_id"], "sztu.proposal.2026.dev")
        self.assertEqual(result["files_verified"], 8)
        discovered = validate_pack_module.discover_packs(PACKS)
        self.assertEqual([item["template_id"] for item in discovered], [result["template_id"]])

    def test_all_four_fixtures_have_strict_proposal_shape(self) -> None:
        for name in ("short", "normal", "long", "layout_stress"):
            with self.subTest(name=name):
                assert_strict_proposal_shape(self, load_json(DEV_PACK / "fixtures" / f"{name}.json"))

    def test_tampered_file_fails_hash_gate(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            pack = self._copy_pack(temp)
            (pack / "fixtures" / "short.json").write_text("{}\n", encoding="utf-8")
            self._assert_code("HASH_MISMATCH", lambda: validate_pack_module.validate_pack(pack))

    def test_undeclared_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            pack = self._copy_pack(temp)
            (pack / "private.docx").write_bytes(b"not allowed")
            self._assert_code("UNDECLARED_FILE", lambda: validate_pack_module.validate_pack(pack))

    def test_path_traversal_and_absolute_paths_are_rejected(self) -> None:
        for hostile in ("../outside", "/tmp/outside", "renderer\\template.tex", "a//b"):
            with self.subTest(hostile=hostile), tempfile.TemporaryDirectory() as temp:
                pack = self._copy_pack(temp)
                manifest = load_json(pack / "manifest.json")
                manifest["files"][0]["path"] = hostile
                (pack / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                self._assert_code("PATH_INVALID", lambda: validate_pack_module.validate_pack(pack))

    def test_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            pack = self._copy_pack(temp)
            target = pack / "fixtures" / "short.json"
            target.unlink()
            try:
                target.symlink_to(pack / "fixtures" / "normal.json")
            except OSError as exc:
                self.skipTest(f"symlink unavailable: {exc}")
            self._assert_code("SYMLINK_FORBIDDEN", lambda: validate_pack_module.validate_pack(pack))

    def test_duplicate_path_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            pack = self._copy_pack(temp)
            manifest = load_json(pack / "manifest.json")
            manifest["files"].append(dict(manifest["files"][0]))
            (pack / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            self._assert_code("DUPLICATE_FILE", lambda: validate_pack_module.validate_pack(pack))

    def test_newer_and_unknown_contract_versions_are_rejected(self) -> None:
        for version, code in (("1.1", "CONTRACT_VERSION_TOO_NEW"), ("2.0", "CONTRACT_VERSION_UNSUPPORTED")):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as temp:
                pack = self._copy_pack(temp)
                manifest = load_json(pack / "manifest.json")
                manifest["contract_versions"]["app_contract"] = version
                (pack / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                self._assert_code(code, lambda: validate_pack_module.validate_pack(pack))


if __name__ == "__main__":
    unittest.main()
