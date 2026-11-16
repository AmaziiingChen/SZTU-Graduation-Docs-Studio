from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
import uuid
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from sztu_docs_backend.exporter import (
    ExportError,
    _graduation_year_from_cohort,
    _python_script_command,
    _preview_cache_identity,
    _render_content_without_editor_state,
    canonical_json,
    generate_preview,
    resolve_engine,
    run_export,
    validate_midterm,
    validate_proposal,
    validate_task_book,
)
from sztu_docs_backend.storage import Workspace


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
FIXTURE = (
    REPOSITORY_ROOT
    / "template-packs"
    / "sztu-proposal-2026-dev"
    / "fixtures"
    / "normal.json"
)


def proposal_fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@contextmanager
def retain_synthetic_render_failure():
    """Keep raw evidence before the integration test's temporary workspace disappears."""
    from sztu_docs_backend.full_diagnostics import Case, current_case, record_exception
    case = Case(str(uuid.uuid4()), "preview.generate")
    token = current_case.set(case)
    try:
        yield
    except Exception as exc:
        record_exception(exc)
        # Synthetic fixtures only; no real workspace or submission is accessed.
        for stderr in sorted(case.path.glob("tools/*/stderr.bin")):
            print(f"\n{stderr.relative_to(case.path)}:\n{stderr.read_bytes().decode('utf-8', errors='replace')}")
        for log in sorted(case.path.glob("render-work/**/main.log")):
            print("\nTeX log tail:\n" + "\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-100:]))
        case.finish({"ok": False, "error": {"code": getattr(exc, "code", type(exc).__name__), "message": str(exc)}})
        if os.environ.get("CI") and (case.path / "case.zip").is_file():
            destination = REPOSITORY_ROOT / "tmp/ci-acceptance/source-proposal-failure.zip"
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(case.path / "case.zip", destination)
        raise
    else:
        case.finish({"ok": True})
    finally:
        current_case.reset(token)


class ProposalContractTests(unittest.TestCase):
    def test_unresolved_math_source_blocks_proposal_export(self) -> None:
        proposal = proposal_fixture()
        proposal["sections"]["research_content"][0] = "计算 $\\unknown{x}$ 的结果。"
        with self.assertRaises(ExportError) as context:
            validate_proposal(proposal)
        self.assertEqual(context.exception.details["reason"], "unresolved_math_source")
        self.assertEqual(context.exception.details["field"], "sections.research_content[0]")

    def test_process_equations_accept_structured_math_and_reject_raw_commands(self) -> None:
        proposal = proposal_fixture()
        inline = {"type": "inline_equation", "expression": {"type": "fraction", "numerator": {"type": "text", "value": "a"}, "denominator": {"type": "text", "value": "b"}}, "alt": "a 除以 b"}
        proposal["sections"]["significance_and_status"][0] = {"runs": [{"text": "研究比值 "}, inline, {"text": " 的意义。"}]}
        proposal["sections"]["research_content"][0] = {"runs": [{"text": "比值 "}, inline, {"text": " 用于比较。"}]}
        proposal["sections"]["research_content"].append({"type": "equation", "expression": inline["expression"], "alt": "独立比值公式"})
        self.assertIs(validate_proposal(proposal), proposal)
        inline["expression"]["numerator"]["value"] = r"\input{private}"
        with self.assertRaises(ExportError) as context:
            validate_proposal(proposal)
        self.assertEqual(context.exception.details["reason"], "invalid_math")

    def test_optional_intro_can_be_edited_or_removed_without_completing_body(self) -> None:
        proposal = proposal_fixture()
        proposal["sections"].update({
            "research_content_intro": "研究范围如下：",
            "methods_and_means_intro": "",
            "research_steps_intro": "计划如下：",
        })
        self.assertIs(validate_proposal(proposal), proposal)
        proposal["sections"]["methods_and_means"] = []
        with self.assertRaises(ExportError) as context:
            validate_proposal(proposal)
        self.assertEqual(context.exception.details["field"], "sections.methods_and_means")

    def test_python_script_command_uses_frozen_sidecar_runner(self) -> None:
        script = Path("/private/template/render.py")
        with patch("sztu_docs_backend.exporter.sys.frozen", True, create=True):
            command = _python_script_command(script, "--data", "input.json")
        self.assertEqual(
            command[1:],
            ["--run-python-script", str(script), "--data", "input.json"],
        )

    def test_preview_cache_identity_changes_with_content_or_template(self) -> None:
        first = _preview_cache_identity("document-1", "a" * 64, "b" * 64)
        repeated = _preview_cache_identity("document-1", "a" * 64, "b" * 64)
        changed_content = _preview_cache_identity(
            "document-1", "c" * 64, "b" * 64
        )
        changed_template = _preview_cache_identity(
            "document-1", "a" * 64, "d" * 64
        )

        self.assertEqual(first, repeated)
        self.assertNotEqual(first, changed_content)
        self.assertNotEqual(first, changed_template)
        uuid.UUID(first[1])

    def test_valid_proposal_has_stable_canonical_json(self) -> None:
        proposal = proposal_fixture()
        self.assertIs(validate_proposal(proposal), proposal)
        self.assertEqual(canonical_json(proposal), canonical_json(proposal))
        self.assertEqual(
            hashlib.sha256(canonical_json(proposal)).hexdigest(),
            "a2d7e1fae335e5562f01ea79a903000a31c02802d275f2ee6b7da12452727173",
        )

    def test_significance_requires_two_paragraphs(self) -> None:
        proposal = proposal_fixture()
        proposal["sections"]["significance_and_status"] = ["只有一段"]
        with self.assertRaises(ExportError) as context:
            validate_proposal(proposal)
        self.assertEqual(context.exception.code, "DOCUMENT_NOT_READY")
        self.assertEqual(
            context.exception.details["field"],
            "sections.significance_and_status",
        )

    def test_strict_contract_still_rejects_an_empty_semantic_paragraph(self) -> None:
        proposal = proposal_fixture()
        proposal["sections"]["methods_and_means"].append("")
        with self.assertRaises(ExportError) as context:
            validate_proposal(proposal)
        self.assertEqual(
            context.exception.details["field"],
            f"sections.methods_and_means[{len(proposal['sections']['methods_and_means']) - 1}]",
        )

    def test_research_sections_accept_nested_lists_but_significance_does_not(self) -> None:
        proposal = proposal_fixture()
        nested = {
            "type": "ordered_list",
            "items": [
                {
                    "marker": "（1）",
                    "content": "完成一级研究。",
                    "children": {
                        "type": "unordered_list",
                        "items": [
                            {
                                "content": {
                                    "type": "paragraph",
                                    "runs": [{"text": "完成二级验证。", "bold": True}],
                                }
                            }
                        ],
                    },
                }
            ],
        }
        for name in ("research_content", "methods_and_means", "research_steps"):
            proposal["sections"][name] = [nested]
        self.assertIs(validate_proposal(proposal), proposal)

        proposal["sections"]["significance_and_status"] = [nested, "保留第二段。"]
        with self.assertRaises(ExportError) as context:
            validate_proposal(proposal)
        self.assertEqual(
            context.exception.details["field"],
            "sections.significance_and_status[0]",
        )

    def test_research_sections_accept_local_images_with_captions(self) -> None:
        proposal = proposal_fixture()
        image = {
            "type": "image",
            "id": "fig-proposal-example",
            "path": "images/proposal-example.png",
            "alt": "虚构的开题报告示意图",
            "chapter": 1,
            "width_mm": 96,
            "caption": "开题报告示意",
        }
        for name in ("research_content", "methods_and_means", "research_steps"):
            proposal["sections"][name] = [image]
        self.assertIs(validate_proposal(proposal), proposal)

        proposal["sections"]["research_content"] = [{**image, "caption": None}]
        with self.assertRaises(ExportError) as context:
            validate_proposal(proposal)
        self.assertEqual(context.exception.details["reason"], "missing_caption")

    def test_advisor_title_is_rejected_without_echoing_content(self) -> None:
        proposal = proposal_fixture()
        proposal["metadata"]["advisor"] = "测试教师教授"
        with self.assertRaises(ExportError) as context:
            validate_proposal(proposal)
        self.assertEqual(context.exception.details["field"], "metadata.advisor")
        self.assertNotIn("测试教师", str(context.exception.details))

    def test_title_accepts_rich_runs_without_migrating_legacy_strings(self) -> None:
        proposal = proposal_fixture()
        legacy_title = proposal["metadata"]["title"]
        self.assertIs(validate_proposal(proposal), proposal)

        proposal["metadata"]["title"] = {
            "type": "paragraph",
            "runs": [
                {"text": "g-C"},
                {"text": "3", "script": "sub"},
                {"text": "N"},
                {"text": "4", "script": "sub"},
                {"text": " 虚构课题"},
            ],
        }
        self.assertIs(validate_proposal(proposal), proposal)
        self.assertIsInstance(legacy_title, str)

    def test_significance_and_references_accept_optional_paragraph_type(self) -> None:
        proposal = proposal_fixture()
        proposal["sections"]["significance_and_status"] = [
            {"type": "paragraph", "runs": [{"text": "第一段"}]},
            {
                "type": "paragraph",
                "runs": [
                    {"text": "CO"},
                    {"text": "2", "script": "sub"},
                    {"text": " 第二段"},
                ],
            },
        ]
        proposal["sections"]["references"] = [
            {"type": "paragraph", "runs": [{"text": "[1] 合成文献[J]."}]}
        ]
        self.assertIs(validate_proposal(proposal), proposal)

    def test_valid_bibtex_editor_state_is_removed_from_render_input(self) -> None:
        source = (
            "@article{demo, author={测试作者}, title={合成条目}, "
            "journal={测试期刊}, year={2026}}"
        )
        content = {
            "metadata": {"title": "合成课题"},
            "sections": {"references": ["[1] 合成条目[J]."]},
            "editor_state": {
                "bibliography": {
                    "source_format": "bibtex",
                    "source_text": source,
                    "parse_status": "valid",
                    "entry_count": 1,
                }
            },
        }
        render_content = _render_content_without_editor_state(content, "proposal")
        self.assertNotIn("editor_state", render_content)
        self.assertIn("editor_state", content)
        self.assertNotIn(source, json.dumps(render_content, ensure_ascii=False))

    def test_valid_claim_with_invalid_bibtex_source_is_rejected(self) -> None:
        source = "@article{private-tampered, title={未闭合}"
        content = {
            "sections": {"references": ["[1] 不应导出的条目[J]."]},
            "editor_state": {
                "bibliography": {
                    "source_format": "bibtex",
                    "source_text": source,
                    "parse_status": "valid",
                    "entry_count": 1,
                }
            },
        }
        with self.assertRaises(ExportError) as context:
            _render_content_without_editor_state(content, "proposal")
        self.assertEqual(context.exception.code, "DOCUMENT_NOT_READY")
        self.assertEqual(
            context.exception.details["reason"], "invalid_bibtex_source"
        )
        self.assertNotIn(source, str(context.exception.details))

    def test_bibtex_declared_entry_count_must_match_parsed_source(self) -> None:
        source = (
            "@article{first, author={甲}, title={条目一}, journal={期刊}, year={2026}}\n"
            "@book{second, title={条目二}, year={2025}}"
        )
        content = {
            "sections": {"references": ["[1] 条目一[J].", "[2] 条目二[M]."]},
            "editor_state": {
                "bibliography": {
                    "source_format": "bibtex",
                    "source_text": source,
                    "parse_status": "valid",
                    "entry_count": 1,
                }
            },
        }
        with self.assertRaises(ExportError) as context:
            _render_content_without_editor_state(content, "proposal")
        self.assertEqual(context.exception.code, "DOCUMENT_NOT_READY")
        self.assertEqual(context.exception.details["reason"], "entry_count_mismatch")
        self.assertEqual(context.exception.details["parsed"], 2)

    def test_bibtex_reference_count_must_match_parsed_source(self) -> None:
        source = (
            "@article{first, author={甲}, title={条目一}, journal={期刊}, year={2026}}\n"
            "@book{second, title={条目二}, year={2025}}"
        )
        content = {
            "sections": {"references": ["[1] 条目一[J]."]},
            "editor_state": {
                "bibliography": {
                    "source_format": "bibtex",
                    "source_text": source,
                    "parse_status": "valid",
                    "entry_count": 2,
                }
            },
        }
        with self.assertRaises(ExportError) as context:
            _render_content_without_editor_state(content, "proposal")
        self.assertEqual(context.exception.code, "DOCUMENT_NOT_READY")
        self.assertEqual(
            context.exception.details["reason"], "reference_count_mismatch"
        )
        self.assertEqual(context.exception.details["rendered"], 1)

    def test_bibtex_gate_accepts_extended_reference_type_matrix(self) -> None:
        source = "\n".join(
            [
                "@standard{standard, title={测试标准}, year={2026}}",
                "@proceedings{proceedings, title={测试会议录}, year={2026}}",
                "@electronic{electronic, title={电子资料}, url={https://example.invalid}}",
                "@www{website, title={网站资料}, url={https://example.invalid/site}}",
            ]
        )
        references = [
            "[1] 测试标准[S].",
            "[2] 测试会议录[C].",
            "[3] 电子资料[EB/OL].",
            "[4] 网站资料[EB/OL].",
        ]
        content = {
            "sections": {"references": references},
            "editor_state": {
                "bibliography": {
                    "source_format": "bibtex",
                    "source_text": source,
                    "parse_status": "valid",
                    "entry_count": len(references),
                }
            },
        }

        render_content = _render_content_without_editor_state(content, "proposal")

        self.assertEqual(render_content["sections"]["references"], references)
        self.assertNotIn("editor_state", render_content)

    def test_bibtex_gate_rejects_incomplete_standard_without_echoing_source(self) -> None:
        source = "@standard{private-standard, title={缺少年份的标准}}"
        content = {
            "sections": {"references": ["[1] 不应导出的标准[S]."]},
            "editor_state": {
                "bibliography": {
                    "source_format": "bibtex",
                    "source_text": source,
                    "parse_status": "valid",
                    "entry_count": 1,
                }
            },
        }

        with self.assertRaises(ExportError) as context:
            _render_content_without_editor_state(content, "proposal")

        self.assertEqual(context.exception.code, "DOCUMENT_NOT_READY")
        self.assertEqual(
            context.exception.details["reason"], "invalid_bibtex_source"
        )
        self.assertNotIn(source, str(context.exception.details))

    def test_invalid_bibtex_editor_state_blocks_render_without_echoing_source(self) -> None:
        source = "@article{private-invalid-source}"
        content = {
            "editor_state": {
                "bibliography": {
                    "source_format": "bibtex",
                    "source_text": source,
                    "parse_status": "invalid",
                    "entry_count": 1,
                }
            }
        }
        with self.assertRaises(ExportError) as context:
            _render_content_without_editor_state(content, "proposal")
        self.assertEqual(context.exception.code, "DOCUMENT_NOT_READY")
        self.assertNotIn(source, str(context.exception.details))


def midterm_fixture() -> dict:
    return {
        "schema_version": "0.1",
        "metadata": {
            "student_name": "测试同学",
            "college": "测试学院",
            "major": "测试专业",
            "class_name": "测试一班",
            "advisor": "示例教师",
            "check_date": "2026-03-26",
            "title": {"type": "paragraph", "runs": [{"text": "虚构中期检查课题"}]},
        },
        "sections": {
            "numbering_style": "decimal_hierarchy",
            "directory": [
                {"level": 1, "number": "1.", "title": "绪论"},
                {"level": 2, "number": "1.1", "title": "研究背景"},
            ],
            "main_research_content": [
                {"type": "paragraph", "runs": [{"text": "研究虚构问题。"}]},
            ],
            "progress": [
                {
                    "type": "ordered_list",
                    "items": [{"marker": "（1）", "content": "已完成合成验证。"}],
                }
            ],
        },
    }


class MidtermContractTests(unittest.TestCase):
    def test_editable_headings_flag_is_validated(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["editable_headings"] = True
        midterm["sections"]["main_research_content"].insert(0, "主要研究内容：")
        midterm["sections"]["progress"].insert(0, "毕业论文（设计）工作进展情况（详述）：")
        self.assertIs(validate_midterm(midterm), midterm)
        midterm["sections"]["editable_headings"] = "true"
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(context.exception.details["field"], "sections.editable_headings")

    def test_unresolved_math_source_blocks_midterm_export(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["main_research_content"][0]["runs"][0]["text"] = "未完成 $x^"
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(context.exception.details["reason"], "unresolved_math_source")
        self.assertEqual(context.exception.details["field"], "sections.main_research_content[0].runs[0].text")

    def test_process_equations_are_validated_in_midterm_body(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["main_research_content"].append({"type": "equation", "expression": {"type": "square_root", "body": {"type": "text", "value": "x"}}, "alt": "x 的平方根"})
        self.assertIs(validate_midterm(midterm), midterm)
        midterm["sections"]["main_research_content"][-1]["alt"] = ""
        with self.assertRaises(ExportError):
            validate_midterm(midterm)

    def test_valid_midterm_accepts_directory_rich_text_and_ordered_lists(self) -> None:
        midterm = midterm_fixture()
        self.assertIs(validate_midterm(midterm), midterm)

    def test_directory_cannot_skip_an_outline_level(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["directory"][1]["level"] = 3
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(
            context.exception.details["field"],
            "sections.directory[1].level",
        )

    def test_directory_style_controls_the_maximum_depth(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["numbering_style"] = "chinese_hierarchy"
        midterm["sections"]["directory"] = [
            {"level": 1, "title": "一级"},
            {"level": 2, "title": "二级"},
            {"level": 3, "title": "三级"},
            {"level": 4, "title": "四级"},
            {"level": 5, "title": "五级"},
        ]
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(
            context.exception.details["field"],
            "sections.directory[4].level",
        )

    def test_directory_rejects_an_unknown_numbering_style(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["numbering_style"] = "mixed"
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(
            context.exception.details["field"],
            "sections.numbering_style",
        )

    def test_teacher_fields_are_not_part_of_student_input(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["teacher_opinion"] = "不应由学生端填写"
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(context.exception.details["field"], "sections")

    def test_lists_use_explicit_tree_depth_and_support_four_levels(self) -> None:
        midterm = midterm_fixture()
        level4 = {"type": "unordered_list", "items": [{"content": "第四级"}]}
        level3 = {
            "type": "ordered_list",
            "items": [{"content": "第三级", "children": level4}],
        }
        level2 = {
            "type": "unordered_list",
            "items": [{"content": "第二级", "children": level3}],
        }
        level1 = {
            "type": "ordered_list",
            "items": [{"content": "第一级", "children": level2}],
        }
        midterm["sections"]["progress"] = [level1]
        self.assertIs(validate_midterm(midterm), midterm)

        level4["items"][0]["children"] = {
            "type": "unordered_list",
            "items": [{"content": "第五级"}],
        }
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(context.exception.details["reason"], "list_depth_exceeded")
        self.assertEqual(context.exception.details["maximum"], 4)

    def test_unordered_list_rejects_number_markers(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["progress"] = [
            {
                "type": "unordered_list",
                "items": [{"marker": "1.", "content": "不能伪装成有序列表。"}],
            }
        ]
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(context.exception.details["reason"], "marker_forbidden")
        self.assertEqual(
            context.exception.details["field"],
            "sections.progress[0].items[0].marker",
        )

    def test_structured_figures_accept_stable_ids_and_cross_references(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["main_research_content"] = [
            {
                "type": "paragraph",
                "runs": [{"text": "总体流程见{{fig:fig-workflow_0001}}。"}],
            },
            {
                "type": "image",
                "id": "fig-workflow_0001",
                "path": "/private/app-data/figures/workflow.png",
                "alt": "虚构流程图",
                "chapter": 3,
                "width_mm": 118,
                "caption": {
                    "type": "paragraph",
                    "runs": [{"text": "统一数据入口与双路渲染流程"}],
                },
                "source_citation_key": "SyntheticWorkflow2026",
            },
        ]
        midterm["sections"]["progress"] = [
            {
                "type": "ordered_list",
                "items": [
                    {
                        "content": {
                            "type": "paragraph",
                            "runs": [{"text": "验证结果同{{fig:fig-workflow_0001}}。"}],
                        }
                    }
                ],
            }
        ]

        self.assertIs(validate_midterm(midterm), midterm)

    def test_referenced_figure_requires_a_caption(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["progress"] = [
            {
                "type": "image",
                "id": "fig-progress_0001",
                "path": "/private/app-data/figures/progress.png",
                "alt": "虚构进展图",
                "chapter": 3,
            }
        ]
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(context.exception.details["reason"], "missing_caption")
        self.assertEqual(
            context.exception.details["field"], "sections.progress[0].caption"
        )

    def test_duplicate_figure_ids_are_rejected_without_echoing_paths(self) -> None:
        midterm = midterm_fixture()
        image = {
            "type": "image",
            "id": "fig-duplicate_0001",
            "path": "/private/student-content/private.png",
            "alt": "虚构图片",
            "chapter": 3,
            "caption": "虚构题注",
        }
        midterm["sections"]["main_research_content"] = [image]
        midterm["sections"]["progress"] = [dict(image)]
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(
            context.exception.details["reason"], "duplicate_figure_id"
        )
        self.assertNotIn(image["path"], str(context.exception.details))

    def test_unknown_figure_reference_is_rejected(self) -> None:
        midterm = midterm_fixture()
        midterm["sections"]["progress"] = [
            {
                "type": "paragraph",
                "runs": [{"text": "错误引用{{fig:fig-missing_0001}}。"}],
            }
        ]
        with self.assertRaises(ExportError) as context:
            validate_midterm(midterm)
        self.assertEqual(
            context.exception.details["reason"], "unknown_figure_reference"
        )


def task_book_fixture() -> dict:
    return {
        "schema_version": "0.1",
        "metadata": {
            "graduation_year": 2026,
            "title": {
                "type": "paragraph",
                "runs": [
                    {"text": "g-C"},
                    {"text": "3", "script": "sub"},
                    {"text": "N"},
                    {"text": "4", "script": "sub"},
                    {"text": " 虚构任务书课题"},
                ],
            },
            "student_name": "测试同学",
            "student_id": "TASK-2026-001",
            "college": "测试学院",
            "major": "测试专业",
            "class_name": "测试一班",
            "advisor": "示例教师",
        },
        "sections": {
            "basic_content_and_requirements": [
                "完成需求分析、实现与验证。",
                {
                    "type": "ordered_list",
                    "items": [
                        {"marker": "（1）", "content": "完成结构化模型。"},
                        {"marker": "（2）", "content": "完成双路渲染。"},
                    ],
                },
            ],
            "schedule": [
                {"period": "第1—4周", "content": "完成调研和开题。"},
                {"period": "第5—16周", "content": "完成实现和论文。"},
            ],
            "required_materials": [],
            "references": ["[1] 虚构任务书参考文献。"],
            "topic_information": {
                "nature": "graduation_design",
                "source": {
                    "type": "research_project",
                    "research_project": {
                        "level": "other",
                        "other_level": "校级",
                        "project_number": "TEST-2026-001",
                    },
                },
            },
        },
    }


class TaskBookContractTests(unittest.TestCase):
    def test_shared_cohort_must_be_an_exact_supported_graduation_year(self) -> None:
        self.assertEqual(_graduation_year_from_cohort("2026"), 2026)
        self.assertEqual(_graduation_year_from_cohort("2026届"), 2026)
        self.assertIsNone(_graduation_year_from_cohort("2026 届"))
        self.assertIsNone(_graduation_year_from_cohort("春季2026批次"))
        self.assertIsNone(_graduation_year_from_cohort("2101届"))

    def test_valid_task_book_mirrors_submitted_model_constraints(self) -> None:
        task_book = task_book_fixture()
        self.assertIs(validate_task_book(task_book), task_book)

    def test_task_book_accepts_unordered_children_without_breaking_legacy_lists(self) -> None:
        task_book = task_book_fixture()
        legacy_ordered = task_book["sections"]["basic_content_and_requirements"][1]
        legacy_ordered["items"][0]["children"] = {
            "type": "unordered_list",
            "items": [
                {
                    "content": "完成无序子项。",
                    "children": {
                        "type": "ordered_list",
                        "items": [{"content": "完成三级子项。"}],
                    },
                }
            ],
        }
        self.assertIs(validate_task_book(task_book), task_book)

    def test_cover_title_uses_eighty_display_unit_limit(self) -> None:
        task_book = task_book_fixture()
        task_book["metadata"]["title"] = "任" * 81
        with self.assertRaises(ExportError) as context:
            validate_task_book(task_book)
        self.assertEqual(context.exception.details["field"], "metadata.title")
        self.assertEqual(
            context.exception.details["reason"], "display_width_exceeded"
        )

    def test_advisor_title_and_invalid_other_level_are_rejected(self) -> None:
        task_book = task_book_fixture()
        task_book["metadata"]["advisor"] = "示例教师副教授"
        with self.assertRaises(ExportError) as context:
            validate_task_book(task_book)
        self.assertEqual(context.exception.details["field"], "metadata.advisor")

        task_book = task_book_fixture()
        project = task_book["sections"]["topic_information"]["source"][
            "research_project"
        ]
        project["level"] = "national"
        with self.assertRaises(ExportError) as context:
            validate_task_book(task_book)
        self.assertEqual(
            context.exception.details["field"],
            "sections.topic_information.source.research_project",
        )


class TaskBookExportIntegrationTests(unittest.TestCase):
    @unittest.skipUnless(
        os.environ.get("SZTU_THESIS_ROOT")
        and importlib.util.find_spec("docx") is not None
        and importlib.util.find_spec("PIL") is not None
        and shutil.which("xelatex")
        and shutil.which("pdfinfo")
        and shutil.which("pdffonts")
        and shutil.which("pdftoppm"),
        "submitted task-book source or local rendering dependencies are unavailable",
    )
    def test_submitted_engine_exports_docx_pdf_and_latex_bundle(self) -> None:
        task_book = task_book_fixture()
        with tempfile.TemporaryDirectory(prefix="sztu-task-book-export-test-") as root:
            root_path = Path(root)
            output = root_path / "output"
            output.mkdir()
            workspace = Workspace.open_persistent(root_path / "data")
            try:
                with patch.dict(
                    os.environ,
                    {
                        "SZTU_DOCS_DATA_DIR": str(root_path / "data"),
                        "SZTU_DOCS_TASK_BOOK_ENGINE_DIR": os.environ[
                            "SZTU_THESIS_ROOT"
                        ],
                    },
                    clear=False,
                ):
                    engine = resolve_engine("task_book")
                    profile = workspace.save_profile(
                        {
                            "full_name": task_book["metadata"]["student_name"],
                            "student_number": task_book["metadata"]["student_id"],
                            "college": task_book["metadata"]["college"],
                            "major": task_book["metadata"]["major"],
                            "class_name": task_book["metadata"]["class_name"],
                            "advisor_name": task_book["metadata"]["advisor"],
                            "advisor_title": "副教授",
                            "graduation_cohort": "2026届",
                        }
                    )
                    document = workspace.create_document(
                        {
                            "profile_id": profile["id"],
                            "document_type": "task_book",
                            "template_version": engine.version,
                            "schema_version": "0.1",
                            "title": "任务书",
                        }
                    )
                    workspace.save_draft(
                        document["id"],
                        {
                            "metadata": task_book["metadata"],
                            "sections": task_book["sections"],
                        },
                        0,
                        reason="manual",
                    )
                    receipt = run_export(
                        workspace,
                        document_id=document["id"],
                        output_directory=str(output),
                        formats=["docx", "pdf", "tex"],
                    )
                    preview = generate_preview(
                        workspace,
                        document_id=document["id"],
                        request_id=str(uuid.uuid4()),
                        app_version="task-book-integration-test",
                    )
                    repeated_preview = generate_preview(
                        workspace,
                        document_id=document["id"],
                        request_id=str(uuid.uuid4()),
                        app_version="task-book-integration-test",
                    )
                self.assertEqual(receipt["status"], "succeeded")
                self.assertEqual(
                    {Path(item["path"]).name for item in receipt["artifacts"]},
                    {"任务书.docx", "任务书.pdf", "任务书-LaTeX.zip"},
                )
                check_ids = {item["check_id"] for item in receipt["checks"]}
                self.assertTrue(
                    {
                        "task_book-content",
                        "docx-deep-structure",
                        "pdf-structure",
                        "pdf-cjk-glyph",
                        "latex-bundle",
                    }
                    <= check_ids
                )
                stored = workspace.get_export_job(receipt["export_id"])
                self.assertEqual(stored["snapshot"]["task_book"], task_book)
                self.assertTrue(preview["pages"])
                self.assertEqual(preview["document_id"], document["id"])
                self.assertEqual(
                    preview["template"]["pack_sha256"],
                    receipt["template"]["pack_sha256"],
                )
                self.assertEqual(repeated_preview["preview_id"], preview["preview_id"])
                self.assertEqual(
                    repeated_preview["generated_at"], preview["generated_at"]
                )
                self.assertEqual(
                    len(workspace.list_export_jobs(document_id=document["id"])),
                    1,
                )
            finally:
                workspace.close()


class ProposalExportIntegrationTests(unittest.TestCase):
    @unittest.skipUnless(
        importlib.util.find_spec("docx") is not None
        and importlib.util.find_spec("PIL") is not None
        and shutil.which("xelatex")
        and shutil.which("pdfinfo")
        and shutil.which("pdffonts")
        and shutil.which("pdftoppm"),
        "local document rendering dependencies are unavailable",
    )
    def test_real_engine_exports_docx_and_pdf_with_receipt(self) -> None:
        proposal = proposal_fixture()
        proposal["sections"]["significance_and_status"][0] = {"runs": [
            {"text": "研究比值 "},
            {"type": "inline_equation", "expression": {"type": "fraction", "numerator": {"type": "text", "value": "a"}, "denominator": {"type": "text", "value": "b"}}, "alt": "a 除以 b"},
            {"text": " 的意义。"},
        ]}
        proposal["sections"]["research_content"].append({"type": "paragraph", "runs": [
            {"text": "局部关系 "},
            {"type": "inline_equation", "expression": {"type": "fraction", "numerator": {"type": "text", "value": "a"}, "denominator": {"type": "text", "value": "b"}}, "alt": "a 除以 b"},
            {"text": " 可用于比较。"},
        ]})
        proposal["sections"]["research_content"].append({"type": "equation", "expression": {"type": "square_root", "body": {"type": "text", "value": "x"}}, "alt": "x 的平方根"})
        with tempfile.TemporaryDirectory(prefix="sztu-export-test-") as root:
            root_path = Path(root)
            from PIL import Image as PILImage

            image_path = root_path / "proposal-figure.png"
            PILImage.new("RGB", (640, 360), color=(238, 242, 247)).save(image_path)
            proposal["sections"]["research_content"].append(
                {
                    "type": "image",
                    "id": "fig-proposal-export",
                    "path": str(image_path),
                    "alt": "虚构的开题报告导出回归图",
                    "chapter": 1,
                    "width_mm": 96,
                    "caption": "开题报告导出回归图",
                }
            )
            output = root_path / "output"
            output.mkdir()
            workspace = Workspace.open_persistent(root_path / "data")
            try:
                with patch.dict(
                    os.environ,
                    {"SZTU_DOCS_DATA_DIR": str(root_path / "data")},
                    clear=False,
                ), retain_synthetic_render_failure():
                    engine = resolve_engine()
                    profile = workspace.save_profile(
                        {
                            "full_name": proposal["metadata"]["student_name"],
                            "student_number": proposal["metadata"]["student_id"],
                            "college": proposal["metadata"]["college"],
                            "major": proposal["metadata"]["major"],
                            "advisor_name": proposal["metadata"]["advisor"],
                        }
                    )
                    document = workspace.create_document(
                        {
                            "profile_id": profile["id"],
                            "document_type": "proposal",
                            "template_version": engine.version,
                            "schema_version": "0.2",
                            "title": proposal["metadata"]["title"],
                        }
                    )
                    workspace.save_draft(
                        document["id"],
                        {
                            "metadata": proposal["metadata"],
                            "sections": proposal["sections"],
                        },
                        0,
                        reason="manual",
                    )

                    preview = generate_preview(
                        workspace,
                        document_id=document["id"],
                        request_id=str(uuid.uuid4()),
                        app_version="0.1.0",
                    )
                    receipt = run_export(
                        workspace,
                        document_id=document["id"],
                        output_directory=str(output),
                        formats=["docx", "pdf"],
                        preview_id=preview["preview_id"],
                    )
                self.assertEqual(receipt["status"], "succeeded")
                self.assertTrue(receipt["template"]["version"].startswith("0.3+workspace."))
                self.assertEqual(
                    [item["format"] for item in receipt["artifacts"]],
                    ["docx", "pdf"],
                )
                self.assertTrue(all(Path(item["path"]).is_file() for item in receipt["artifacts"]))
                from docx import Document
                exported_docx = next(Path(item["path"]) for item in receipt["artifacts"] if item["format"] == "docx")
                document_xml = Document(exported_docx).element.xml
                self.assertIn("<m:oMath>", document_xml)
                self.assertIn("<m:oMathPara>", document_xml)
                exported_pdf = next(
                    Path(item["path"])
                    for item in receipt["artifacts"]
                    if item["format"] == "pdf"
                )
                self.assertEqual(
                    exported_pdf.read_bytes(),
                    Path(preview["pdf"]["absolute_path"]).read_bytes(),
                )
                self.assertEqual(
                    next(
                        check
                        for check in receipt["checks"]
                        if check["gate"] == "cjk_glyph"
                    )["status"],
                    "pass",
                )
                serialized = json.dumps(receipt, ensure_ascii=False)
                self.assertNotIn(proposal["metadata"]["student_name"], serialized)
                self.assertNotIn(proposal["metadata"]["student_id"], serialized)
                job = workspace.database.connection.execute(
                    "SELECT status, progress FROM export_jobs"
                ).fetchone()
                self.assertEqual(dict(job), {"status": "completed", "progress": 100})
                artifact_rows = workspace.database.connection.execute(
                    "SELECT format, checks_json FROM export_artifacts ORDER BY format"
                ).fetchall()
                artifact_checks = {
                    row["format"]: {
                        check["check_id"]
                        for check in json.loads(row["checks_json"])
                    }
                    for row in artifact_rows
                }
                self.assertEqual(
                    artifact_checks["docx"],
                    {"docx-deep-structure", "full-page-layout", "target-editor"},
                )
                self.assertEqual(
                    artifact_checks["pdf"],
                    {"pdf-structure", "pdf-cjk-glyph", "full-page-layout"},
                )
                with patch.dict(
                    os.environ,
                    {"SZTU_DOCS_DATA_DIR": str(root_path / "data")},
                    clear=False,
                ):
                    repeated_preview = generate_preview(
                        workspace,
                        document_id=document["id"],
                        request_id=str(uuid.uuid4()),
                        app_version="0.1.0",
                    )
                self.assertGreaterEqual(len(preview["pages"]), 1)
                self.assertEqual(repeated_preview["preview_id"], preview["preview_id"])
                self.assertEqual(
                    repeated_preview["generated_at"], preview["generated_at"]
                )
                self.assertTrue(
                    all(
                        Path(page["absolute_path"]).is_file()
                        for page in preview["pages"]
                    )
                )
                self.assertTrue(
                    all(page["size_bytes"] > 0 for page in preview["pages"])
                )
                self.assertEqual(
                    workspace.database.connection.execute(
                        "SELECT COUNT(*) FROM export_jobs"
                    ).fetchone()[0],
                    1,
                )
            finally:
                workspace.close()


if __name__ == "__main__":
    unittest.main()
