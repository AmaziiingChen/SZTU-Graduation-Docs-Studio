"""Bounded line-oriented standard input/output server."""

from __future__ import annotations

import json
import logging
import sys
from collections.abc import Iterator
from typing import IO, Any

from .errors import DUPLICATE_REQUEST_ID, MESSAGE_TOO_LARGE
from .protocol import ProtocolSession, canonical_request_id, error_response

LOGGER = logging.getLogger(__name__)
MAX_LINE_BYTES = 1_048_576
READ_CHUNK_CHARACTERS = 65_536


def _write_response(output_stream: IO[str], response: dict[str, Any]) -> None:
    output_stream.write(
        json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    output_stream.flush()


def _bounded_lines(input_stream: IO[str]) -> Iterator[tuple[str | None, bool]]:
    """Yield complete lines while discarding oversized input without buffering it."""

    while True:
        chunks: list[str] = []
        byte_count = 0
        too_large = False
        received = False
        while True:
            chunk = input_stream.readline(READ_CHUNK_CHARACTERS)
            if chunk == "":
                break
            received = True
            if not too_large:
                byte_count += len(chunk.encode("utf-8"))
                if byte_count > MAX_LINE_BYTES:
                    chunks.clear()
                    too_large = True
                else:
                    chunks.append(chunk)
            if chunk.endswith("\n"):
                break
        if not received:
            return
        yield (None if too_large else "".join(chunks), too_large)
        if chunk == "":
            return


def serve(input_stream: IO[str], output_stream: IO[str]) -> None:
    session = ProtocolSession()
    seen_request_ids: set[str] = set()
    try:
        for raw_line, too_large in _bounded_lines(input_stream):
            if too_large:
                _write_response(
                    output_stream,
                    error_response(
                        None,
                        MESSAGE_TOO_LARGE,
                        "Input line exceeds the 1 MiB limit.",
                        {"maximum_bytes": MAX_LINE_BYTES},
                    ),
                )
                continue
            assert raw_line is not None
            line = raw_line.strip()
            if not line:
                _write_response(
                    output_stream,
                    error_response(None, "INVALID_JSON", "Input line is empty."),
                )
                continue
            try:
                payload = json.loads(line)
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                LOGGER.warning(
                    "Rejected malformed JSON input at line %s column %s",
                    exc.lineno,
                    exc.colno,
                )
                _write_response(
                    output_stream,
                    error_response(
                        None,
                        "INVALID_JSON",
                        "Input line is not valid JSON.",
                        {"line": exc.lineno, "column": exc.colno},
                    ),
                )
                continue

            supplied_id = payload.get("id") if isinstance(payload, dict) else None
            canonical_id = canonical_request_id(supplied_id)
            if canonical_id is not None and canonical_id in seen_request_ids:
                _write_response(
                    output_stream,
                    error_response(
                        supplied_id,
                        DUPLICATE_REQUEST_ID,
                        "Request id was already used by this process.",
                    ),
                )
                continue
            if canonical_id is not None:
                seen_request_ids.add(canonical_id)
            _write_response(output_stream, session.dispatch(payload))
    finally:
        session.close()


def configure_logging() -> None:
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
