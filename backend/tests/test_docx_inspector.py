from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from sztu_docs_backend.docx_inspector import (
    DocxInspectionError,
    EXPECTED_GRID_WIDTHS,
    TASK_BOOK_GRID_WIDTHS,
    W_NS,
    _expected_paragraphs,
    inspect_docx,
)

W = f"{{{W_NS}}}"
ElementTree.register_namespace("w", W_NS)


def proposal_fixture() -> dict:
    return {
        "schema_version": "0.2",
        "metadata": {
            "title": "虚构光催化材料研究",
            "student_name": "测试同学",
            "student_id": "TEST-2026-001",
            "major": "虚构工程",
            "college": "测试学院",
            "advisor": "示例教师",
        },
        "sections": {
            "significance_and_status": [
                {
                    "runs": [
                        {"text": "H", "script": "normal", "bold": False, "italic": True},
                        {"text": "2", "script": "sub", "bold": False, "italic": True},
                        {"text": "O研究。", "script": "normal", "bold": False, "italic": True},
                    ]
                },
                "国内外均有公开研究。",
            ],
            "research_content": ["分析虚构样品。"],
            "methods_and_means": ["采用公开方法。"],
            "research_steps": ["完成虚构实验。"],
            "references": ["[1] Fictional reference, 2026."],
        },
    }


class StructuredContentExpectationTests(unittest.TestCase):
    def test_nested_list_content_is_inspected_in_semantic_tree_order(self) -> None:
        proposal = proposal_fixture()
        proposal["sections"]["research_content"] = [
            {
                "type": "ordered_list",
                "items": [
                    {
                        "content": "一级内容",
                        "children": {
                            "type": "unordered_list",
                            "items": [
                                {
                                    "content": "二级内容",
                                    "children": {
                                        "type": "ordered_list",
                                        "items": [{"content": "三级内容"}],
                                    },
                                }
                            ],
                        },
                    }
                ],
            }
        ]
        fields = [field for field, _ in _expected_paragraphs(proposal)]
        first = fields.index("sections.research_content[0].items[0].content")
        self.assertEqual(
            fields[first : first + 3],
            [
                "sections.research_content[0].items[0].content",
                "sections.research_content[0].items[0].children.items[0].content",
                "sections.research_content[0].items[0].children.items[0].children.items[0].content",
            ],
        )

    def test_inspector_rejects_a_fifth_list_level(self) -> None:
        proposal = proposal_fixture()
        child = {"type": "unordered_list", "items": [{"content": "第五级"}]}
        for level in range(4, 0, -1):
            child = {
                "type": "ordered_list" if level % 2 else "unordered_list",
                "items": [{"content": f"第{level}级", "children": child}],
            }
        proposal["sections"]["research_content"] = [child]
        with self.assertRaises(DocxInspectionError) as context:
            _expected_paragraphs(proposal)
        self.assertEqual(context.exception.code, "DOCX_EXPECTATION_INVALID")


def _tag(parent: ElementTree.Element, name: str, **attributes: str) -> ElementTree.Element:
    return ElementTree.SubElement(
        parent,
        f"{W}{name}",
        {f"{W}{key}": value for key, value in attributes.items()},
    )


def _append_runs(
    parent: ElementTree.Element,
    value: str,
    *,
    script: str = "normal",
    bold: bool = False,
    italic: bool = False,
) -> None:
    groups: list[str] = []
    for character in value:
        is_latin = character.isascii() and character.isalnum()
        if not groups or ((groups[-1][-1].isascii() and groups[-1][-1].isalnum()) != is_latin):
            groups.append(character)
        else:
            groups[-1] += character
    for group in groups:
        run = _tag(parent, "r")
        properties = _tag(run, "rPr")
        latin = group[0].isascii() and group[0].isalnum()
        family = "Times New Roman" if latin else "宋体"
        _tag(properties, "rFonts", ascii=family, hAnsi=family, eastAsia=family)
        _tag(properties, "b", val="1" if bold else "0")
        _tag(properties, "i", val="1" if italic else "0")
        if script == "sub":
            _tag(properties, "vertAlign", val="subscript")
        elif script == "super":
            _tag(properties, "vertAlign", val="superscript")
        text = _tag(run, "t")
        text.text = group


