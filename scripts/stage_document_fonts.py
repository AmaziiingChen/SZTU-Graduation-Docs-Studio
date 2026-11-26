"""Collect the document fonts into local-fonts before packaging.

模板只使用一组固定的字体：华文中宋、华文行楷、方正小标宋、Times New Roman
四款样式，以及任务书 Word 勾选框用的 Wingdings 2；正文的宋体、黑体、楷体
改用 Windows 自带字体（中文版 Windows 均随系统安装），不再随安装包分发。

华文中宋、华文行楷、方正小标宋从 local-fonts/ 或模板仓库取；Times New Roman
与 Wingdings 2 从本机系统字体目录取。字体文件不进入 git。

华文行楷与方正小标宋只排固定封面/表头文字，收进来后会由
scripts/subset_document_fonts.py 裁成只含模板用字的子集，原始字体留在
local-fonts/full/ 以便重新生成。
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

from subset_document_fonts import FULL_FONTS, SUBSET_FONTS, ensure_subsets

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = ROOT.parent / "Thesis"
LOCAL_FONTS = ROOT / "local-fonts"


def _system_font_directories() -> list[Path]:
    directories: list[Path] = []
    if os.name == "nt":
        windows = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
        directories.append(windows)
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            directories.append(Path(local_app_data) / "Microsoft" / "Windows" / "Fonts")
    return [directory for directory in directories if directory.is_dir()]


# 分发名称 -> 候选文件名（大小写不敏感）。目录里的任意同名文件都算命中。
FONTS: dict[str, tuple[str, ...]] = {
    # Office 字体：模板题名、校名、封面使用。
    "STZhongsong.ttf": ("STZhongsong.ttf", "华文中宋.ttf"),
    "STXingkai.ttf": ("STXingkai.ttf", "华文行楷.ttf"),
    "FZXiaoBiaoSong-B05S.ttf": (
        "FZXiaoBiaoSong-B05S.ttf",
        "方正小标宋简体.ttf",
        "FZXBSJW.TTF",
    ),
    # Windows 自带；宋体/黑体/楷体不随包分发。
    "times.ttf": ("times.ttf", "Times New Roman.ttf"),
    "timesbd.ttf": ("timesbd.ttf", "Times New Roman Bold.ttf"),
    "timesi.ttf": ("timesi.ttf", "Times New Roman Italic.ttf"),
    "timesbi.ttf": ("timesbi.ttf", "Times New Roman Bold Italic.ttf"),
    # 任务书 DOCX 勾选框。
    "Wingdings2.ttf": ("Wingdings2.ttf", "Wingdings 2.ttf", "Wingdng2.ttf"),
}


def _index(directories: list[Path]) -> dict[str, Path]:
    index: dict[str, Path] = {}
    for directory in directories:
        try:
            entries = list(directory.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.is_file():
                index.setdefault(entry.name.casefold(), entry)
    return index


def main() -> int:
    LOCAL_FONTS.mkdir(parents=True, exist_ok=True)
    FULL_FONTS.mkdir(parents=True, exist_ok=True)
    directories = [LOCAL_FONTS, FULL_FONTS, TEMPLATE_ROOT, *_system_font_directories()]
    index = _index(directories)
    missing: list[str] = []
    staged: list[str] = []
    for target, names in FONTS.items():
        destination = (FULL_FONTS if target in SUBSET_FONTS else LOCAL_FONTS) / target
        if destination.is_file():
            staged.append(target)
            continue
        subset = LOCAL_FONTS / target
        if target in SUBSET_FONTS and subset.is_file() and subset.stat().st_size >= 1_500_000:
            subset.replace(destination)
            staged.append(target)
            continue
        source = next(
            (index[name.casefold()] for name in names if name.casefold() in index),
            None,
        )
        if source is None:
            missing.append(
                f"{target}（查找目录：{', '.join(str(item) for item in directories)}）"
            )
            continue
        shutil.copyfile(source, destination)
        staged.append(target)
        print(f"staged {target} from {source}")
    if missing:
        print("缺少随包分发的字体：\n  " + "\n  ".join(missing), file=sys.stderr)
        print(
            "论文题名、校名或封面会因此无法排字；请把字体放到 local-fonts/ 或 ../Thesis/。",
            file=sys.stderr,
        )
        return 1
    subset_status = ensure_subsets(LOCAL_FONTS)
    print(f"document fonts ready ({len(staged)}): {', '.join(sorted(staged))}")
    return subset_status


if __name__ == "__main__":
    raise SystemExit(main())
