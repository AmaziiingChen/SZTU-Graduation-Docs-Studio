"""Small, dependency-free BibTeX validation for the export trust boundary.

The desktop owns citation formatting, but export must not trust draft metadata
that merely claims raw BibTeX was parsed successfully.  This module deliberately
validates only the source structure and the fields needed by the desktop parser;
it never returns or logs source text.
"""

from __future__ import annotations

from dataclasses import dataclass


SUPPORTED_TYPES = frozenset(
    {
        "article",
        "book",
        "inbook",
        "incollection",
        "inproceedings",
        "conference",
        "proceedings",
        "mastersthesis",
        "phdthesis",
        "techreport",
        "manual",
        "misc",
        "online",
        "electronic",
        "www",
        "patent",
        "standard",
    }
)

REQUIRED_FIELDS: dict[str, frozenset[str]] = {
    "article": frozenset({"author", "title", "journal", "year"}),
    "book": frozenset({"title", "year"}),
    "inbook": frozenset({"author", "title", "booktitle", "year"}),
    "incollection": frozenset({"author", "title", "booktitle", "year"}),
    "inproceedings": frozenset({"author", "title", "booktitle", "year"}),
    "conference": frozenset({"author", "title", "booktitle", "year"}),
    "proceedings": frozenset({"title", "year"}),
    "mastersthesis": frozenset({"author", "title", "school", "year"}),
    "phdthesis": frozenset({"author", "title", "school", "year"}),
    "techreport": frozenset({"author", "title", "institution", "year"}),
    "manual": frozenset({"title"}),
    "misc": frozenset({"title"}),
    "online": frozenset({"title"}),
    "electronic": frozenset({"title"}),
    "www": frozenset({"title"}),
    "patent": frozenset({"author", "title", "year"}),
    "standard": frozenset({"title", "year"}),
}

DIRECTIVE_TYPES = frozenset({"comment", "preamble", "string"})


