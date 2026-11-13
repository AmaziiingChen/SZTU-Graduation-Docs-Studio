"""Autosaved student-profile input independent from complete profiles."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..errors import NotFoundError, ValidationError
from .settings import SettingsService

PROFILE_DRAFT_KEY = "workbench.profile_draft"
PROFILE_DRAFT_FIELD_LIMITS = {
    "full_name": 100,
    "student_number": 64,
    "college": 200,
    "major": 200,
    "class_name": 100,
    "advisor_name": 100,
    "advisor_title": 100,
    "graduation_cohort": 20,
}
PROFILE_DRAFT_FIELDS = (*PROFILE_DRAFT_FIELD_LIMITS, "thesis_title", "thesis_title_en")


def normalize_english_thesis_title(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError("thesis_title_en", "must_be_text")
    if len(value) > 300:
        raise ValidationError("thesis_title_en", "too_long")
    return value


def normalize_thesis_title(value: Any) -> list[Any] | None:
    """Validate the shared, single-paragraph rich-text thesis title."""

    if value is None:
        return None
    if not isinstance(value, list) or len(value) > 1:
        raise ValidationError("thesis_title", "must_be_single_paragraph")
    if not value:
        return []
    paragraph = value[0]
    if isinstance(paragraph, str):
        if len(paragraph) > 100:
            raise ValidationError("thesis_title", "too_long")
        return [paragraph]
    if (
        not isinstance(paragraph, dict)
        or set(paragraph) - {"type", "runs"}
        or paragraph.get("type", "paragraph") != "paragraph"
        or not isinstance(paragraph.get("runs"), list)
        or len(paragraph["runs"]) > 100
    ):
        raise ValidationError("thesis_title", "unsupported")
    total_length = 0
    normalized_runs: list[dict[str, Any]] = []
    for run in paragraph["runs"]:
        if (
            not isinstance(run, dict)
            or set(run) - {"text", "script", "italic", "bold"}
            or not isinstance(run.get("text"), str)
            or run.get("script", "normal") not in {"normal", "sub", "super"}
            or not isinstance(run.get("italic", False), bool)
            or not isinstance(run.get("bold", False), bool)
        ):
            raise ValidationError("thesis_title", "unsupported")
        total_length += len(run["text"])
        normalized_runs.append(dict(run))
    if total_length > 100:
        raise ValidationError("thesis_title", "too_long")
    normalized: dict[str, Any] = {"runs": normalized_runs}
    if paragraph.get("type") == "paragraph":
        normalized["type"] = "paragraph"
    return [normalized]


def normalize_profile_draft(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Return the closed shared-profile input shape with blank defaults."""

    if set(payload) - set(PROFILE_DRAFT_FIELDS):
        raise ValidationError("profile", "unsupported")
    normalized: dict[str, Any] = {}
    for field_name, maximum in PROFILE_DRAFT_FIELD_LIMITS.items():
        value = payload.get(field_name, "")
        if not isinstance(value, str):
            raise ValidationError(field_name, "must_be_text")
        if len(value) > maximum:
            raise ValidationError(field_name, "too_long")
        normalized[field_name] = value
    normalized["thesis_title"] = normalize_thesis_title(payload.get("thesis_title"))
    normalized["thesis_title_en"] = normalize_english_thesis_title(payload.get("thesis_title_en"))
    return normalized


class ProfileDraftService:
    def __init__(self, settings: SettingsService) -> None:
        self.settings = settings

    def save(self, payload: Mapping[str, Any], profile_id: str | None = None) -> dict[str, Any]:
        draft = normalize_profile_draft(payload)
        self.settings.set(self.key(profile_id), draft)
        return draft

    @staticmethod
    def key(profile_id: str | None) -> str:
        return f"{PROFILE_DRAFT_KEY}.{profile_id}" if profile_id else PROFILE_DRAFT_KEY

    def get(self, profile_id: str | None = None) -> dict[str, Any] | None:
        try:
            value = self.settings.get(self.key(profile_id))["value"]
        except NotFoundError:
            return None
        if not isinstance(value, dict):
            raise ValidationError("profile", "must_be_object")
        return normalize_profile_draft(value)
