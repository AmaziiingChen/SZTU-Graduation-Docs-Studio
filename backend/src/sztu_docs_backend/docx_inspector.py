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
            for run in value["runs"]
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
        if allow_image and block.get("type") == "image":
            if block.get("caption") is not None:
                result.append(
                    (f"{block_path}.caption", _paragraph_runs(block.get("caption")))
                )
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
    research_cells = topic_tables[0].findall(f"{W}tr/{W}tc")
    project_cells = topic_tables[1].findall(f"{W}tr/{W}tc")
    final_cells = topic_tables[2].findall(f"{W}tr/{W}tc")
    if len(research_cells) != 3 or len(project_cells) != 4 or len(final_cells) != 4:
        _raise("DOCX_STRUCTURE_MISMATCH", "任务书选题信息行内表格结构不完整。")

    paragraphs = {
        "nature": _task_book_direct_paragraph(
            topic_cell,
            "选题性质：",
            field="sections.topic_information.nature",
        ),
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
            research_cells[0],
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

    research_text = _compact(_text(research_cells[0]))
    if not (
        research_text.startswith("选题来源：1.科研项目")
        and "国家级" in research_text
        and "省部级" in research_text
        and research_text.endswith("其他：")
    ):
        _raise("DOCX_STRUCTURE_MISMATCH", "任务书科研项目选项结构不完整。")
    if _compact(_text(research_cells[1])) != _compact(expected["other_level"]):
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
    allowed_fonts = {
        "proposal": ALLOWED_FONTS,
        "midterm": MIDTERM_ALLOWED_FONTS,
        "task_book": TASK_BOOK_ALLOWED_FONTS,
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

    if document_type not in {"proposal", "midterm", "task_book"}:
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
        if len(topic_tables) != 3 or len(college_tables) != 2:
            _raise("DOCX_STRUCTURE_MISMATCH", "任务书签署区表格结构不完整。")
        task_book_checkbox_symbols = _check_task_book_topic(
            topic_cell,
            topic_tables,
            proposal,
        )
        advisor_cells = topic_tables[2].findall(f"{W}tr/{W}tc")
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
