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

from .template_engine import ASSESSMENT_DOCUMENT_TYPES

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
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
TASK_BOOK_ALLOWED_FONTS = {
    "华文行楷",
    "黑体",
    "宋体",
    "Times New Roman",
}
TASK_BOOK_COVER_TITLE = "本科毕业论文(设计)任务书"
TASK_BOOK_COHORT_FONT = "黑体"
TASK_BOOK_CHECKBOX_FONT = "Wingdings 2"
TASK_BOOK_CHECKED_SYMBOL = "0052"
TASK_BOOK_UNCHECKED_SYMBOL = "00A3"
TASK_BOOK_GRID_WIDTHS = (8522,)
TASK_BOOK_PAGE_MARGINS = {
    "top": 1440,
    "right": 1800,
    "bottom": 1440,
    "left": 1800,
    "header": 0,
    "footer": 0,
    "gutter": 0,
}
TASK_BOOK_SECTION_LABELS = (
    "题目名称：",
    "一、毕业论文(设计)基本内容与要求：",
    "二、进度安排：",
    "三、需收集的资料和指导性参考文献：",
    "四、选题信息：",
    "指导教师签名：",
    "学院领导意见：",
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
            for run in value["runs"] if run.get("type") != "inline_equation"
        ]
    _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入的数据结构无效。")


def _append_expected_list(
    result: list[tuple[str, list[dict[str, Any]]]],
    block: Any,
    path: str,
    *,
    depth: int = 1,
) -> None:
    if (
        not isinstance(block, dict)
        or block.get("type") not in {"ordered_list", "unordered_list"}
        or set(block) != {"type", "items"}
        or not isinstance(block.get("items"), list)
        or not 1 <= len(block["items"]) <= 100
    ):
        _raise(
            "DOCX_EXPECTATION_INVALID",
            "DOCX 检查输入的列表无效。",
            field=path,
        )
    if depth > 4:
        _raise(
            "DOCX_EXPECTATION_INVALID",
            "DOCX 检查输入的列表超过四级。",
            field=path,
        )
    for item_index, item in enumerate(block["items"]):
        item_path = f"{path}.items[{item_index}]"
        allowed_fields = (
            {"marker", "content", "children"}
            if block["type"] == "ordered_list"
            else {"content", "children"}
        )
        if (
            not isinstance(item, dict)
            or set(item) - allowed_fields
            or "content" not in item
        ):
            _raise(
                "DOCX_EXPECTATION_INVALID",
                "DOCX 检查输入的列表条目无效。",
                field=item_path,
            )
        marker = item.get("marker")
        if marker is not None and (
            not isinstance(marker, str)
            or not marker.strip()
            or len(marker) > 20
        ):
            _raise(
                "DOCX_EXPECTATION_INVALID",
                "DOCX 检查输入的列表编号无效。",
                field=f"{item_path}.marker",
            )
        result.append(
            (f"{item_path}.content", _paragraph_runs(item.get("content")))
        )
        if "children" in item:
            if depth >= 4:
                _raise(
                    "DOCX_EXPECTATION_INVALID",
                    "DOCX 检查输入的列表超过四级。",
                    field=f"{item_path}.children",
                )
            _append_expected_list(
                result,
                item.get("children"),
                f"{item_path}.children",
                depth=depth + 1,
            )


def _append_expected_blocks(
    result: list[tuple[str, list[dict[str, Any]]]],
    blocks: Any,
    path: str,
    *,
    allow_image: bool,
) -> None:
    if not isinstance(blocks, list):
        _raise(
            "DOCX_EXPECTATION_INVALID",
            "DOCX 检查输入缺少正文。",
            field=path,
        )
    for block_index, block in enumerate(blocks):
        block_path = f"{path}[{block_index}]"
        if not isinstance(block, dict) or block.get("type", "paragraph") == "paragraph":
            result.append((block_path, _paragraph_runs(block)))
            continue
        if block.get("type") in {"ordered_list", "unordered_list"}:
            _append_expected_list(result, block, block_path)
            continue
        if allow_image and block.get("type") == "data_table":
            for index, column in enumerate(block["columns"]):
                result.append((f"{block_path}.columns[{index}].header", [{**run, "bold": True} for run in _paragraph_runs(column["header"])]))
            for row_index, row in enumerate(block["rows"]):
                for cell_index, cell in enumerate(row["cells"]):
                    result.append((f"{block_path}.rows[{row_index}].cells[{cell_index}]", _paragraph_runs(cell)))
            if block.get("caption") is not None:
                result.append((f"{block_path}.caption", _paragraph_runs(block["caption"])))
            continue
        if allow_image and block.get("type") == "figure_group":
            for index, item in enumerate(block["items"]):
                if item.get("caption") is not None:
                    result.append((f"{block_path}.items[{index}].caption", _paragraph_runs(item["caption"])))
            result.append((f"{block_path}.caption", _paragraph_runs(block["caption"])))
            continue
        if allow_image and block.get("type") == "image":
            if block.get("caption") is not None:
                result.append(
                    (f"{block_path}.caption", _paragraph_runs(block.get("caption")))
                )
            continue
        if allow_image and block.get("type") == "equation":
            result.append((f"{block_path}.alt", _paragraph_runs(block["alt"])))
            continue
        _raise(
            "DOCX_EXPECTATION_INVALID",
            "DOCX 检查输入的正文内容块无效。",
            field=block_path,
        )


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
    structured_sections = {"research_content", "methods_and_means", "research_steps"}
    for section in (
        "significance_and_status",
        "research_content",
        "methods_and_means",
        "research_steps",
        "references",
    ):
        if section in structured_sections:
            intro = sections.get(f"{section}_intro", "")
            if intro:
                result.append((f"sections.{section}_intro", _paragraph_runs(intro)))
        if section in structured_sections:
            _append_expected_blocks(
                result,
                sections.get(section),
                f"sections.{section}",
                allow_image=True,
            )
            continue
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
        _append_expected_blocks(
            result,
            sections.get(section_name),
            f"sections.{section_name}",
            allow_image=True,
        )
    return result


def _append_task_book_blocks(
    result: list[tuple[str, list[dict[str, Any]]]],
    blocks: Any,
    path: str,
) -> None:
    _append_expected_blocks(result, blocks, path, allow_image=True)


