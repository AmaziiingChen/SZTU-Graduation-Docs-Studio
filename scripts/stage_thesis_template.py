"""从模板工程的显式清单生成应用内置下载资源；不读取学生数据库。"""
import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT.parent / 'Thesis')
    args = parser.parse_args()
    source = args.source.resolve()
    builder = source / 'scripts/build_thesis_package.py'
    if not builder.is_file():
        parser.error('模板工程缺少下载包构建脚本，请更新同级 Thesis 或用 --source 指定工程。')
    destination = ROOT / 'apps/desktop/resources/thesis-template/sztu-thesis-2026.zip'
    subprocess.run([sys.executable, str(builder), '--output', str(destination), '--overwrite'], cwd=source, check=True)


if __name__ == '__main__':
    main()
