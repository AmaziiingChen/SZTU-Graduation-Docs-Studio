"""Deep, dependency-free OOXML checks for rendered process-document DOCX files.

The inspector deliberately reports structural facts only.  A passing result is
not evidence that Word/WPS layout or Chinese glyph rendering was accepted.
"""

from __future__ import annotations

import re
import stat
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any
from xml.etree import ElementTree

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
W = f"{{{W_NS}}}"

REQUIRED_PARTS = {
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/styles.xml",
}
EXPECTED_GRID_WIDTHS = (1681, 1649, 720, 945, 650, 708, 1943)
EXPECTED_PAGE_SIZE = {"w": 11906, "h": 16838}
EXPECTED_PAGE_MARGINS = {
    "top": 1440,
    "right": 1800,
    "bottom": 1440,
    "left": 1800,
    "header": 851,
    "footer": 992,
    "gutter": 0,
}
SECTION_LABELS = (
    "本选题的意义及国内外发展状况：",
    "研究内容：",
    "研究方法、手段及步骤：",
    "本课题研究方法、手段如下：",
    "本课题研究步骤如下：",
    "参考文献：",
    "学生签名：",
    "指导教师意见：",
    "学院领导意见：",
)
ALLOWED_FONTS = {"宋体", "黑体", "Times New Roman"}
MIDTERM_ALLOWED_FONTS = {"方正小标宋简体", "宋体", "Times New Roman"}
MIDTERM_GRID_WIDTHS = (1419, 2752, 1695, 2656)
MIDTERM_SECTION_LABELS = (
    "毕业论文（设计）的目录和主要研究内容：",
    "毕业论文（设计）工作进展情况（详述）：",
    "指导教师填写栏目（在正确项后方框内划√）",
    "存在的问题及后期指导工作意见：",
    "审查小组检查意见：",
)
MAX_ENTRIES = 256
MAX_XML_BYTES = 8 * 1024 * 1024
MAX_EXPANDED_BYTES = 32 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200


class DocxInspectionError(Exception):
    """Stable, sanitized DOCX inspection failure."""

    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def _raise(code: str, message: str, **details: Any) -> None:
    raise DocxInspectionError(code, message, details)


def _safe_xml(payload: bytes, part: str) -> ElementTree.Element:
    if len(payload) > MAX_XML_BYTES:
        _raise("DOCX_ARCHIVE_LIMIT", "Word XML 部件超过安全大小限制。", part=part)
    lowered = payload.lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        _raise("DOCX_UNSAFE_XML", "Word 文件包含不允许的 XML 声明。", part=part)
    try:
        return ElementTree.fromstring(payload)
    except ElementTree.ParseError as exc:
        raise DocxInspectionError(
            "DOCX_INVALID_XML", "Word 文件包含无法解析的 XML。", {"part": part}
        ) from exc


