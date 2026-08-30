"""Stable protocol errors exposed by the sidecar."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class ProtocolError(Exception):
    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return self.message


INVALID_REQUEST = "INVALID_REQUEST"
METHOD_NOT_FOUND = "METHOD_NOT_FOUND"
INVALID_PARAMS = "INVALID_PARAMS"
MESSAGE_TOO_LARGE = "MESSAGE_TOO_LARGE"
DUPLICATE_REQUEST_ID = "DUPLICATE_REQUEST_ID"
WORKSPACE_NOT_OPEN = "WORKSPACE_NOT_OPEN"
WORKSPACE_ALREADY_OPEN = "WORKSPACE_ALREADY_OPEN"