def _expected_task_book_paragraphs(
    task_book: dict[str, Any],
) -> list[tuple[str, list[dict[str, Any]]]]:
    metadata = task_book.get("metadata")
    sections = task_book.get("sections")
    if not isinstance(metadata, dict) or not isinstance(sections, dict):
        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少任务书基本信息或正文。")
    required_metadata = (
        "graduation_year",
        "student_id",
        "title",
        "college",
        "major",
        "class_name",
        "student_name",
        "advisor",
    )
    for field in required_metadata:
        if field not in metadata:
            _raise(
                "DOCX_EXPECTATION_INVALID",
                "DOCX 检查输入缺少任务书字段。",
                field=f"metadata.{field}",
            )
    graduation_year = metadata["graduation_year"]
    if isinstance(graduation_year, bool) or not isinstance(graduation_year, int):
        _raise(
            "DOCX_EXPECTATION_INVALID",
            "DOCX 检查输入的毕业届别无效。",
            field="metadata.graduation_year",
        )

    result: list[tuple[str, list[dict[str, Any]]]] = [
        ("metadata.student_id", _paragraph_runs(metadata["student_id"])),
        (
            "metadata.graduation_year",
            _paragraph_runs(
                {
                    "runs": [
                        {
                            "text": f"（ {graduation_year} 届）",
                            "script": "normal",
                            "bold": True,
                            "italic": False,
                        }
                    ]
                }
            ),
        ),
    ]
    for field in (
        "title",
        "college",
        "major",
        "class_name",
        "student_name",
        "advisor",
        "title",
    ):
        result.append((f"metadata.{field}", _paragraph_runs(metadata[field])))

    _append_task_book_blocks(
        result,
        sections.get("basic_content_and_requirements"),
        "sections.basic_content_and_requirements",
    )
    schedule = sections.get("schedule")
    if not isinstance(schedule, list):
        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少任务书进度安排。")
    for index, entry in enumerate(schedule):
        if not isinstance(entry, dict):
            _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入的任务书进度条目无效。")
        result.append(
            (f"sections.schedule[{index}].period", _paragraph_runs(entry.get("period")))
        )
        result.append(
            (f"sections.schedule[{index}].content", _paragraph_runs(entry.get("content")))
        )
    _append_task_book_blocks(
        result,
        sections.get("required_materials"),
        "sections.required_materials",
    )
    references = sections.get("references")
    if not isinstance(references, list):
        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少任务书参考文献。")
    result.extend(
        (f"sections.references[{index}]", _paragraph_runs(reference))
        for index, reference in enumerate(references)
    )
    topic = sections.get("topic_information")
    if not isinstance(topic, dict) or not isinstance(topic.get("source"), dict):
        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少任务书选题信息。")
    project = topic["source"].get("research_project")
    if isinstance(project, dict):
        if project.get("level") == "other":
            result.append(
                (
                    "sections.topic_information.source.research_project.other_level",
                    _paragraph_runs(project.get("other_level")),
                )
            )
        result.append(
            (
                "sections.topic_information.source.research_project.project_number",
                _paragraph_runs(project.get("project_number")),
            )
        )
    return result


def _check_task_book_cover(
    body: ElementTree.Element,
    task_book: dict[str, Any],
) -> int:
    metadata = task_book.get("metadata")
    if not isinstance(metadata, dict):
        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少任务书基本信息。")
    graduation_year = metadata.get("graduation_year")
    if isinstance(graduation_year, bool) or not isinstance(graduation_year, int):
        _raise(
            "DOCX_EXPECTATION_INVALID",
            "DOCX 检查输入的毕业届别无效。",
            field="metadata.graduation_year",
        )

    children = list(body)
    cohort_candidates = [
        (index, child)
        for index, child in enumerate(children)
        if child.tag == f"{W}p"
        and re.fullmatch(r"（\d{4}届）", _compact(_text(child)))
    ]
    if len(cohort_candidates) != 1:
        _raise(
            "DOCX_CONTENT_MISMATCH",
            "任务书封面缺少唯一的毕业届别。",
            field="metadata.graduation_year",
        )
    cohort_index, cohort_paragraph = cohort_candidates[0]
    expected_cohort = f"（{graduation_year}届）"
    if _compact(_text(cohort_paragraph)) != expected_cohort:
        _raise(
            "DOCX_CONTENT_MISMATCH",
            "任务书封面毕业届别与结构化输入不一致。",
            field="metadata.graduation_year",
        )

    title_indices = [
        index
        for index, child in enumerate(children)
        if child.tag == f"{W}p" and _compact(_text(child)) == TASK_BOOK_COVER_TITLE
    ]
    table_indices = [
        index for index, child in enumerate(children) if child.tag == f"{W}tbl"
    ]
    if (
        len(title_indices) != 1
        or not table_indices
        or not title_indices[0] < cohort_index < table_indices[0]
    ):
        _raise(
            "DOCX_STRUCTURE_MISMATCH",
            "任务书封面标题、毕业届别和题目表的顺序不符合受控模板。",
        )

    cohort_runs = [
        run for run in cohort_paragraph.iter(f"{W}r") if _text(run).strip()
    ]
    if not cohort_runs:
        _raise("DOCX_STRUCTURE_MISMATCH", "任务书封面毕业届别没有可见文本。")
    for run in cohort_runs:
        style = _run_style(run)
        fonts = style["fonts"]
        if (
            any(
                fonts.get(role) != TASK_BOOK_COHORT_FONT
                for role in ("ascii", "hAnsi", "eastAsia")
            )
            or not style["bold"]
        ):
            _raise(
                "DOCX_FONT_MISMATCH",
                "任务书封面毕业届别未使用规定的黑体加粗字体。",
                field="metadata.graduation_year",
            )
    return graduation_year