def _validate_member(info: zipfile.ZipInfo) -> None:
    name = info.filename
    path = PurePosixPath(name)
    if (
        not name
        or "\\" in name
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        _raise("DOCX_UNSAFE_ARCHIVE", "Word 文件包含不安全的压缩包路径。")
    mode = (info.external_attr >> 16) & 0xFFFF
    if mode and stat.S_ISLNK(mode):
        _raise("DOCX_UNSAFE_ARCHIVE", "Word 文件压缩包不得包含符号链接。")
    if info.flag_bits & 0x1:
        _raise("DOCX_UNSAFE_ARCHIVE", "Word 文件压缩包不得包含加密成员。")
    if info.compress_size == 0 and info.file_size:
        _raise("DOCX_ARCHIVE_LIMIT", "Word 文件压缩比超过安全限制。")
    if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
        _raise("DOCX_ARCHIVE_LIMIT", "Word 文件压缩比超过安全限制。")


def _attr(element: ElementTree.Element | None, name: str) -> str | None:
    if element is None:
        return None
    return element.get(f"{W}{name}")


def _int_attr(element: ElementTree.Element | None, name: str, field: str) -> int:
    value = _attr(element, name)
    try:
        return int(value) if value is not None else -1
    except ValueError:
        _raise("DOCX_PAGE_LAYOUT_MISMATCH", "Word 页面参数无效。", field=field)


def _text(element: ElementTree.Element) -> str:
    return "".join(node.text or "" for node in element.iter(f"{W}t"))


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _ooxml_bool(element: ElementTree.Element | None) -> bool:
    if element is None:
        return False
    return (_attr(element, "val") or "true").casefold() not in {"0", "false", "off", "no"}


def _run_style(run: ElementTree.Element) -> dict[str, Any]:
    properties = run.find(f"{W}rPr")
    fonts = properties.find(f"{W}rFonts") if properties is not None else None
    vertical = properties.find(f"{W}vertAlign") if properties is not None else None
    script = _attr(vertical, "val") or "normal"
    return {
        "script": {"subscript": "sub", "superscript": "super"}.get(script, script),
        "bold": _ooxml_bool(properties.find(f"{W}b") if properties is not None else None),
        "italic": _ooxml_bool(properties.find(f"{W}i") if properties is not None else None),
        "fonts": {} if fonts is None else {
            key: value
            for key in ("ascii", "hAnsi", "eastAsia")
            if (value := _attr(fonts, key)) is not None
        },
    }


def _flatten_runs(root: ElementTree.Element) -> tuple[str, list[dict[str, Any]]]:
    characters: list[str] = []
    styles: list[dict[str, Any]] = []
    for run in root.iter(f"{W}r"):
        value = _text(run)
        style_value = _run_style(run)
        characters.extend(value)
        styles.extend([style_value] * len(value))
    return "".join(characters), styles


def _paragraph_runs(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        return [{"text": value, "script": "normal", "bold": False, "italic": False}]
    if isinstance(value, dict) and isinstance(value.get("runs"), list):
        return [
            {
                "text": str(run.get("text", "")),
                "script": run.get("script", "normal"),
                "bold": bool(run.get("bold", False)),
                "italic": bool(run.get("italic", False)),
            }
            for run in value["runs"]
        ]
    _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入的数据结构无效。")


def _expected_paragraphs(proposal: dict[str, Any]) -> list[tuple[str, list[dict[str, Any]]]]:
    metadata = proposal.get("metadata")
    sections = proposal.get("sections")
    if not isinstance(metadata, dict) or not isinstance(sections, dict):
        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少基本信息或正文。")
    result: list[tuple[str, list[dict[str, Any]]]] = []
    for field in ("title", "student_name", "student_id", "major", "college", "advisor"):
        if field not in metadata:
            _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少字段。", field=f"metadata.{field}")
        result.append((f"metadata.{field}", _paragraph_runs(metadata[field])))
    for section in (
        "significance_and_status",
        "research_content",
        "methods_and_means",
        "research_steps",
        "references",
    ):
        values = sections.get(section)
        if not isinstance(values, list):
            _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少正文段落。", field=f"sections.{section}")
        result.extend(
            (f"sections.{section}[{index}]", _paragraph_runs(value))
            for index, value in enumerate(values)
        )
    return result


def _expected_midterm_paragraphs(midterm: dict[str, Any]) -> list[tuple[str, list[dict[str, Any]]]]:
    metadata = midterm.get("metadata")
    sections = midterm.get("sections")
    if not isinstance(metadata, dict) or not isinstance(sections, dict):
        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少基本信息或正文。")
    result: list[tuple[str, list[dict[str, Any]]]] = []
    for field in ("student_name", "college", "major", "class_name", "advisor"):
        if field not in metadata:
            _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少字段。", field=f"metadata.{field}")
        result.append((f"metadata.{field}", _paragraph_runs(metadata[field])))
    check_date = metadata.get("check_date")
    if not isinstance(check_date, str):
        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少检查日期。")
    try:
        year, month, day = (int(part) for part in check_date.split("-"))
    except (TypeError, ValueError) as exc:
        raise DocxInspectionError(
            "DOCX_EXPECTATION_INVALID", "DOCX 检查输入的日期无效。"
        ) from exc
    result.append(("metadata.check_date", _paragraph_runs(f"{year} 年 {month} 月 {day} 日")))
    result.append(("metadata.title", _paragraph_runs(metadata.get("title"))))

    directory = sections.get("directory")
    if not isinstance(directory, list):
        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少论文目录。")
    for index, item in enumerate(directory):
        if not isinstance(item, dict):
            _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入的目录条目无效。")
        number = item.get("number")
        if isinstance(number, str) and number.strip():
            result.append((f"sections.directory[{index}].number", _paragraph_runs(number)))
        result.append((f"sections.directory[{index}].title", _paragraph_runs(item.get("title"))))

    for section_name in ("main_research_content", "progress"):
        blocks = sections.get(section_name)
        if not isinstance(blocks, list):
            _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少正文。", field=f"sections.{section_name}")
        for block_index, block in enumerate(blocks):
            if not isinstance(block, dict):
                _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入的正文内容块无效。")
            if block.get("type", "paragraph") == "paragraph":
                result.append(
                    (
                        f"sections.{section_name}[{block_index}]",
                        _paragraph_runs(block),
                    )
                )
            elif block.get("type") == "ordered_list":
                items = block.get("items")
                if not isinstance(items, list):
                    _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入的列表无效。")
                for item_index, item in enumerate(items):
                    if not isinstance(item, dict):
                        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入的列表条目无效。")
                    result.append(
                        (
                            f"sections.{section_name}[{block_index}].items[{item_index}]",
                            _paragraph_runs(item.get("content")),
                        )
                    )
            elif block.get("type") == "image" and block.get("caption") is not None:
                result.append(
                    (
                        f"sections.{section_name}[{block_index}].caption",
                        _paragraph_runs(block.get("caption")),
                    )
                )
    return result


def _check_expected_content(
    root: ElementTree.Element,
    proposal: dict[str, Any],
    document_type: str = "proposal",
) -> tuple[int, int]:
    raw_text, raw_styles = _flatten_runs(root)
    compact_characters: list[str] = []
    styles: list[dict[str, Any]] = []
    for character, style in zip(raw_text, raw_styles, strict=True):
        if not character.isspace():
            compact_characters.append(character)
            styles.append(style)
    full_text = "".join(compact_characters)
    cursor = 0
    rich_paragraphs = 0
    rich_runs = 0
    expected = (
        _expected_midterm_paragraphs(proposal)
        if document_type == "midterm"
        else _expected_paragraphs(proposal)
    )
    for field, expected_runs in expected:
        expected_text = "".join(
            character
            for run in expected_runs
            for character in run["text"]
            if not character.isspace()
        )
        position = full_text.find(expected_text, cursor)
        if position < 0:
            _raise("DOCX_CONTENT_MISMATCH", "Word 内容与已验证的结构化输入不一致。", field=field)
        offset = position
        is_rich = len(expected_runs) > 1 or any(
            run["script"] != "normal" or run["bold"] or run["italic"]
            for run in expected_runs
        )
        if is_rich:
            rich_paragraphs += 1
        for expected in expected_runs:
            length = sum(not character.isspace() for character in expected["text"])
            if length and any(
                actual[key] != expected[key]
                for actual in styles[offset : offset + length]
                for key in ("script", "bold", "italic")
            ):
                _raise(
                    "DOCX_RICH_TEXT_MISMATCH",
                    "Word 富文本样式与输入不一致。",
                    field=field,
                )
            offset += length
            rich_runs += int(is_rich)
        cursor = position + len(expected_text)
    return rich_paragraphs, rich_runs


def _check_fonts(
    root: ElementTree.Element,
    document_type: str = "proposal",
) -> tuple[int, tuple[str, ...]]:
    allowed_fonts = MIDTERM_ALLOWED_FONTS if document_type == "midterm" else ALLOWED_FONTS
    visible_runs = 0
    observed: set[str] = set()
    for run in root.iter(f"{W}r"):
        value = _text(run)
        if not value.strip():
            continue
        visible_runs += 1
        fonts = _run_style(run)["fonts"]
        if not fonts:
            _raise("DOCX_FONT_MISMATCH", "Word 可见文本缺少显式字体设置。")
        observed.update(fonts.values())
        unsupported = set(fonts.values()) - allowed_fonts
        if unsupported:
            _raise("DOCX_FONT_MISMATCH", "Word 使用了不允许的替代字体。")
        if re.search(r"[\u3400-\u9fff]", value) and not (
            fonts.get("eastAsia") in allowed_fonts
            or fonts.get("ascii") in allowed_fonts
        ):
            _raise("DOCX_FONT_MISMATCH", "Word 中文文本未使用规定字体。")
        if re.search(r"[A-Za-z0-9]", value) and not (
            fonts.get("ascii") == "Times New Roman"
            or fonts.get("hAnsi") == "Times New Roman"
        ):
            _raise("DOCX_FONT_MISMATCH", "Word 西文和数字未使用 Times New Roman。")
    if visible_runs == 0:
        _raise("DOCX_STRUCTURE_MISMATCH", "Word 文件没有可见文本。")
    return visible_runs, tuple(sorted(observed))


def _check_relationships(archive: zipfile.ZipFile) -> None:
    for name in archive.namelist():
        if not name.endswith(".rels"):
            continue
        root = _safe_xml(archive.read(name), name)
        for relationship in root.iter(f"{{{PKG_REL_NS}}}Relationship"):
            if relationship.get("TargetMode", "Internal").casefold() == "external":
                _raise("DOCX_EXTERNAL_RELATIONSHIP", "Word 文件包含外部关系。", part=name)


def inspect_docx(
    path: Path,
    proposal: dict[str, Any],
    *,
    document_type: str = "proposal",
) -> dict[str, Any]:
    """Inspect a process-document DOCX and return a structure-gate CheckResult."""

    if document_type not in {"proposal", "midterm"}:
        _raise("DOCX_EXPECTATION_INVALID", "当前文档类型没有 DOCX 深层检查器。")

    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_ENTRIES:
                _raise("DOCX_ARCHIVE_LIMIT", "Word 文件包含过多压缩包成员。")
            names = [info.filename for info in infos]
            if len(names) != len(set(names)):
                _raise("DOCX_UNSAFE_ARCHIVE", "Word 文件包含重复压缩包成员。")
            for info in infos:
                _validate_member(info)
            if sum(info.file_size for info in infos) > MAX_EXPANDED_BYTES:
                _raise("DOCX_ARCHIVE_LIMIT", "Word 文件解压后超过安全大小限制。")
            missing = sorted(REQUIRED_PARTS - set(names))
            if missing:
                _raise("DOCX_STRUCTURE_MISMATCH", "Word 文件缺少必要的 OOXML 部件。", parts=missing)
            _check_relationships(archive)
            document = _safe_xml(archive.read("word/document.xml"), "word/document.xml")
            _safe_xml(archive.read("word/styles.xml"), "word/styles.xml")
    except DocxInspectionError:
        raise
    except (OSError, zipfile.BadZipFile, KeyError) as exc:
        raise DocxInspectionError("DOCX_INVALID_ARCHIVE", "Word 文件无法作为 OOXML 打开。") from exc

    tables = list(document.iter(f"{W}tbl"))
    if len(tables) != 1:
        _raise("DOCX_STRUCTURE_MISMATCH", "Word 过程文档必须包含一个主表格。", tables=len(tables))
    table = tables[0]
    rows = list(table.findall(f"{W}tr"))
    grid = table.find(f"{W}tblGrid")
    grid_widths = tuple(
        _int_attr(column, "w", "table.grid")
        for column in ([] if grid is None else grid.findall(f"{W}gridCol"))
    )
    expected_rows = 15 if document_type == "midterm" else 9
    expected_grid = MIDTERM_GRID_WIDTHS if document_type == "midterm" else EXPECTED_GRID_WIDTHS
    if len(rows) != expected_rows or grid_widths != expected_grid:
        _raise(
            "DOCX_STRUCTURE_MISMATCH",
            "Word 主表格行列结构与受控模板不一致。",
            rows=len(rows),
            grid_columns=len(grid_widths),
        )

    body_text = _text(document)
    section_labels = MIDTERM_SECTION_LABELS if document_type == "midterm" else SECTION_LABELS
    positions: list[int] = []
    for label in section_labels:
        if body_text.count(label) != 1:
            _raise("DOCX_SECTION_ORDER_MISMATCH", "Word 缺少章节或章节标题重复。")
        positions.append(body_text.index(label))
    if positions != sorted(positions):
        _raise("DOCX_SECTION_ORDER_MISMATCH", "Word 章节顺序不符合受控模板要求。")

    if document_type == "midterm":
        if any("☑" in _text(row) or "■" in _text(row) for row in rows[7:13]):
            _raise("DOCX_REVIEW_REGION_NOT_BLANK", "教师评价选项必须保持未勾选。")
        if _compact(_text(rows[13])) != "存在的问题及后期指导工作意见：指导教师签名：年月日":
            _raise("DOCX_REVIEW_REGION_NOT_BLANK", "指导教师意见与签名区域必须保留为空白手写区。")
        if _compact(_text(rows[14])) != "审查小组检查意见：审查小组负责人签名：年月日":
            _raise("DOCX_REVIEW_REGION_NOT_BLANK", "审查小组意见与签名区域必须保留为空白手写区。")
    else:
        if _compact(_text(rows[7])) != "学生签名：年月日":
            _raise("DOCX_SIGNATURE_REGION_NOT_BLANK", "学生签名区域必须保留为空白手写区。")
        if _compact(_text(rows[8])) != "指导教师意见：签名：学院领导意见：签名：年月日":
            _raise("DOCX_REVIEW_REGION_NOT_BLANK", "指导教师和学院意见区域必须保留为空白手写区。")

    section_properties = document.find(f".//{W}sectPr")
    page_size = None if section_properties is None else section_properties.find(f"{W}pgSz")
    page_margins = None if section_properties is None else section_properties.find(f"{W}pgMar")
    observed_page_size = {
        key: _int_attr(page_size, key, f"page_size.{key}") for key in EXPECTED_PAGE_SIZE
    }
    observed_margins = {
        key: _int_attr(page_margins, key, f"page_margins.{key}")
        for key in EXPECTED_PAGE_MARGINS
    }
    if observed_page_size != EXPECTED_PAGE_SIZE or observed_margins != EXPECTED_PAGE_MARGINS:
        _raise("DOCX_PAGE_LAYOUT_MISMATCH", "Word 纸张尺寸或页边距与受控模板不一致。")

    visible_runs, fonts = _check_fonts(document, document_type)
    rich_paragraphs, rich_runs = _check_expected_content(document, proposal, document_type)
    return {
        "schema_version": "1.0",
        "check_id": "docx-deep-structure",
        "gate": "structure",
        "status": "pass",
        "blocking": True,
        "message": "DOCX 深层 OOXML 结构、内容顺序、字体与空白签署区检查通过。",
        "details": {
            "tables": 1,
            "rows": len(rows),
            "grid_columns": len(grid_widths),
            "visible_runs": visible_runs,
            "fonts": list(fonts),
            "rich_paragraphs": rich_paragraphs,
            "rich_runs": rich_runs,
            "page_size_twips": observed_page_size,
            "page_margins_twips": observed_margins,
            "visual_acceptance": False,
            "target_editor_verified": False,
        },
    }


__all__ = ["DocxInspectionError", "inspect_docx"]