def _append_paragraph(parent: ElementTree.Element, value: object) -> None:
    paragraph = _tag(parent, "p")
    if isinstance(value, dict):
        for run in value["runs"]:
            _append_runs(
                paragraph,
                run["text"],
                script=run.get("script", "normal"),
                bold=run.get("bold", False),
                italic=run.get("italic", False),
            )
    else:
        _append_runs(paragraph, str(value))


def _append_task_book_cohort(parent: ElementTree.Element, year: int) -> None:
    paragraph = _tag(parent, "p")
    for value in ("（", f" {year} ", "届）"):
        run = _tag(paragraph, "r")
        properties = _tag(run, "rPr")
        _tag(properties, "rFonts", ascii="黑体", hAnsi="黑体", eastAsia="黑体")
        _tag(properties, "b", val="1")
        text = _tag(run, "t")
        text.text = value


def _append_task_book_checkbox(
    paragraph: ElementTree.Element,
    *,
    selected: bool,
) -> None:
    run = _tag(paragraph, "r")
    properties = _tag(run, "rPr")
    _tag(
        properties,
        "rFonts",
        ascii="Times New Roman",
        hAnsi="Times New Roman",
        eastAsia="宋体",
    )
    _tag(properties, "b", val="0")
    _tag(
        run,
        "sym",
        font="Wingdings 2",
        char="0052" if selected else "00A3",
    )


def _append_task_book_option(
    paragraph: ElementTree.Element,
    label: str,
    *,
    selected: bool,
) -> None:
    _append_runs(paragraph, label)
    _append_task_book_checkbox(paragraph, selected=selected)


def _document_xml(proposal: dict) -> bytes:
    document = ElementTree.Element(f"{W}document")
    body = _tag(document, "body")
    table = _tag(body, "tbl")
    grid = _tag(table, "tblGrid")
    for width in EXPECTED_GRID_WIDTHS:
        _tag(grid, "gridCol", w=str(width))

    rows: list[ElementTree.Element] = []
    for _ in range(9):
        row = _tag(table, "tr")
        cell = _tag(row, "tc")
        rows.append(cell)
    metadata = proposal["metadata"]
    sections = proposal["sections"]
    for value in ("题    目", metadata["title"]):
        _append_paragraph(rows[0], value)
    for value in (
        "学生姓名",
        metadata["student_name"],
        "学号",
        metadata["student_id"],
        "专业",
        metadata["major"],
    ):
        _append_paragraph(rows[1], value)
    for value in ("学    院", metadata["college"], "指导教师", metadata["advisor"]):
        _append_paragraph(rows[2], value)
    _append_paragraph(rows[3], "本选题的意义及国内外发展状况：")
    for value in sections["significance_and_status"]:
        _append_paragraph(rows[3], value)
    _append_paragraph(rows[4], "研究内容：")
    for value in sections["research_content"]:
        _append_paragraph(rows[4], value)
    _append_paragraph(rows[5], "研究方法、手段及步骤：")
    _append_paragraph(rows[5], "本课题研究方法、手段如下：")
    for value in sections["methods_and_means"]:
        _append_paragraph(rows[5], value)
    _append_paragraph(rows[5], "本课题研究步骤如下：")
    for value in sections["research_steps"]:
        _append_paragraph(rows[5], value)
    _append_paragraph(rows[6], "参考文献：")
    for value in sections["references"]:
        _append_paragraph(rows[6], value)
    _append_paragraph(rows[7], "学生签名：       年    月    日")
    _append_paragraph(rows[8], "指导教师意见：    签名：    学院领导意见：    签名：    年 月 日")

    section = _tag(body, "sectPr")
    _tag(section, "pgSz", w="11906", h="16838")
    _tag(
        section,
        "pgMar",
        top="1440",
        right="1800",
        bottom="1440",
        left="1800",
        header="851",
        footer="992",
        gutter="0",
    )
    return ElementTree.tostring(document, encoding="utf-8", xml_declaration=True)