def _task_book_topic_expectation(task_book: dict[str, Any]) -> dict[str, Any]:
    sections = task_book.get("sections")
    topic = sections.get("topic_information") if isinstance(sections, dict) else None
    if not isinstance(topic, dict) or not isinstance(topic.get("source"), dict):
        _raise("DOCX_EXPECTATION_INVALID", "DOCX 检查输入缺少任务书选题信息。")

    nature = topic.get("nature")
    if nature not in {"graduation_design", "graduation_thesis"}:
        _raise(
            "DOCX_EXPECTATION_INVALID",
            "DOCX 检查输入的任务书选题性质无效。",
            field="sections.topic_information.nature",
        )
    source = topic["source"]
    source_type = source.get("type")
    if source_type not in {"research_project", "practice_project", "self_proposed"}:
        _raise(
            "DOCX_EXPECTATION_INVALID",
            "DOCX 检查输入的任务书选题来源无效。",
            field="sections.topic_information.source.type",
        )

    research_level: str | None = None
    other_level = ""
    project_number = ""
    proposer: str | None = None
    if source_type == "research_project":
        project = source.get("research_project")
        if not isinstance(project, dict):
            _raise(
                "DOCX_EXPECTATION_INVALID",
                "DOCX 检查输入缺少任务书科研项目信息。",
            )
        research_level = project.get("level")
        if research_level not in {"national", "provincial_ministerial", "other"}:
            _raise(
                "DOCX_EXPECTATION_INVALID",
                "DOCX 检查输入的任务书科研项目级别无效。",
            )
        project_number = project.get("project_number")
        if not isinstance(project_number, str):
            _raise(
                "DOCX_EXPECTATION_INVALID",
                "DOCX 检查输入的任务书项目编号无效。",
            )
        if research_level == "other":
            other_level = project.get("other_level")
            if not isinstance(other_level, str):
                _raise(
                    "DOCX_EXPECTATION_INVALID",
                    "DOCX 检查输入的任务书项目级别说明无效。",
                )
    elif source_type == "self_proposed":
        proposer = source.get("self_proposed_by")
        if proposer not in {"teacher", "student", "teacher_student_joint"}:
            _raise(
                "DOCX_EXPECTATION_INVALID",
                "DOCX 检查输入的任务书自拟题目来源无效。",
            )

    checked = TASK_BOOK_CHECKED_SYMBOL
    unchecked = TASK_BOOK_UNCHECKED_SYMBOL
    return {
        "nature": [
            checked if nature == "graduation_design" else unchecked,
            checked if nature == "graduation_thesis" else unchecked,
        ],
        "research": [
            checked
            if source_type == "research_project" and research_level == "national"
            else unchecked,
            checked
            if source_type == "research_project"
            and research_level == "provincial_ministerial"
            else unchecked,
        ],
        "practice": [
            checked if source_type == "practice_project" else unchecked
        ],
        "teacher": [
            checked
            if source_type == "self_proposed" and proposer == "teacher"
            else unchecked
        ],
        "student": [
            checked
            if source_type == "self_proposed" and proposer == "student"
            else unchecked
        ],
        "teacher_student_joint": [
            checked
            if source_type == "self_proposed"
            and proposer == "teacher_student_joint"
            else unchecked
        ],
        "other_level": other_level,
        "project_number": project_number,
    }


def _task_book_symbol_codes(
    element: ElementTree.Element,
    *,
    field: str,
) -> list[str]:
    codes: list[str] = []
    for symbol in element.iter(f"{W}sym"):
        if _attr(symbol, "font") != TASK_BOOK_CHECKBOX_FONT:
            _raise(
                "DOCX_FONT_MISMATCH",
                "任务书勾选框未使用规定的 Wingdings 2 符号字体。",
                field=field,
            )
        code = _attr(symbol, "char")
        if code not in {TASK_BOOK_CHECKED_SYMBOL, TASK_BOOK_UNCHECKED_SYMBOL}:
            _raise(
                "DOCX_CONTENT_MISMATCH",
                "任务书勾选框包含不受支持的符号。",
                field=field,
            )
        codes.append(code)
    return codes


def _task_book_direct_paragraph(
    parent: ElementTree.Element,
    token: str,
    *,
    field: str,
) -> ElementTree.Element:
    matches = [
        paragraph
        for paragraph in parent.findall(f"{W}p")
        if token in _compact(_text(paragraph))
    ]
    if len(matches) != 1:
        _raise(
            "DOCX_STRUCTURE_MISMATCH",
            "任务书选题信息的行结构与受控模板不一致。",
            field=field,
        )
    return matches[0]


