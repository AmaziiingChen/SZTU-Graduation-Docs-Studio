"""Validation and JSON helpers shared by storage services."""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping
from typing import Any

from ..errors import ValidationError


def new_id() -> str:
    return uuid.uuid4().hex


def require_text(
    payload: Mapping[str, Any],
    field_name: str,
    *,
    maximum: int,
    required: bool = True,
) -> str | None:
    value = payload.get(field_name)
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise ValidationError(field_name, "must_be_text")
    normalized = value.strip()
    if required and not normalized:
        raise ValidationError(field_name, "required")
    if len(normalized) > maximum:
        raise ValidationError(field_name, "too_long")
    return normalized or None


def encode_json(value: Any, field_name: str) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ValidationError(field_name, "must_be_json_serializable") from exc


def decode_json(value: str) -> Any:
    return json.loads(value)
