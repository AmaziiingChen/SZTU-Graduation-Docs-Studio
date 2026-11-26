"""Checks for the staged decorative-font subsets.

These run against the developer/packaging checkout: the fonts themselves are
not committed, so the test skips when `local-fonts/` was never staged.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from stage_document_fonts import FONTS  # noqa: E402
from subset_document_fonts import FULL_FONTS, REQUIRED_CHARACTERS, SUBSET_FONTS  # noqa: E402


class DocumentFontSubsetTest(unittest.TestCase):
    def test_system_cjk_faces_are_not_bundled(self) -> None:
        bundled = {name.casefold() for name in FONTS}
        for name in ("simsun.ttc", "simhei.ttf", "simkai.ttf"):
            self.assertNotIn(name, bundled)

    def test_subsets_keep_every_required_character(self) -> None:
        try:
            from fontTools.ttLib import TTFont
        except ImportError:  # pragma: no cover - packaging-only dependency
            self.skipTest("fonttools is not installed")
        checked = 0
        for name in SUBSET_FONTS:
            path = ROOT / "local-fonts" / name
            full = FULL_FONTS / name
            if not path.is_file() or not full.is_file():
                continue
            subset_cmap = TTFont(str(path)).getBestCmap() or {}
            full_cmap = TTFont(str(full)).getBestCmap() or {}
            # Every required character the original font can draw must survive
            # the subset; characters the font never had are irrelevant.
            expected = {ord(character) for character in REQUIRED_CHARACTERS if ord(character) in full_cmap}
            missing = sorted(character for character in expected if character not in subset_cmap)
            self.assertEqual(missing, [], f"{name} is missing required characters")
            checked += 1
            if name == "STXingkai.ttf":
                self.assertIn("华文行楷", {record.toUnicode() for record in TTFont(str(path))["name"].names if record.nameID == 1})
            if name == "FZXiaoBiaoSong-B05S.ttf":
                self.assertIn("方正小标宋简体", {record.toUnicode() for record in TTFont(str(path))["name"].names if record.nameID == 1})
        if checked == 0:
            self.skipTest("local-fonts is not staged")

    def test_subset_is_much_smaller_than_the_original(self) -> None:
        for name in SUBSET_FONTS:
            full = FULL_FONTS / name
            subset = ROOT / "local-fonts" / name
            if not full.is_file() or not subset.is_file():
                continue
            self.assertLess(subset.stat().st_size, full.stat().st_size * 0.3, name)


if __name__ == "__main__":
    unittest.main()
