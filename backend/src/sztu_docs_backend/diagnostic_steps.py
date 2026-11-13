"""Bounded, structured evidence for a single document-engine request."""

from __future__ import annotations

import errno
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from typing import Any

Emitter = Callable[[dict[str, Any]], None]
emitter: ContextVar[Emitter | None] = ContextVar("diagnostic_emitter", default=None)


def failure_reason(exc: BaseException) -> str | None:
    if isinstance(exc, OSError):
        return {
            errno.EACCES: "permission_denied",
            errno.EPERM: "permission_denied",
            errno.ENOENT: "file_missing",
            errno.ENOSPC: "disk_full",
            errno.ENAMETOOLONG: "path_too_long",
        }.get(exc.errno, "io_error")
    return None


@contextmanager
def step(name: str, **evidence: Any) -> Iterator[dict[str, Any]]:
    emit = emitter.get()
    started = time.monotonic()
    if emit is not None:
        emit({"stage": name, "outcome": "started", "duration_ms": 0, **evidence})
    try:
        yield evidence
    except Exception as exc:
        if emit is not None:
            code = getattr(exc, "code", None)
            reason = failure_reason(exc.__cause__ or exc)
            emit({
                "stage": name,
                "outcome": "cancelled" if code == "EXPORT_CANCELLED" else "failure",
                "duration_ms": round((time.monotonic() - started) * 1000),
                **({"error_code": code} if isinstance(code, str) else {}),
                **({"reason": reason} if reason else {}),
                **evidence,
            })
        raise
    else:
        if emit is not None:
            emit({"stage": name, "outcome": "success", "duration_ms": round((time.monotonic() - started) * 1000), **evidence})


def checkpoint(name: str, outcome: str = "success", duration_ms: int = 0, **evidence: Any) -> None:
    emit = emitter.get()
    if emit is not None:
        emit({"stage": name, "outcome": outcome, "duration_ms": duration_ms, **evidence})


def traced(name: str) -> Callable:
    def decorate(function: Callable) -> Callable:
        @wraps(function)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            with step(name):
                return function(*args, **kwargs)
        return wrapped
    return decorate