class BibtexValidationError(ValueError):
    """Sanitized source-validation failure safe to map to an export error."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _is_identifier_character(character: str) -> bool:
    return character.isascii() and (
        character.isalnum() or character in "_:-./"
    )


@dataclass
class _Scanner:
    source: str
    index: int = 0

    @property
    def done(self) -> bool:
        return self.index >= len(self.source)

    def peek(self) -> str:
        return "" if self.done else self.source[self.index]

    def skip_space_and_comments(self) -> None:
        while not self.done:
            if self.peek().isspace():
                self.index += 1
                continue
            if self.peek() == "%":
                while not self.done and self.peek() != "\n":
                    self.index += 1
                continue
            return

    def read_identifier(self) -> str:
        start = self.index
        while not self.done and _is_identifier_character(self.peek()):
            self.index += 1
        return self.source[start : self.index]

    def read_until(self, stop_characters: frozenset[str]) -> str:
        start = self.index
        while not self.done and self.peek() not in stop_characters:
            self.index += 1
        return self.source[start : self.index]

    def read_braced_value(self) -> str:
        if self.peek() != "{":
            raise BibtexValidationError("invalid_value")
        self.index += 1
        start = self.index
        depth = 1
        escaped = False
        while not self.done:
            character = self.peek()
            self.index += 1
            if escaped:
                escaped = False
                continue
            if character == "\\":
                escaped = True
                continue
            if character == "{":
                depth += 1
            elif character == "}":
                depth -= 1
                if depth == 0:
                    return self.source[start : self.index - 1]
        raise BibtexValidationError("unclosed_value")

    def read_quoted_value(self) -> str:
        if self.peek() != '"':
            raise BibtexValidationError("invalid_value")
        self.index += 1
        start = self.index
        brace_depth = 0
        escaped = False
        while not self.done:
            character = self.peek()
            self.index += 1
            if escaped:
                escaped = False
                continue
            if character == "\\":
                escaped = True
                continue
            if character == "{":
                brace_depth += 1
            elif character == "}" and brace_depth > 0:
                brace_depth -= 1
            elif character == '"' and brace_depth == 0:
                return self.source[start : self.index - 1]
        raise BibtexValidationError("unclosed_value")

    def read_value(self, entry_close: str) -> str:
        parts: list[str] = []
        while not self.done:
            self.skip_space_and_comments()
            if self.peek() == "{":
                parts.append(self.read_braced_value())
            elif self.peek() == '"':
                parts.append(self.read_quoted_value())
            else:
                bare = self.read_until(frozenset({",", "#", entry_close})).strip()
                if bare:
                    parts.append(bare)
            self.skip_space_and_comments()
            if self.peek() != "#":
                break
            self.index += 1
        value = "".join(parts).strip()
        if not value:
            raise BibtexValidationError("empty_value")
        return value

    def skip_directive_body(self, entry_open: str, entry_close: str) -> None:
        depth = 1
        quoted = False
        escaped = False
        while not self.done:
            character = self.peek()
            self.index += 1
            if escaped:
                escaped = False
                continue
            if character == "\\":
                escaped = True
                continue
            if character == '"':
                quoted = not quoted
                continue
            if quoted:
                continue
            if character == entry_open:
                depth += 1
            elif character == entry_close:
                depth -= 1
                if depth == 0:
                    return
        raise BibtexValidationError("unclosed_directive")


def count_valid_bibtex_entries(source: str) -> int:
    """Validate supported BibTeX and return its non-directive entry count.

    The accepted grammar intentionally mirrors the desktop's local parser:
    entries may use braces or parentheses, values may be braced, quoted, bare,
    or ``#``-concatenated, and percent comments are ignored outside values.
    Duplicate citation keys, unsupported types, missing required fields, and
    malformed structure all make the declaration invalid.
    """

    scanner = _Scanner(source)
    seen_keys: set[str] = set()
    entry_count = 0

    while not scanner.done:
        scanner.skip_space_and_comments()
        if scanner.done:
            break
        if scanner.peek() != "@":
            raise BibtexValidationError("entry_prefix")
        scanner.index += 1
        entry_type = scanner.read_identifier().lower()
        scanner.skip_space_and_comments()
        entry_open = scanner.peek()
        if not entry_type or entry_open not in {"{", "("}:
            raise BibtexValidationError("entry_header")
        scanner.index += 1
        entry_close = "}" if entry_open == "{" else ")"

        if entry_type in DIRECTIVE_TYPES:
            scanner.skip_directive_body(entry_open, entry_close)
            continue
        if entry_type not in SUPPORTED_TYPES:
            raise BibtexValidationError("unsupported_type")

        scanner.skip_space_and_comments()
        citation_key = scanner.read_until(frozenset({",", entry_close})).strip()
        if not citation_key or scanner.peek() != ",":
            raise BibtexValidationError("citation_key")
        normalized_key = citation_key.casefold()
        if normalized_key in seen_keys:
            raise BibtexValidationError("duplicate_key")
        seen_keys.add(normalized_key)
        scanner.index += 1

        fields: dict[str, str] = {}
        closed = False
        while not scanner.done:
            scanner.skip_space_and_comments()
            if scanner.peek() == entry_close:
                scanner.index += 1
                closed = True
                break
            if scanner.peek() == ",":
                scanner.index += 1
                continue
            field = scanner.read_identifier().lower()
            scanner.skip_space_and_comments()
            if not field or scanner.peek() != "=":
                raise BibtexValidationError("field_definition")
            scanner.index += 1
            fields[field] = scanner.read_value(entry_close)
            scanner.skip_space_and_comments()
            if scanner.peek() == ",":
                scanner.index += 1
        if not closed:
            raise BibtexValidationError("unclosed_entry")
        if any(not fields.get(field, "").strip() for field in REQUIRED_FIELDS[entry_type]):
            raise BibtexValidationError("missing_required_field")
        entry_count += 1

    if entry_count == 0:
        raise BibtexValidationError("no_entries")
    return entry_count