def task_book_fixture() -> dict:
    return {
        "schema_version": "0.1",
        "metadata": {
            "graduation_year": 2026,
            "title": "虚构任务书课题",
            "student_name": "测试同学",
            "student_id": "TASK-2026-001",
            "college": "测试学院",
            "major": "测试专业",
            "class_name": "测试一班",
            "advisor": "示例教师",
        },
        "sections": {
            "basic_content_and_requirements": ["完成虚构系统设计与验证。"],
            "schedule": [{"period": "第1—16周", "content": "完成全部虚构工作。"}],
            "required_materials": [],
            "references": ["[1] Fictional task-book reference, 2026."],
            "topic_information": {
                "nature": "graduation_design",
                "source": {"type": "practice_project"},
            },
        },
    }


def _single_cell_row(table: ElementTree.Element) -> ElementTree.Element:
    row = _tag(table, "tr")
    return _tag(row, "tc")


def _nested_table(
    parent: ElementTree.Element, cell_values: list[str]
) -> ElementTree.Element:
    table = _tag(parent, "tbl")
    grid = _tag(table, "tblGrid")
    for _ in cell_values:
        _tag(grid, "gridCol", w="1000")
    row = _tag(table, "tr")
    for value in cell_values:
        cell = _tag(row, "tc")
        _append_paragraph(cell, value)
    return table


def _task_book_topic_structure(
    parent: ElementTree.Element,
    topic: dict,
) -> None:
    nature = topic["nature"]
    source = topic["source"]
    source_type = source["type"]
    project = source.get("research_project", {})
    level = project.get("level")

    nature_line = _tag(parent, "p")
    _append_task_book_option(
        nature_line,
        "选题性质：设计",
        selected=nature == "graduation_design",
    )
    _append_task_book_option(
        nature_line,
        "    论文",
        selected=nature == "graduation_thesis",
    )

    research_table = _nested_table(
        parent,
        [
            "",
            project.get("other_level", "")
            if source_type == "research_project" and level == "other"
            else "",
            "",
        ],
    )
    research_line = research_table.find(f"{W}tr/{W}tc/{W}p")
    assert research_line is not None
    _append_runs(research_line, "选题来源：1. 科研项目    国家级")
    _append_task_book_checkbox(
        research_line,
        selected=source_type == "research_project" and level == "national",
    )
    _append_task_book_option(
        research_line,
        "    省部级",
        selected=(
            source_type == "research_project"
            and level == "provincial_ministerial"
        ),
    )
    _append_runs(research_line, "    其他：")

    project_table = _nested_table(
        parent,
        [
            "",
            "项目编号：",
            project.get("project_number", "")
            if source_type == "research_project"
            else "",
            "",
        ],
    )

    practice = _tag(parent, "p")
    _append_task_book_option(
        practice,
        "2. 实践项目",
        selected=source_type == "practice_project",
    )
    self_heading = _tag(parent, "p")
    _append_runs(self_heading, "3. 自拟题目")

    proposer = source.get("self_proposed_by")
    teacher = _tag(parent, "p")
    _append_task_book_option(
        teacher,
        "教师自拟",
        selected=source_type == "self_proposed" and proposer == "teacher",
    )
    student = _tag(parent, "p")
    _append_task_book_option(
        student,
        "学生自拟",
        selected=source_type == "self_proposed" and proposer == "student",
    )

    final_table = _nested_table(parent, ["", "指导教师签名：", "", ""])
    joint = final_table.find(f"{W}tr/{W}tc/{W}p")
    assert joint is not None
    _append_task_book_option(
        joint,
        "师生共拟",
        selected=(
            source_type == "self_proposed"
            and proposer == "teacher_student_joint"
        ),
    )


