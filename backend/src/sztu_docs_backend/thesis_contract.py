"""Versioned thesis authoring contract. Draft validation permits unfinished fields."""
from __future__ import annotations

import re

from .storage.errors import ValidationError

FIELDS = {"version", "englishTitle", "submissionDate", "abstractCn", "keywordsCn", "abstractEn", "keywordsEn", "chapters", "referencesBibtex", "acknowledgements", "appendix"}


def _fail(path: str, reason: str = "invalid_thesis_draft") -> None:
    raise ValidationError(path, reason)


def _paragraph(value, path):
    if isinstance(value, str):
        if len(value) > 100000:
            _fail(path, "too_long")
        return
    if not isinstance(value, dict) or set(value) - {"type", "runs"} or value.get("type", "paragraph") != "paragraph" or not isinstance(value.get("runs"), list):
        _fail(path)
    for run in value["runs"]:
        if not isinstance(run, dict) or set(run) - {"text", "script", "bold", "italic"} or not isinstance(run.get("text"), str):
            _fail(path)
        if run.get("script", "normal") not in {"normal", "sub", "super"} or any(not isinstance(run[k], bool) for k in ("bold", "italic") if k in run):
            _fail(path)


def _body(value, path, depth=0, media=False):
    if not isinstance(value, list) or len(value) > 2000:
        _fail(path)
    for index, block in enumerate(value):
        field = f"{path}[{index}]"
        if isinstance(block, dict) and block.get("type") in {"ordered_list", "unordered_list"}:
            if depth >= 4 or set(block) - {"type", "items"} or not isinstance(block.get("items"), list):
                _fail(field)
            for item in block["items"]:
                if not isinstance(item, dict) or set(item) - {"content", "marker", "children"}:
                    _fail(field)
                _paragraph(item.get("content"), field)
                if "marker" in item and not isinstance(item["marker"], str):
                    _fail(field)
                if "children" in item:
                    _body([item["children"]], field, depth + 1)
        elif media and depth == 0 and isinstance(block, dict) and block.get("type") == "equation":
            if set(block) != {"type", "id", "latex"} or not isinstance(block["id"], str) or not re.fullmatch(r"eq-[A-Za-z0-9_-]{8,96}", block["id"]) or not isinstance(block["latex"], str) or not block["latex"].strip() or len(block["latex"]) > 10000:
                _fail(field, "invalid_equation")
        elif media and depth == 0 and isinstance(block, dict) and block.get("type") in {"image", "figure_group", "data_table"}:
            # Deferred import keeps storage initialization independent of export orchestration.
            from .exporter import ExportError, validate_authoring_media
            try:
                validate_authoring_media(block, field)
            except ExportError:
                _fail(field, "invalid_media_block")
        else:
            _paragraph(block, field)


def validate_thesis_content(content):
    draft = content.get("thesis")
    if not isinstance(draft, dict) or set(draft) not in (FIELDS, FIELDS - {"submissionDate"}) or type(draft["version"]) is not int or draft["version"] != 1:
        _fail("thesis", "unsupported_thesis_version")
    submission_date = draft.get("submissionDate", "")
    if not isinstance(submission_date, str) or (submission_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", submission_date)):
        _fail("thesis.submissionDate")
    for name in ("englishTitle", "keywordsCn", "keywordsEn", "referencesBibtex"):
        if not isinstance(draft[name], str) or len(draft[name]) > 500000:
            _fail(f"thesis.{name}")
    for name in ("abstractCn", "abstractEn", "acknowledgements", "appendix"):
        _body(draft[name], f"thesis.{name}")
    if not isinstance(draft["chapters"], list) or len(draft["chapters"]) > 200:
        _fail("thesis.chapters")
    ids, previous = set(), 0
    for i, chapter in enumerate(draft["chapters"]):
        field = f"thesis.chapters[{i}]"
        if not isinstance(chapter, dict) or set(chapter) != {"id", "level", "title", "body"}:
            _fail(field)
        cid, level = chapter["id"], chapter["level"]
        if not isinstance(cid, str) or not 1 <= len(cid) <= 100 or cid in ids:
            _fail(field, "duplicate_or_invalid_chapter_id")
        if type(level) is not int or not 1 <= level <= 3 or level > previous + 1:
            _fail(field, "invalid_chapter_level")
        if not isinstance(chapter["title"], str) or len(chapter["title"]) > 200:
            _fail(field)
        _body(chapter["body"], field + ".body", media=True)
        ids.add(cid)
        previous = level

    equation_ids = set()
    for chapter in draft["chapters"]:
        for block in chapter["body"]:
            if isinstance(block, dict) and block.get("type") == "equation":
                if block["id"] in equation_ids:
                    _fail("thesis.chapters", "duplicate_equation_id")
                equation_ids.add(block["id"])

    figure_ids = set()
    root = 0
    for chapter in draft["chapters"]:
        if chapter["level"] == 1:
            root += 1
        for block in chapter["body"]:
            if not isinstance(block, dict) or block.get("type") not in {"image", "figure_group"}:
                continue
            fid = block.get("id")
            if not fid or fid in figure_ids or block.get("chapter") != root:
                _fail("thesis.chapters", "invalid_figure_ownership")
            figure_ids.add(fid)
