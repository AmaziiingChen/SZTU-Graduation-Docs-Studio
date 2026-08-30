from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from sztu_docs_backend.docx_inspector import (
    DocxInspectionError,
    EXPECTED_GRID_WIDTHS,
    W_NS,
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