def _task_book_document_xml(task_book: dict) -> bytes:
    document = ElementTree.Element(f"{W}document")
    body = _tag(document, "body")
    metadata = task_book["metadata"]
    sections = task_book["sections"]

    _append_paragraph(body, metadata["student_id"])
    _append_paragraph(body, "深圳技术大学")
    _append_paragraph(body, "本科毕业论文(设计)任务书")
    _append_task_book_cohort(body, metadata["graduation_year"])
    title_table = _tag(body, "tbl")
    title_grid = _tag(title_table, "tblGrid")
    for width in (1265, 7257):
        _tag(title_grid, "gridCol", w=str(width))
    title_row = _tag(title_table, "tr")
    _append_paragraph(_tag(title_row, "tc"), "题目：")
    _append_paragraph(_tag(title_row, "tc"), metadata["title"])

    info_table = _tag(body, "tbl")
    info_grid = _tag(info_table, "tblGrid")
    for width in (1653, 2381, 454, 1653, 2381):
        _tag(info_grid, "gridCol", w=str(width))
    for value in (
        metadata["college"],
        metadata["major"],
        metadata["class_name"],
        metadata["student_name"],
        metadata["advisor"],
    ):
        cell = _single_cell_row(info_table)
        _append_paragraph(cell, value)
    _append_paragraph(body, "本科生毕业论文（设计）须知")

    main = _tag(body, "tbl")
    grid = _tag(main, "tblGrid")
    for width in TASK_BOOK_GRID_WIDTHS:
        _tag(grid, "gridCol", w=str(width))
    rows = [_single_cell_row(main) for _ in range(6)]
    _append_paragraph(rows[0], "题目名称：")
    _append_paragraph(rows[0], metadata["title"])
    _append_paragraph(rows[1], "一、毕业论文(设计)基本内容与要求：")
    for block in sections["basic_content_and_requirements"]:
        _append_paragraph(rows[1], block)
    _append_paragraph(rows[2], "二、进度安排：")
    for entry in sections["schedule"]:
        _append_paragraph(rows[2], entry["period"])
        _append_paragraph(rows[2], entry["content"])
    _append_paragraph(rows[3], "三、需收集的资料和指导性参考文献：")
    for block in sections["required_materials"]:
        _append_paragraph(rows[3], block)
    for reference in sections["references"]:
        _append_paragraph(rows[3], reference)
    _append_paragraph(rows[4], "四、选题信息：")
    _task_book_topic_structure(rows[4], sections["topic_information"])
    _append_paragraph(rows[5], "学院领导意见：")
    _nested_table(rows[5], ["签名：", "", ""])
    _nested_table(rows[5], ["", "年", "", "月", "", "日", ""])

    section = _tag(body, "sectPr")
    _tag(section, "pgSz", w="11906", h="16838")
    _tag(
        section,
        "pgMar",
        top="1440",
        right="1800",
        bottom="1440",
        left="1800",
        header="0",
        footer="0",
        gutter="0",
    )
    return ElementTree.tostring(document, encoding="utf-8", xml_declaration=True)


def _mutate_task_book_cohort_year(document_xml: bytes) -> bytes:
    document = ElementTree.fromstring(document_xml)
    body = document.find(f"{W}body")
    assert body is not None
    changed = 0
    for paragraph in body.findall(f"{W}p"):
        paragraph_text = "".join(
            node.text or "" for node in paragraph.iter(f"{W}t")
        )
        if "2026" not in paragraph_text or "届" not in paragraph_text:
            continue
        for node in paragraph.iter(f"{W}t"):
            if node.text and "2026" in node.text:
                node.text = node.text.replace("2026", "2099", 1)
                changed += 1
                break
    assert changed == 1
    return ElementTree.tostring(document, encoding="utf-8", xml_declaration=True)


def _mutate_first_selected_task_book_checkbox(document_xml: bytes) -> bytes:
    document = ElementTree.fromstring(document_xml)
    for symbol in document.iter(f"{W}sym"):
        if symbol.get(f"{W}char") == "0052":
            symbol.set(f"{W}char", "00A3")
            return ElementTree.tostring(
                document,
                encoding="utf-8",
                xml_declaration=True,
            )
    raise AssertionError("fixture does not contain a selected task-book checkbox")


