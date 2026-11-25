"""Keep the export gate and the desktop parser on the same verdicts.

The fixture is shared with apps/desktop/src/lib/bibtex.verdicts.test.ts, so a
grammar change on either side fails one of the two suites instead of surfacing
as a "the check passed but the export failed" report from a student.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from sztu_docs_backend.bibtex_gate import (
    BibtexValidationError,
    count_valid_bibtex_entries,
)

FIXTURE = (
    Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "bibtex-verdicts.json"
)


def load_cases() -> list[dict[str, object]]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


class BibtexGateVerdictTests(unittest.TestCase):
    def test_matches_shared_fixture(self) -> None:
        cases = load_cases()
        self.assertGreaterEqual(len(cases), 10)
        for case in cases:
            with self.subTest(case=case["id"]):
                source = str(case["source"])
                if case["valid"]:
                    entries = count_valid_bibtex_entries(source)
                    if "entries" in case:
                        self.assertEqual(entries, case["entries"])
                else:
                    with self.assertRaises(BibtexValidationError) as raised:
                        count_valid_bibtex_entries(source)
                    expected = case.get("gate_reason")
                    if expected is not None:
                        self.assertEqual(raised.exception.reason, expected)

    def test_empty_value_names_the_entry_and_field(self) -> None:
        with self.assertRaises(BibtexValidationError) as raised:
            count_valid_bibtex_entries(
                "@article{first, author = {A}, title = {T}, journal = {J}, year = {2020}}\n"
                "@article{second, author = {B}, title = {U}, journal = {J}, year = {2021}, pages = {}}\n"
            )
        error = raised.exception
        self.assertEqual(error.reason, "empty_value")
        self.assertEqual(error.entry, 2)
        self.assertEqual(error.field, "pages")
        self.assertEqual(
            error.details(),
            {
                "validation_reason": "empty_value",
                "entry": 2,
                "field_name": "pages",
                "entry_type": "article",
            },
        )

    def test_bom_is_whitespace(self) -> None:
        self.assertEqual(
            count_valid_bibtex_entries(
                "\ufeff@article{a, author = {A}, title = {T}, journal = {J}, year = {2020}}\ufeff\n"
            ),
            1,
        )


if __name__ == "__main__":
    unittest.main()