def _check_task_book_topic(
    topic_cell: ElementTree.Element,
    topic_tables: list[ElementTree.Element],
    task_book: dict[str, Any],
) -> int:
    expected = _task_book_topic_expectation(task_book)
    # Frozen older templates use three inline tables; the current template
    # separates the nature/source labels into their own cells.
    split_labels = len(topic_tables) == 4
    offset = 1 if split_labels else 0
    research_cells = topic_tables[offset].findall(f"{W}tr/{W}tc")
    project_cells = topic_tables[offset + 1].findall(f"{W}tr/{W}tc")
    final_cells = topic_tables[offset + 2].findall(f"{W}tr/{W}tc")
    if len(research_cells) != (4 if split_labels else 3) or len(project_cells) != 4 or len(final_cells) != 4:
        _raise("DOCX_STRUCTURE_MISMATCH", "任务书选题信息行内表格结构不完整。")
    if split_labels:
        nature_cells = topic_tables[0].findall(f"{W}tr/{W}tc")
        if len(nature_cells) != 2 or _compact(_text(nature_cells[0])) != "选题性质：":
            _raise("DOCX_STRUCTURE_MISMATCH", "任务书选题性质标签结构不完整。")
        if _compact(_text(research_cells[0])) != "选题来源：":
            _raise("DOCX_STRUCTURE_MISMATCH", "任务书选题来源标签结构不完整。")
        nature_container = nature_cells[1]
    else:
        nature_container = _task_book_direct_paragraph(
            topic_cell, "选题性质：", field="sections.topic_information.nature"
        )
    research_options = research_cells[1 if split_labels else 0]
    other_level_cell = research_cells[2 if split_labels else 1]
    paragraphs = {
        "nature": nature_container,
        "practice": _task_book_direct_paragraph(
            topic_cell,
            "2.实践项目",
            field="sections.topic_information.source.type",
        ),
        "self_heading": _task_book_direct_paragraph(
            topic_cell,
            "3.自拟题目",
            field="sections.topic_information.source.type",
        ),
        "teacher": _task_book_direct_paragraph(
            topic_cell,
            "教师自拟",
            field="sections.topic_information.source.self_proposed_by",
        ),
        "student": _task_book_direct_paragraph(
            topic_cell,
            "学生自拟",
            field="sections.topic_information.source.self_proposed_by",
        ),
    }
    located = {
        "nature": _task_book_symbol_codes(
            paragraphs["nature"], field="sections.topic_information.nature"
        ),
        "research": _task_book_symbol_codes(
            research_options,
            field="sections.topic_information.source.research_project.level",
        ),
        "practice": _task_book_symbol_codes(
            paragraphs["practice"], field="sections.topic_information.source.type"
        ),
        "teacher": _task_book_symbol_codes(
            paragraphs["teacher"],
            field="sections.topic_information.source.self_proposed_by",
        ),
        "student": _task_book_symbol_codes(
            paragraphs["student"],
            field="sections.topic_information.source.self_proposed_by",
        ),
        "teacher_student_joint": _task_book_symbol_codes(
            final_cells[0],
            field="sections.topic_information.source.self_proposed_by",
        ),
    }
    if _task_book_symbol_codes(
        paragraphs["self_heading"],
        field="sections.topic_information.source.type",
    ):
        _raise(
            "DOCX_STRUCTURE_MISMATCH",
            "任务书自拟题目标题行不得包含勾选框。",
        )
    for field, codes in located.items():
        if codes != expected[field]:
            _raise(
                "DOCX_CONTENT_MISMATCH",
                "任务书勾选状态与结构化输入不一致。",
                field=f"sections.topic_information.{field}",
            )

    research_text = _compact(_text(research_options))
    if not (
        research_text.startswith("1.科研项目" if split_labels else "选题来源：1.科研项目")
        and "国家级" in research_text
        and "省部级" in research_text
        and research_text.endswith("其他：")
    ):
        _raise("DOCX_STRUCTURE_MISMATCH", "任务书科研项目选项结构不完整。")
    if _compact(_text(other_level_cell)) != _compact(expected["other_level"]):
        _raise(
            "DOCX_CONTENT_MISMATCH",
            "任务书科研项目级别说明与结构化输入不一致。",
            field="sections.topic_information.source.research_project.other_level",
        )
    if _compact(_text(project_cells[1])) != "项目编号：":
        _raise("DOCX_STRUCTURE_MISMATCH", "任务书项目编号标签结构不完整。")
    if _compact(_text(project_cells[2])) != _compact(expected["project_number"]):
        _raise(
            "DOCX_CONTENT_MISMATCH",
            "任务书项目编号与结构化输入不一致。",
            field="sections.topic_information.source.research_project.project_number",
        )

    all_codes = _task_book_symbol_codes(
        topic_cell,
        field="sections.topic_information",
    )
    expected_sequence = [
        *expected["nature"],
        *expected["research"],
        *expected["practice"],
        *expected["teacher"],
        *expected["student"],
        *expected["teacher_student_joint"],
    ]
    if all_codes != expected_sequence or len(all_codes) != 8:
        _raise(
            "DOCX_CONTENT_MISMATCH",
            "任务书选题信息的勾选框数量、顺序或状态不一致。",
            field="sections.topic_information",
        )
    return len(all_codes)


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
    expected = {
        "proposal": _expected_paragraphs,
        "midterm": _expected_midterm_paragraphs,
        "task_book": _expected_task_book_paragraphs,
    }[document_type](proposal)
    if document_type in {"proposal", "midterm"}:
        labels: dict[str, str] = {}
        figure_counts: dict[int, int] = {}
        equation_counts: dict[int, int] = {}
        sections = ("main_research_content", "progress") if document_type == "midterm" else ("research_content", "methods_and_means", "research_steps")
        for section in sections:
            for block in proposal["sections"][section]:
                if not isinstance(block, dict):
                    continue
                chapter = block.get("chapter", 1)
                if block.get("type") in {"image", "figure_group"}:
                    figure_counts[chapter] = figure_counts.get(chapter, 0) + 1
                    if block.get("id"):
                        labels[f"fig:{block['id']}"] = f"图 {chapter}-{figure_counts[chapter]}"
                if block.get("type") == "equation" and block.get("id"):
                    equation_counts[chapter] = equation_counts.get(chapter, 0) + 1
                    labels[f"eq:{block['id']}"] = f"({chapter}-{equation_counts[chapter]})"
        expected = [(field, [{**run, "text": re.sub(r"\{\{(fig|eq):([A-Za-z0-9_-]{8,100})\}\}", lambda match: labels.get(f"{match.group(1)}:{match.group(2)}", match.group(0)), run["text"])} for run in runs]) for field, runs in expected]
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


def _check_process_equations(root: ElementTree.Element, data: dict[str, Any], document_type: str) -> None:
    if document_type == "task_book":
        return
    sections = data.get("sections", {})
    body_names = ("main_research_content", "progress") if document_type == "midterm" else ("significance_and_status", "research_content", "methods_and_means", "research_steps")

    def count(value: Any) -> tuple[int, int]:
        if isinstance(value, list):
            pairs = [count(item) for item in value]
            return sum(pair[0] for pair in pairs), sum(pair[1] for pair in pairs)
        if not isinstance(value, dict):
            return 0, 0
        if value.get("type") == "equation":
            return 0, 1
        if value.get("type") == "inline_equation":
            return 1, 0
        pairs = [count(item) for item in value.values()]
        return sum(pair[0] for pair in pairs), sum(pair[1] for pair in pairs)

    inline_expected, display_expected = count([sections.get(name, []) for name in body_names])
    inline_actual = sum(len(paragraph.findall(f"{{{M_NS}}}oMath")) for paragraph in root.iter(f"{W}p"))
    display_actual = sum(len(paragraph.findall(f"{{{M_NS}}}oMathPara")) for paragraph in root.iter(f"{W}p"))
    if (inline_actual, display_actual) != (inline_expected, display_expected):
        _raise("DOCX_EQUATION_MISMATCH", "Word 行内或行间公式数量与输入不一致。")