def _mutate_task_book_cohort_font(document_xml: bytes) -> bytes:
    document = ElementTree.fromstring(document_xml)
    body = document.find(f"{W}body")
    assert body is not None
    for paragraph in body.findall(f"{W}p"):
        paragraph_text = "".join(
            node.text or "" for node in paragraph.iter(f"{W}t")
        )
        if "2026" not in paragraph_text or "届" not in paragraph_text:
            continue
        for fonts in paragraph.iter(f"{W}rFonts"):
            for role in ("ascii", "hAnsi", "eastAsia"):
                fonts.set(f"{W}{role}", "Times New Roman")
        return ElementTree.tostring(
            document,
            encoding="utf-8",
            xml_declaration=True,
        )
    raise AssertionError("fixture does not contain the task-book cohort line")


def _mutate_first_task_book_checkbox_font(document_xml: bytes) -> bytes:
    document = ElementTree.fromstring(document_xml)
    symbol = next(document.iter(f"{W}sym"), None)
    if symbol is None:
        raise AssertionError("fixture does not contain a task-book checkbox")
    symbol.set(f"{W}font", "Arial")
    return ElementTree.tostring(document, encoding="utf-8", xml_declaration=True)


def _copy_docx_with_document_xml(
    source: Path,
    target: Path,
    mutation,
) -> None:
    with (
        zipfile.ZipFile(source) as input_archive,
        zipfile.ZipFile(target, "w") as output_archive,
    ):
        for info in input_archive.infolist():
            payload = input_archive.read(info.filename)
            if info.filename == "word/document.xml":
                payload = mutation(payload)
            output_archive.writestr(info, payload)


def _submitted_task_book_artifacts() -> tuple[Path, dict]:
    source = os.environ.get("SZTU_THESIS_ROOT")
    if not source:
        raise unittest.SkipTest(
            "submitted task-book source was not explicitly enabled"
        )
    source_root = Path(source).resolve()
    docx = source_root / "tmp" / "task-book-tests" / "normal" / "task-book.docx"
    data = source_root / "templates" / "task-book" / "fixtures" / "normal.json"
    if not docx.is_file() or not data.is_file():
        raise unittest.SkipTest(
            "submitted task-book rendered fixture is unavailable; run its source QA first"
        )
    return docx, json.loads(data.read_text(encoding="utf-8"))


def _write_docx(path: Path, document_xml: bytes, *, external_relationship: bool = False) -> None:
    relationship = (
        '<Relationship Id="rId1" Target="https://invalid.example/" TargetMode="External" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"/>'
        if external_relationship
        else ""
    )
    package_relationships = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + relationship
        + "</Relationships>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        )
        archive.writestr("_rels/.rels", package_relationships)
        archive.writestr("word/document.xml", document_xml)
        archive.writestr(
            "word/styles.xml",
            f'<?xml version="1.0"?><w:styles xmlns:w="{W_NS}"/>',
        )


