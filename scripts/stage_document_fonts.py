"""Collect the non-system document fonts into local-fonts before packaging.

宋体、黑体、楷体、Times New Roman 由 Windows 自带，不需要分发；论文题名用的华文中宋、
任务书校名用的华文行楷、封面用的方正小标宋则经常不在新机器上，直接随安装包分发，
用户开箱即可导出，不再需要在系统里找 Office 字体。
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = ROOT.parent / "Thesis"
LOCAL_FONTS = ROOT / "local-fonts"

# 分发名称 -> 搜索顺序。目录里的任意同名文件都算命中。
FONTS = {
    "FZXiaoBiaoSong-B05S.ttf": ("FZXiaoBiaoSong-B05S.ttf", "方正小标宋简体.ttf", "FZXBSJW.TTF"),
    "STXingkai.ttf": ("STXingkai.ttf", "华文行楷.ttf"),
    "STZhongsong.ttf": ("STZhongsong.ttf", "华文中宋.ttf"),
}


def locate(names: tuple[str, ...], directories: list[Path]) -> Path | None:
    for directory in directories:
        for name in names:
            candidate = directory / name
            if candidate.is_file():
                return candidate
    return None


def main() -> int:
    LOCAL_FONTS.mkdir(parents=True, exist_ok=True)
    directories = [LOCAL_FONTS, TEMPLATE_ROOT]
    missing: list[str] = []
    for target, names in FONTS.items():
        destination = LOCAL_FONTS / target
        if destination.is_file():
            continue
        source = locate(names, directories)
        if source is None:
            missing.append(f"{target}（查找目录：{', '.join(str(item) for item in directories)}）")
            continue
        shutil.copyfile(source, destination)
        print(f"staged {target} from {source}")
    if missing:
        print("缺少随包分发的字体：\n  " + "\n  ".join(missing), file=sys.stderr)
        print("论文题名、校名或封面会因此无法排字。请把字体放到 local-fonts/ 或 ../Thesis/。", file=sys.stderr)
        return 1
    print(f"document fonts ready: {', '.join(sorted(FONTS))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