def _check_fonts(
    root: ElementTree.Element,
    document_type: str = "proposal",
    *,
    title_latin_runs: set[int] | None = None,
) -> tuple[int, tuple[str, ...]]:
    allowed_fonts = {
        "proposal": ALLOWED_FONTS,
        "midterm": MIDTERM_ALLOWED_FONTS,
        "task_book": TASK_BOOK_ALLOWED_FONTS,
        **{kind: {"宋体", "SimSun", "黑体", "SimHei", "Times New Roman"} for kind in ASSESSMENT_DOCUMENT_TYPES},
    }[document_type]
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
        if "Wingdings 2" in fonts.values():
            continue
        if (
            document_type == "task_book"
            and re.fullmatch(r"\s*\d{4}\s*", value)
            and fonts.get("ascii") == "黑体"
            and fonts.get("hAnsi") == "黑体"
        ):
            # The official cohort line intentionally uses the label font for
            # both Chinese text and its four-digit year.
            continue
        if re.search(r"[\u3400-\u9fff]", value) and not (
            fonts.get("eastAsia") in allowed_fonts
            or fonts.get("ascii") in allowed_fonts
        ):
            _raise("DOCX_FONT_MISMATCH", "Word 中文文本未使用规定字体。")
        if re.search(r"[A-Za-z0-9]", value) and not (
            fonts.get("ascii") == "Times New Roman"
            or fonts.get("hAnsi") == "Times New Roman"
            or (title_latin_runs is not None and id(run) in title_latin_runs and fonts.get("ascii") in {"黑体", "SimHei"} and fonts.get("hAnsi") in {"黑体", "SimHei"})
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


def _inspect_assessment_docx(document: ElementTree.Element, data: dict[str, Any], kind: str, layout: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(layout, dict) or not isinstance(layout.get("word"), dict) or not isinstance(layout.get("page"), dict):
        _raise("DOCX_EXPECTATION_INVALID", "评审表缺少受控 Word 版式规格。")
    expected = layout["word"]
    body = document.find(f"{W}body")
    tables = [] if body is None else body.findall(f"{W}tbl")
    if len(tables) != expected.get("table_count", 1) or len(list(document.iter(f"{W}tbl"))) != len(tables):
        _raise("DOCX_STRUCTURE_MISMATCH", "评审表主表格数量与官方规格不一致。")
    table = tables[0]
    rows = table.findall(f"{W}tr")
    grid = table.find(f"{W}tblGrid")
    widths = [_int_attr(column, "w", "table.grid") for column in ([] if grid is None else grid.findall(f"{W}gridCol"))]
    heights = expected.get("row_heights_twips")
    if widths != expected.get("table_grid_twips") or not isinstance(heights, list) or len(rows) != len(heights):
        _raise("DOCX_STRUCTURE_MISMATCH", "评审表行列几何与打印规格不一致。")
    for index, (row, height) in enumerate(zip(rows, heights)):
        node = row.find(f"{W}trPr/{W}trHeight")
        if node is None or _int_attr(node, "val", "row.height") != height or node.get(f"{W}hRule") != "exact":
            _raise("DOCX_ROW_LAYOUT_MISMATCH", "评审表必须使用固定行高以保留手写空间。", row=index)
    sections = [] if body is None else body.findall(f"{W}sectPr")
    explicit_page_break = any(node.get(f"{W}type") == "page" for node in document.iter(f"{W}br"))
    if len(sections) != 1 or explicit_page_break:
        _raise("DOCX_PAGE_LAYOUT_MISMATCH", "评审表不得包含额外分页。")
    page_size = sections[0].find(f"{W}pgSz")
    page_margins = sections[0].find(f"{W}pgMar")
    def twips(mm: float) -> int:
        return round(mm * 1440 / 25.4)
    page = layout["page"]
    for key, expected_value in {"w": twips(page["width_mm"]), "h": twips(page["height_mm"])}.items():
        if abs(_int_attr(page_size, key, "page.size") - expected_value) > 1:
            _raise("DOCX_PAGE_LAYOUT_MISMATCH", "评审表纸张尺寸与打印规格不一致。")
    for key in ("top", "bottom", "left", "right"):
        if abs(_int_attr(page_margins, key, "page.margin") - twips(page[f"{key}_margin_mm"])) > 1:
            _raise("DOCX_PAGE_LAYOUT_MISMATCH", "评审表页边距与打印规格不一致。")
    text = _compact(_text(document))
    metadata = data["metadata"]
    identity_fields = ("title", "student_name", "student_id", "major") if kind == "defense_record" else ("title", "student_name", "student_id", "college", "major")
    for field in identity_fields:
        value = metadata[field]
        value = value if isinstance(value, str) else "".join(run["text"] for run in value["runs"])
        if _compact(value) not in text:
            _raise("DOCX_CONTENT_MISMATCH", "评审表基本信息未完整写入。", field=field)
    def content_fragments(value: Any):
        if isinstance(value, str):
            if value.strip():
                yield value
        elif isinstance(value, list):
            for item in value:
                yield from content_fragments(item)
        elif isinstance(value, dict):
            if "runs" in value:
                yield "".join(run["text"] for run in value["runs"])
            elif value.get("type") in {"ordered_list", "unordered_list"}:
                for item in value["items"]:
                    yield from content_fragments(item["content"])
                    yield from content_fragments(item.get("children", []))
            elif set(value) == {"question", "answer"}:
                yield from content_fragments(value["question"])
                yield from content_fragments(value["answer"])
    body_fields = {
        "advisor_review": ("comments", "division_of_work", "suggested_grade"),
        "reviewer_review": ("comments", "suggested_grade"),
        "defense_record": ("questions", "members"),
        "grade_assessment": ("comments",),
    }[kind]
    if kind == "defense_record" and (data["sections"].get("editable_headings", False) or "questions" in data["sections"].get("writing_guidance", {})):
        body_fields += ("comments",)
    for field in body_fields:
        for fragment in content_fragments(data["sections"][field]):
            if _compact(fragment) and _compact(fragment) not in text:
                _raise("DOCX_CONTENT_MISMATCH", "评审表预填内容未完整写入。", field=field)
    _check_assessment_prompts(document, data, layout)
    _check_assessment_body(document, data, kind, layout)
    if kind == "grade_assessment" and data["sections"]["final_grade"].strip():
        from decimal import Decimal, ROUND_HALF_UP
        grade = str(Decimal(data["sections"]["final_grade"]).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if grade not in text:
            _raise("DOCX_CONTENT_MISMATCH", "最终成绩未按四舍五入写入。", field="final_grade")
    if data["sections"]["date"]:
        from datetime import date
        entered = date.fromisoformat(data["sections"]["date"])
        displayed = f"{entered.year}年{entered.month}月{entered.day}日"
        if displayed not in text:
            _raise("DOCX_CONTENT_MISMATCH", "预填日期未完整写入。", field="date")
    title_latin_runs: set[int] = set()
    title_policy = layout.get("typography", {}).get("title", {})
    if title_policy.get("latin_font_role") == "cjk_label":
        for region in layout.get("regions", []):
            if region.get("key") not in {"school-title", "form-title"} or region.get("latin_font_role") != "cjk_label":
                continue
            matches = [paragraph for paragraph in body.findall(f"{W}p") if _compact(_text(paragraph)) == _compact(region["value"])]
            if len(matches) != 1:
                _raise("DOCX_CONTENT_MISMATCH", "评审表官方标题段落缺失或重复。", field=region["key"])
            for run in matches[0].iter(f"{W}r"):
                if not _text(run).strip():
                    continue
                declared_fonts = run.find(f"{W}rPr/{W}rFonts")
                if any(_attr(declared_fonts, key) not in {"黑体", "SimHei"} for key in ("ascii", "hAnsi", "cs")):
                    _raise("DOCX_FONT_MISMATCH", "评审表标题的中西文须按原表统一使用黑体。", field=region["key"])
                title_latin_runs.add(id(run))
    visible_runs, fonts = _check_fonts(document, kind, title_latin_runs=title_latin_runs)
    return {
        "schema_version": "1.0", "check_id": "docx-deep-structure", "gate": "structure",
        "status": "pass", "blocking": True, "message": "评审表 OOXML、基本信息、固定行高、页边距及字体检查通过。",
        "details": {"tables": len(tables), "rows": len(rows), "grid_columns": len(widths), "visible_runs": visible_runs, "fonts": list(fonts), "visual_acceptance": False, "target_editor_verified": False},
    }


def _check_assessment_prompts(document: ElementTree.Element, data: dict[str, Any], layout: dict[str, Any]) -> None:
    """Validate explicit guidance separately from fixed headings and legacy bodies."""
    editable = data["sections"].get("editable_headings", False)
    prompt_fields = {"prompt": "comments", "division-label": "division_of_work", "questions-prompt": "comments"}
    guidance_fields = {"prompt": "comments", "division-label": "division_of_work", "questions-prompt": "questions"}
    guidance = data["sections"].get("writing_guidance", {})
    for region in layout.get("regions", []):
        if region.get("key") not in prompt_fields:
            continue
        field = guidance_fields[region["key"]]
        if field in guidance:
            _check_assessment_guidance(document, guidance[field], region)
            continue
        parts = [
            (region.get("label", ""), region.get("label_font", "heiti"), region.get("label_size_pt", region["size_pt"])),
            (region["value"], region["font"], region["size_pt"]),
        ]
        suffix = region.get("suffix", {})
        parts.append((suffix.get("text", ""), suffix.get("font", region["font"]), suffix.get("size_pt", region["size_pt"])))
        default = "".join(value for value, _, _ in parts)
        if editable:
            blocks = data["sections"][prompt_fields[region["key"]]]
            first = blocks[0] if blocks else None
            if not isinstance(first, (str, dict)) or (isinstance(first, dict) and "runs" not in first):
                continue
            runs = _paragraph_runs(first)
            if "".join(run["text"] for run in runs) != default or any(run["bold"] or run["italic"] or run["script"] != "normal" for run in runs):
                continue
        paragraphs = [paragraph for paragraph in document.iter(f"{W}p") if _compact(_text(paragraph)) == _compact(default)]
        if not paragraphs:
            _raise("DOCX_CONTENT_MISMATCH", "评审表完整默认提示未写入。", field=region["key"])
        actual = []
        for run in paragraphs[0].iter(f"{W}r"):
            fonts = run.find(f"{W}rPr/{W}rFonts")
            size = _int_attr(run.find(f"{W}rPr/{W}sz"), "val", "prompt.size")
            actual.extend((_attr(fonts, "eastAsia"), size) for char in _text(run) if not char.isspace())
        expected = []
        for value, role, size in parts:
            families = {"黑体", "SimHei"} if role.startswith("heiti") else {"宋体", "SimSun"}
            expected.extend((families, round(size * 2)) for char in value if not char.isspace())
        if len(actual) != len(expected) or any(font not in families or size != half_points for (font, size), (families, half_points) in zip(actual, expected)):
            _raise("DOCX_FONT_MISMATCH", "评审表完整默认提示须保留原表字体与字号。", field=region["key"])


def _check_assessment_guidance(document: ElementTree.Element, guidance: Any, region: dict[str, Any]) -> None:
    policy = region.get("guidance_style")
    if not isinstance(policy, dict) or any(not isinstance(policy.get(key), dict) for key in ("fixed_label", "text", "fixed_suffix")):
        _raise("DOCX_EXPECTATION_INVALID", "评审表缺少固定标题与填写提示的字体规格。", field=region["key"])
    label_style, text_style, suffix_style = policy["fixed_label"], policy["text"], policy["fixed_suffix"]
    runs = [] if guidance is None else _paragraph_runs(guidance)
    label = region.get("label", "")
    suffix = region.get("suffix", {}).get("text", "")
    value = label + "".join(run["text"] for run in runs) + suffix
    if not value.strip():
        return
    paragraphs = [paragraph for paragraph in document.iter(f"{W}p") if _compact(_text(paragraph)) == _compact(value)]
    if not paragraphs:
        _raise("DOCX_CONTENT_MISMATCH", "评审表固定标题或填写提示未完整写入。", field=region["key"])
    paragraph = paragraphs[0]
    indent = paragraph.find(f"{W}pPr/{W}ind")
    expected_indent = round(region.get("first_line_indent_em", 0) * text_style["size_pt"] * 20) if region["key"] == "questions-prompt" else round(label_style.get("first_line_indent_em", 0) * label_style["size_pt"] * 20)
    actual_indent = 0 if _attr(indent, "firstLine") is None else _int_attr(indent, "firstLine", "guidance.indent")
    if abs(actual_indent - expected_indent) > 1 or any(_attr(indent, key) not in {None, "0"} for key in ("firstLineChars", "hanging", "left", "start")):
        _raise("DOCX_PARAGRAPH_LAYOUT_MISMATCH", "评审表固定标题及填写提示的缩进与规格不一致。", field=region["key"])
    spacing = paragraph.find(f"{W}pPr/{W}spacing")
    if "line_spacing_pt" in region and (_attr(spacing, "lineRule") != "exact" or _int_attr(spacing, "line", "guidance.line_spacing") != round(region["line_spacing_pt"] * 20)):
        _raise("DOCX_PARAGRAPH_LAYOUT_MISMATCH", "评审表填写提示的行距与规格不一致。", field=region["key"])
    actual = []
    for run in paragraph.iter(f"{W}r"):
        style = _run_style(run)
        size = _int_attr(run.find(f"{W}rPr/{W}sz"), "val", "guidance.size")
        actual.extend((style, size) for char in _text(run) if not char.isspace())
    expected = []
    def append_expected(text: str, families: set[str], size: float, *, bold: bool = False, italic: bool = False, script: str = "normal") -> None:
        expected.extend((families, round(size * 2), bold, italic, script) for char in text if not char.isspace())
    def font_families(style: dict[str, Any]) -> set[str]:
        if style["font"] in {"heiti", "heitiBold"}:
            return {"黑体", "SimHei"}
        if style["font"] == "songti":
            return {"宋体", "SimSun"}
        _raise("DOCX_EXPECTATION_INVALID", "评审表字体规格包含不支持的字体。", field=region["key"])
    append_expected(label, font_families(label_style), label_style["size_pt"], bold=label_style["bold"])
    for run in runs:
        append_expected(run["text"], font_families(text_style), text_style["size_pt"], bold=run["bold"], italic=run["italic"], script=run["script"])
    append_expected(suffix, font_families(suffix_style), suffix_style["size_pt"], bold=suffix_style["bold"])
    if len(actual) != len(expected) or any(style["fonts"].get("eastAsia") not in families or size != half_points or style["bold"] != bold or style["italic"] != italic or style["script"] != script for (style, size), (families, half_points, bold, italic, script) in zip(actual, expected)):
        _raise("DOCX_FONT_MISMATCH", "评审表固定标题及填写提示须保留来源规定的字体、字号、字重及用户样式。", field=region["key"])


def _check_assessment_body(document: ElementTree.Element, data: dict[str, Any], kind: str, layout: dict[str, Any]) -> None:
    """Explicit guidance must not absorb or restyle independent body paragraphs."""
    guidance = data["sections"].get("writing_guidance", {})
    fields = []
    if kind != "defense_record" and "comments" in guidance:
        fields.append("comments")
    if kind == "advisor_review" and "division_of_work" in guidance:
        fields.append("division_of_work")
    if kind == "defense_record" and "questions" in guidance:
        fields.append("comments")
    blocks = [(field, block) for field in fields for block in data["sections"][field]]
    if kind == "defense_record" and "questions" in guidance:
        blocks.extend((f"questions.{part}", block) for question in data["sections"]["questions"] for part in ("question", "answer") for block in question[part])
    body_size = layout.get("typography", {}).get("body", {}).get("size_pt", 10.5)
    indent_twips = round(2 * body_size * 20)
    for field, block in blocks:
        if not isinstance(block, (str, dict)) or (isinstance(block, dict) and "runs" not in block):
            continue
        runs = _paragraph_runs(block)
        value = "".join(run["text"] for run in runs)
        if not value.strip():
            continue
        matches = [paragraph for paragraph in document.iter(f"{W}p") if _compact(_text(paragraph)) == _compact(value)]
        paragraphs = [paragraph for paragraph in matches if _int_attr(paragraph.find(f"{W}pPr/{W}ind"), "firstLine", "body.indent") == indent_twips]
        if not paragraphs:
            _raise("DOCX_PARAGRAPH_LAYOUT_MISMATCH", "评审表正文须独立成段并保持两字首行缩进。", field=field)
        actual = []
        for run in paragraphs[0].iter(f"{W}r"):
            style = _run_style(run)
            size = _int_attr(run.find(f"{W}rPr/{W}sz"), "val", "body.size")
            actual.extend((style, size) for char in _text(run) if not char.isspace())
        expected = [(run["bold"], run["italic"], run["script"]) for run in runs for char in run["text"] if not char.isspace()]
        if len(actual) != len(expected) or any(style["fonts"].get("eastAsia") not in {"宋体", "SimSun"} or size != round(body_size * 2) or (style["bold"], style["italic"], style["script"]) != marks for (style, size), marks in zip(actual, expected)):
            _raise("DOCX_FONT_MISMATCH", "评审表正文须保留正文样式及用户的富文本标记。", field=field)


def inspect_docx(
    path: Path,
    proposal: dict[str, Any],
    *,
    document_type: str = "proposal",
    layout: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Inspect a process-document DOCX and return a structure-gate CheckResult."""

    if document_type not in {"proposal", "midterm", "task_book"} | ASSESSMENT_DOCUMENT_TYPES:
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

    if document_type in ASSESSMENT_DOCUMENT_TYPES:
        return _inspect_assessment_docx(document, proposal, document_type, layout)

    if document_type == "task_book":
        body = document.find(f"{W}body")
        tables = [] if body is None else body.findall(f"{W}tbl")
        if body is None or len(tables) != 3:
            _raise(
                "DOCX_STRUCTURE_MISMATCH",
                "任务书必须包含封面题目表、封面信息表和正文主表。",
                tables=len(tables),
            )
        task_book_graduation_year = _check_task_book_cover(body, proposal)
        table = tables[-1]
    else:
        task_book_graduation_year = None
        body = document.find(f"{W}body")
        tables = [] if body is None else body.findall(f"{W}tbl")
        body_names = ("main_research_content", "progress") if document_type == "midterm" else ("research_content", "methods_and_means", "research_steps")
        expected_nested = sum(
            1
            for name in body_names
            for block in proposal["sections"][name]
            if isinstance(block, dict) and (
                block.get("type") in {"data_table", "figure_group"}
                or (block.get("type") == "equation" and block.get("id"))
            )
        )
        if len(list(document.iter(f"{W}tbl"))) != 1 + expected_nested:
            _raise("DOCX_STRUCTURE_MISMATCH", "正文图表或编号公式数量与输入不一致。")
        if len(tables) != 1:
            _raise("DOCX_STRUCTURE_MISMATCH", "Word 过程文档必须包含一个主表格。", tables=len(tables))
        table = tables[0]
    rows = list(table.findall(f"{W}tr"))
    grid = table.find(f"{W}tblGrid")
    grid_widths = tuple(
        _int_attr(column, "w", "table.grid")
        for column in ([] if grid is None else grid.findall(f"{W}gridCol"))
    )
    expected_rows = {"proposal": 9, "midterm": 15, "task_book": 6}[document_type]
    expected_grid = {
        "proposal": EXPECTED_GRID_WIDTHS,
        "midterm": MIDTERM_GRID_WIDTHS,
        "task_book": TASK_BOOK_GRID_WIDTHS,
    }[document_type]
    if len(rows) != expected_rows or grid_widths != expected_grid:
        _raise(
            "DOCX_STRUCTURE_MISMATCH",
            "Word 主表格行列结构与受控模板不一致。",
            rows=len(rows),
            grid_columns=len(grid_widths),
        )

    body_text = _text(document)
    section_labels = {
        "proposal": SECTION_LABELS,
        "midterm": MIDTERM_SECTION_LABELS,
        "task_book": TASK_BOOK_SECTION_LABELS,
    }[document_type]
    positions: list[int] = []
    for label in section_labels:
        if body_text.count(label) != 1:
            _raise("DOCX_SECTION_ORDER_MISMATCH", "Word 缺少章节或章节标题重复。")
        positions.append(body_text.index(label))
    if positions != sorted(positions):
        _raise("DOCX_SECTION_ORDER_MISMATCH", "Word 章节顺序不符合受控模板要求。")

    task_book_checkbox_symbols = 0
    if document_type == "midterm":
        if any("☑" in _text(row) or "■" in _text(row) for row in rows[7:13]):
            _raise("DOCX_REVIEW_REGION_NOT_BLANK", "教师评价选项必须保持未勾选。")
        if _compact(_text(rows[13])) != "存在的问题及后期指导工作意见：指导教师签名：年月日":
            _raise("DOCX_REVIEW_REGION_NOT_BLANK", "指导教师意见与签名区域必须保留为空白手写区。")
        if _compact(_text(rows[14])) != "审查小组检查意见：审查小组负责人签名：年月日":
            _raise("DOCX_REVIEW_REGION_NOT_BLANK", "审查小组意见与签名区域必须保留为空白手写区。")
    elif document_type == "proposal":
        if _compact(_text(rows[7])) != "学生签名：年月日":
            _raise("DOCX_SIGNATURE_REGION_NOT_BLANK", "学生签名区域必须保留为空白手写区。")
        if _compact(_text(rows[8])) != "指导教师意见：签名：学院领导意见：签名：年月日":
            _raise("DOCX_REVIEW_REGION_NOT_BLANK", "指导教师和学院意见区域必须保留为空白手写区。")
    else:
        topic_cell = rows[4].find(f"{W}tc")
        college_cell = rows[5].find(f"{W}tc")
        topic_tables = [] if topic_cell is None else topic_cell.findall(f"{W}tbl")
        college_tables = [] if college_cell is None else college_cell.findall(f"{W}tbl")
        if len(topic_tables) not in (3, 4) or len(college_tables) != 2:
            _raise("DOCX_STRUCTURE_MISMATCH", "任务书签署区表格结构不完整。")
        task_book_checkbox_symbols = _check_task_book_topic(
            topic_cell,
            topic_tables,
            proposal,
        )
        advisor_cells = topic_tables[-1].findall(f"{W}tr/{W}tc")
        leader_cells = college_tables[0].findall(f"{W}tr/{W}tc")
        date_cells = college_tables[1].findall(f"{W}tr/{W}tc")
        if (
            len(advisor_cells) != 4
            or _compact(_text(advisor_cells[1])) != "指导教师签名："
            or _compact(_text(advisor_cells[2]))
            or _compact(_text(advisor_cells[3]))
        ):
            _raise("DOCX_SIGNATURE_REGION_NOT_BLANK", "任务书指导教师签名区域必须保留为空白手写区。")
        if (
            len(leader_cells) != 3
            or _compact(_text(leader_cells[0])) != "签名："
            or _compact(_text(leader_cells[1]))
            or _compact(_text(leader_cells[2]))
        ):
            _raise("DOCX_REVIEW_REGION_NOT_BLANK", "任务书学院领导意见与签名区域必须保留为空白手写区。")
        if len(date_cells) != 7 or [
            _compact(_text(date_cells[index])) for index in range(7)
        ] != ["", "年", "", "月", "", "日", ""]:
            _raise("DOCX_SIGNATURE_REGION_NOT_BLANK", "任务书日期签署区域必须保留为空白手写区。")

    section_properties = document.find(f".//{W}sectPr")
    page_size = None if section_properties is None else section_properties.find(f"{W}pgSz")
    page_margins = None if section_properties is None else section_properties.find(f"{W}pgMar")
    observed_page_size = {
        key: _int_attr(page_size, key, f"page_size.{key}") for key in EXPECTED_PAGE_SIZE
    }
    expected_page_margins = (
        TASK_BOOK_PAGE_MARGINS
        if document_type == "task_book"
        else EXPECTED_PAGE_MARGINS
    )
    observed_margins = {
        key: _int_attr(page_margins, key, f"page_margins.{key}")
        for key in expected_page_margins
    }
    if observed_page_size != EXPECTED_PAGE_SIZE or observed_margins != expected_page_margins:
        _raise("DOCX_PAGE_LAYOUT_MISMATCH", "Word 纸张尺寸或页边距与受控模板不一致。")

    visible_runs, fonts = _check_fonts(document, document_type)
    rich_paragraphs, rich_runs = _check_expected_content(document, proposal, document_type)
    _check_process_equations(document, proposal, document_type)
    return {
        "schema_version": "1.0",
        "check_id": "docx-deep-structure",
        "gate": "structure",
        "status": "pass",
        "blocking": True,
        "message": "DOCX 深层 OOXML 结构、内容顺序、字体与空白签署区检查通过。",
        "details": {
            "tables": len(tables),
            "rows": len(rows),
            "grid_columns": len(grid_widths),
            "visible_runs": visible_runs,
            "fonts": list(fonts),
            "rich_paragraphs": rich_paragraphs,
            "rich_runs": rich_runs,
            "page_size_twips": observed_page_size,
            "page_margins_twips": observed_margins,
            **(
                {
                    "task_book_graduation_year": task_book_graduation_year,
                    "task_book_checkbox_symbols": task_book_checkbox_symbols,
                }
                if document_type == "task_book"
                else {}
            ),
            "visual_acceptance": False,
            "target_editor_verified": False,
        },
    }


__all__ = ["DocxInspectionError", "inspect_docx"]
