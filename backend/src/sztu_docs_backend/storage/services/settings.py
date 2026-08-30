"""Minimal JSON settings service."""

from __future__ import annotations

from typing import Any

from ..database import Database, utc_now
from ..errors import NotFoundError, ValidationError
from .common import decode_json, encode_json


class SettingsService:
    def __init__(self, database: Database) -> None:
        self.database = database

    def set(self, key: str, value: Any) -> dict[str, Any]:
        if not isinstance(key, str) or not key.strip():
            raise ValidationError("key", "required")
        normalized = key.strip()
        if len(normalized) > 120:
            raise ValidationError("key", "too_long")
        encoded = encode_json(value, "value")
        now = utc_now()
        with self.database.transaction(immediate=True) as connection:
            connection.execute(
                """
                INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at = excluded.updated_at
                """,
                (normalized, encoded, now),
            )
        return {"key": normalized, "value": value, "updated_at": now}

    def get(self, key: str) -> dict[str, Any]:
        row = self.database.connection.execute(
            "SELECT key, value_json, updated_at FROM settings WHERE key = ?", (key,)
        ).fetchone()
        if row is None:
            raise NotFoundError("setting", key)
        return {
            "key": row["key"],
            "value": decode_json(row["value_json"]),
            "updated_at": row["updated_at"],
        }