class DocxInspectorTests(unittest.TestCase):
    def test_task_book_cover_main_table_and_blank_signatures_pass(self) -> None:
        task_book = task_book_fixture()
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            path = Path(root) / "task-book.docx"
            _write_docx(path, _task_book_document_xml(task_book))
            result = inspect_docx(path, task_book, document_type="task_book")
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["details"]["tables"], 3)
        self.assertEqual(result["details"]["rows"], 6)
        self.assertEqual(result["details"]["grid_columns"], 1)
        self.assertEqual(result["details"]["task_book_graduation_year"], 2026)
        self.assertEqual(result["details"]["task_book_checkbox_symbols"], 8)

    def test_task_book_topic_selection_branches_pass(self) -> None:
        cases = {
            "research-national": (
                "graduation_thesis",
                {
                    "type": "research_project",
                    "research_project": {
                        "level": "national",
                        "project_number": "TEST-NATIONAL-001",
                    },
                },
            ),
            "research-provincial": (
                "graduation_design",
                {
                    "type": "research_project",
                    "research_project": {
                        "level": "provincial_ministerial",
                        "project_number": "TEST-PROVINCIAL-001",
                    },
                },
            ),
            "research-other": (
                "graduation_design",
                {
                    "type": "research_project",
                    "research_project": {
                        "level": "other",
                        "other_level": "校级",
                        "project_number": "TEST-OTHER-001",
                    },
                },
            ),
            "practice": ("graduation_design", {"type": "practice_project"}),
            "self-teacher": (
                "graduation_thesis",
                {"type": "self_proposed", "self_proposed_by": "teacher"},
            ),
            "self-student": (
                "graduation_thesis",
                {"type": "self_proposed", "self_proposed_by": "student"},
            ),
            "self-joint": (
                "graduation_thesis",
                {
                    "type": "self_proposed",
                    "self_proposed_by": "teacher_student_joint",
                },
            ),
        }
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            for name, (nature, source) in cases.items():
                with self.subTest(name=name):
                    task_book = copy.deepcopy(task_book_fixture())
                    task_book["sections"]["topic_information"] = {
                        "nature": nature,
                        "source": source,
                    }
                    path = Path(root) / f"{name}.docx"
                    _write_docx(path, _task_book_document_xml(task_book))
                    result = inspect_docx(
                        path,
                        task_book,
                        document_type="task_book",
                    )
                    self.assertEqual(result["status"], "pass")
                    self.assertEqual(
                        result["details"]["task_book_checkbox_symbols"],
                        8,
                    )

    def test_synthetic_task_book_rejects_mutated_cover_year(self) -> None:
        task_book = task_book_fixture()
        xml = _mutate_task_book_cohort_year(_task_book_document_xml(task_book))
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            path = Path(root) / "mutated-cohort.docx"
            _write_docx(path, xml)
            with self.assertRaises(DocxInspectionError) as context:
                inspect_docx(path, task_book, document_type="task_book")
        self.assertEqual(context.exception.code, "DOCX_CONTENT_MISMATCH")
        self.assertEqual(
            context.exception.details.get("field"),
            "metadata.graduation_year",
        )

    def test_synthetic_task_book_rejects_selected_checkbox_cleared(self) -> None:
        task_book = task_book_fixture()
        xml = _mutate_first_selected_task_book_checkbox(
            _task_book_document_xml(task_book)
        )
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            path = Path(root) / "mutated-checkbox.docx"
            _write_docx(path, xml)
            with self.assertRaises(DocxInspectionError) as context:
                inspect_docx(path, task_book, document_type="task_book")
        self.assertEqual(context.exception.code, "DOCX_CONTENT_MISMATCH")

    def test_synthetic_task_book_rejects_required_font_drift(self) -> None:
        task_book = task_book_fixture()
        mutations = {
            "cohort-font": _mutate_task_book_cohort_font,
            "checkbox-font": _mutate_first_task_book_checkbox_font,
        }
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            for name, mutation in mutations.items():
                with self.subTest(name=name):
                    path = Path(root) / f"{name}.docx"
                    _write_docx(
                        path,
                        mutation(_task_book_document_xml(task_book)),
                    )
                    with self.assertRaises(DocxInspectionError) as context:
                        inspect_docx(path, task_book, document_type="task_book")
                    self.assertEqual(context.exception.code, "DOCX_FONT_MISMATCH")

    def test_submitted_task_book_real_output_rejects_mutations(self) -> None:
        source, task_book = _submitted_task_book_artifacts()
        baseline = inspect_docx(source, task_book, document_type="task_book")
        self.assertEqual(baseline["status"], "pass")
        mutations = {
            "cohort-year": _mutate_task_book_cohort_year,
            "selected-checkbox": _mutate_first_selected_task_book_checkbox,
        }
        with tempfile.TemporaryDirectory(prefix="docx-inspector-real-test-") as root:
            for name, mutation in mutations.items():
                with self.subTest(name=name):
                    path = Path(root) / f"{name}.docx"
                    _copy_docx_with_document_xml(source, path, mutation)
                    with self.assertRaises(DocxInspectionError) as context:
                        inspect_docx(path, task_book, document_type="task_book")
                    self.assertEqual(context.exception.code, "DOCX_CONTENT_MISMATCH")

    def test_task_book_advisor_signature_must_remain_blank(self) -> None:
        task_book = task_book_fixture()
        xml = _task_book_document_xml(task_book).replace(
            "指导教师签名：".encode(), "指导教师签名：已签".encode()
        )
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            path = Path(root) / "task-book.docx"
            _write_docx(path, xml)
            with self.assertRaises(DocxInspectionError) as context:
                inspect_docx(path, task_book, document_type="task_book")
        self.assertEqual(context.exception.code, "DOCX_SIGNATURE_REGION_NOT_BLANK")

    def test_deep_structure_passes_without_claiming_visual_acceptance(self) -> None:
        proposal = proposal_fixture()
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            path = Path(root) / "proposal.docx"
            _write_docx(path, _document_xml(proposal))
            result = inspect_docx(path, proposal)
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["details"]["rows"], 9)
        self.assertEqual(result["details"]["grid_columns"], 7)
        self.assertEqual(result["details"]["rich_paragraphs"], 1)
        self.assertFalse(result["details"]["visual_acceptance"])
        self.assertFalse(result["details"]["target_editor_verified"])

    def test_signature_region_must_remain_blank(self) -> None:
        proposal = proposal_fixture()
        xml = _document_xml(proposal).replace("学生签名：".encode(), "学生签名：已签".encode())
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            path = Path(root) / "proposal.docx"
            _write_docx(path, xml)
            with self.assertRaises(DocxInspectionError) as context:
                inspect_docx(path, proposal)
        self.assertEqual(context.exception.code, "DOCX_SIGNATURE_REGION_NOT_BLANK")

    def test_section_order_is_enforced(self) -> None:
        proposal = proposal_fixture()
        xml = _document_xml(proposal)
        xml = xml.replace("研究内容：".encode(), "TEMP：".encode())
        xml = xml.replace("参考文献：".encode(), "研究内容：".encode())
        xml = xml.replace("TEMP：".encode(), "参考文献：".encode())
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            path = Path(root) / "proposal.docx"
            _write_docx(path, xml)
            with self.assertRaises(DocxInspectionError) as context:
                inspect_docx(path, proposal)
        self.assertEqual(context.exception.code, "DOCX_SECTION_ORDER_MISMATCH")

    def test_page_margins_are_exact(self) -> None:
        proposal = proposal_fixture()
        xml = _document_xml(proposal).replace(b'top="1440"', b'top="1500"')
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            path = Path(root) / "proposal.docx"
            _write_docx(path, xml)
            with self.assertRaises(DocxInspectionError) as context:
                inspect_docx(path, proposal)
        self.assertEqual(context.exception.code, "DOCX_PAGE_LAYOUT_MISMATCH")

    def test_rich_run_script_is_enforced(self) -> None:
        proposal = proposal_fixture()
        xml = _document_xml(proposal).replace(b'val="subscript"', b'val="superscript"', 1)
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            path = Path(root) / "proposal.docx"
            _write_docx(path, xml)
            with self.assertRaises(DocxInspectionError) as context:
                inspect_docx(path, proposal)
        self.assertEqual(context.exception.code, "DOCX_RICH_TEXT_MISMATCH")

    def test_external_relationship_is_rejected(self) -> None:
        proposal = proposal_fixture()
        with tempfile.TemporaryDirectory(prefix="docx-inspector-test-") as root:
            path = Path(root) / "proposal.docx"
            _write_docx(path, _document_xml(proposal), external_relationship=True)
            with self.assertRaises(DocxInspectionError) as context:
                inspect_docx(path, proposal)
        self.assertEqual(context.exception.code, "DOCX_EXTERNAL_RELATIONSHIP")


if __name__ == "__main__":
    unittest.main()
