"""Subset the two decorative document fonts down to the characters the templates actually print.

Only 华文行楷（STXingkai）and 方正小标宋（FZXiaoBiaoSong-B05S）are safe to subset:
they are used for fixed cover/heading text. Every other bundled font also sets
user-entered text, so it must keep its full character map.

The character set is harvested from the templates that ship inside the app
(`template-packs/`, the LaTeX template ZIP, and `build/bundled-template-engines/`
when it exists). Full font binaries are kept under `local-fonts/full/` so the
subset can be rebuilt at any time; the staged subsets live in `local-fonts/`.

Run through `scripts/stage_document_fonts.py`, or directly with
`python scripts/subset_document_fonts.py`.
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
LOCAL_FONTS = ROOT / "local-fonts"
FULL_FONTS = LOCAL_FONTS / "full"

# Fonts that only ever render fixed template strings.
SUBSET_FONTS = ("STXingkai.ttf", "FZXiaoBiaoSong-B05S.ttf")

TEXT_SUFFIXES = {".tex", ".cls", ".sty", ".def", ".cfg", ".lua", ".py", ".json", ".md", ".txt"}
DOCX_PARTS = ("word/document.xml", "word/header", "word/footer", "word/footnotes.xml", "word/endnotes.xml")

# Always keep these so cover text, numbers and punctuation never fall back.
REQUIRED_CHARACTERS = set(
    "深圳技术大学本科毕业论文设计中期检查表任务书开题报告"
    "指导教师学院专业姓名学号班级年级学生日期签名意见成绩评审答辩"
    "题目单位摘要关键词目录参考文献致谢附件备注填报说明"
    "一二三四五六七八九十零〇ⅠⅡⅢⅣⅤ"
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    "，。、；：？！“”‘’（）【】《》〈〉—…·～＆％＋－×÷＝"
    " "
)

# Never ship characters that would only bloat the subset without being printed.
IGNORED_RANGES = ((0xE000, 0xF8FF), (0x0, 0x1F))


def _docx_text(archive: zipfile.ZipFile, part: str) -> str:
    try:
        raw = archive.read(part)
    except KeyError:
        return ""
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError:
        return ""
    return "".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))


def _walk_texts(root: Path) -> str:
    chunks: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix == ".docx":
            try:
                with zipfile.ZipFile(path) as archive:
                    for name in archive.namelist():
                        if name in DOCX_PARTS or re.fullmatch(r"word/(header|footer)\d+\.xml", name):
                            chunks.append(_docx_text(archive, name))
            except (OSError, zipfile.BadZipFile):
                continue
        elif suffix == ".zip":
            try:
                with zipfile.ZipFile(path) as archive:
                    for name in archive.namelist():
                        if Path(name).suffix.lower() in TEXT_SUFFIXES:
                            with archive.open(name) as stream:
                                chunks.append(stream.read().decode("utf-8", "ignore"))
            except (OSError, zipfile.BadZipFile):
                continue
        elif suffix in TEXT_SUFFIXES and path.stat().st_size < 4_000_000:
            chunks.append(path.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(chunks)


def collect_characters() -> set[str]:
    roots = [ROOT / "template-packs", ROOT / "apps" / "desktop" / "resources", ROOT / "build" / "bundled-template-engines"]
    text = "\n".join(_walk_texts(root) for root in roots if root.exists())
    characters = set(text) | REQUIRED_CHARACTERS
    return {character for character in characters if not any(low <= ord(character) <= high for low, high in IGNORED_RANGES)}


def _subset(source: Path, destination: Path, characters: set[str]) -> tuple[int, list[str]]:
    from fontTools import subset
    from fontTools.ttLib import TTFont

    font = TTFont(str(source))
    cmap = font.getBestCmap() or {}
    codepoints = {ord(character) for character in characters}
    missing = sorted(character for character in characters if ord(character) not in cmap)
    kept = codepoints - {ord(character) for character in missing}
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.notdef_outline = True
    options.recalc_bounds = True
    options.glyph_names = True
    options.layout_features = ["*"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=kept)
    subsetter.subset(font)
    destination.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(destination))
    font.close()
    return destination.stat().st_size, missing


def ensure_subsets(local_fonts: Path = LOCAL_FONTS) -> int:
    FULL_FONTS.mkdir(parents=True, exist_ok=True)
    characters = collect_characters()
    problems: list[str] = []
    for name in SUBSET_FONTS:
        staged = local_fonts / name
        full = FULL_FONTS / name
        if not full.is_file():
            if not staged.is_file():
                print(f"skip subset: {name} is not staged", file=sys.stderr)
                continue
            if staged.stat().st_size < 1_500_000:
                # Already a subset (for example from a previous build) and the
                # original was not preserved: keep it instead of shrinking again.
                print(f"skip subset: {name} already looks like a subset", file=sys.stderr)
                continue
            staged.replace(full)
        destination = staged
        size, missing = _subset(full, destination, characters)
        original = full.stat().st_size
        if size > original * 0.5:
            problems.append(f"{name}: subset is {size:,} bytes ({original:,} bytes before)")
        missing_required = sorted(set("深圳技术大学") & set(missing))
        if missing_required:
            problems.append(f"{name}: required characters missing from the font: {''.join(missing_required)}")
        print(
            f"subset {name}: {original:,} -> {size:,} bytes "
            f"({size / original:.1%}); kept {len(characters) - len(missing):,} characters"
        )
    if problems:
        for problem in problems:
            print(f"font subset problem: {problem}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(ensure_subsets())
