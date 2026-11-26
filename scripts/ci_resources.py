"""Fetch pinned private CI inputs; never put fonts or credentials in Git."""
from __future__ import annotations
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def extract_zip(archive: Path, target: Path) -> None:
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            # ZipInfo.filename normalizes backslashes on Windows; audit the original header.
            raw_name = member.orig_filename
            name = PurePosixPath(raw_name)
            if ('\\' in raw_name or ':' in raw_name or name.is_absolute()
                    or '..' in name.parts or (member.external_attr >> 16) & 0o170000 == 0o120000):
                raise RuntimeError('Unsafe CI archive member')
            destination = target.joinpath(*name.parts)
            if not destination.resolve().is_relative_to(target.resolve()):
                raise RuntimeError('CI archive escapes destination')
        bundle.extractall(target)


def github_environment(name: str, value: str) -> None:
    if '\n' in value or '\r' in value:
        raise RuntimeError('Invalid environment value')
    with Path(os.environ['GITHUB_ENV']).open('a', encoding='utf-8') as stream:
        stream.write(f'{name}={value}\n')


def main() -> None:
    config = json.loads((ROOT / 'config/ci-resources.json').read_text())
    repo = config['repository']
    info = json.loads(subprocess.check_output(['gh', 'api', f'repos/{repo}']))
    if info.get('private') is not True:
        # The assets stay publicly downloadable by the owner's decision; the
        # size and SHA-256 checks below are what protect the run.
        print(
            'WARNING: repository is public; the CI font and runtime assets are '
            'downloadable by anyone.',
            file=sys.stderr,
        )
    cache = ROOT / 'build/ci-inputs'
    cache.mkdir(parents=True, exist_ok=True)
    wanted = ['fonts'] + (['windows_runtime'] if sys.platform == 'win32' else [])
    for key in wanted:
        entry = config[key]
        archive = cache / f'{key}.zip'
        with archive.open('wb') as output:
            subprocess.run(['gh', 'api', f'repos/{repo}/releases/assets/{entry["asset_id"]}',
                            '-H', 'Accept: application/octet-stream'], stdout=output, check=True)
        if archive.stat().st_size != entry['size_bytes'] or digest(archive) != entry['sha256']:
            raise RuntimeError(f'Private CI resource integrity check failed: {key}')
        target = ROOT / ('build/offline-runtime' if key == 'windows_runtime' else 'build/ci-fonts')
        if target.exists():
            raise RuntimeError(f'Use a clean CI workspace: {target}')
        extract_zip(archive, target)
        archive.unlink()
        print(f'Verified private input: {key}')
    fonts = ROOT / 'build/ci-fonts'
    private = ROOT / 'local-fonts'
    private.mkdir(exist_ok=True)
    shutil.copyfile(fonts / 'FZXiaoBiaoSong-B05S.ttf', private / 'FZXiaoBiaoSong-B05S.ttf')
    github_environment('SZTU_FONT_DIR', str(fonts))
    user_fonts = (Path(os.environ['LOCALAPPDATA']) / 'Microsoft/Windows/Fonts'
                  if sys.platform == 'win32' else Path.home() / 'Library/Fonts')
    user_fonts.mkdir(parents=True, exist_ok=True)
    for font in fonts.glob('*.ttf'):
        shutil.copyfile(font, user_fonts / font.name)
    if sys.platform == 'win32':
        # Source-level integration tests also invoke TeX/Poppler before an app is installed.
        # This declares tool locations; the production-path regression later replaces PATH.
        with Path(os.environ['GITHUB_PATH']).open('a', encoding='utf-8') as stream:
            for relative in ('texlive/bin/windows', 'poppler/Library/bin'):
                stream.write(f'{ROOT / "build/offline-runtime" / relative}\n')
        # The portable fontconfig also scans the system font directory for family lookup.
        destination = Path(os.environ['SYSTEMROOT']) / 'Fonts/simsun.ttf'
        if not destination.exists():
            shutil.copyfile(fonts / 'simsun.ttf', destination)
    if sys.platform == 'darwin':
        entry = config['macos_tex']
        archive = cache / 'tex.tar.xz'
        with urllib.request.urlopen(entry['url'], timeout=120) as response, archive.open('wb') as out:
            shutil.copyfileobj(response, out)
        if digest(archive) != entry['sha256']:
            raise RuntimeError('macOS TeX archive integrity check failed')
        target = ROOT / 'build/ci-tex'
        with tarfile.open(archive) as bundle:
            bundle.extractall(target, filter='data')
        archive.unlink()
        managers = list(target.glob('**/bin/*/tlmgr'))
        if len(managers) != 1:
            raise RuntimeError('Cannot locate the pinned macOS TeX package manager')
        bindir = managers[0].parent
        with Path(os.environ['GITHUB_PATH']).open('a', encoding='utf-8') as stream:
            stream.write(f'{bindir}\n')
        tlmgr = str(managers[0])
        subprocess.run([tlmgr, 'update', '--self'], check=True)
        # The bundled TinyTeX archive points tlmgr at a mirror that can lag
        # behind the package set (it briefly lacked fandol), so pin a full
        # CTAN mirror for the install step.
        subprocess.run(
            [tlmgr, 'option', 'repository', 'https://mirror.ctan.org/systems/texlive/tlnet'],
            check=False,
        )
        # Some TeX Live entries report a non-zero exit from a post-install
        # action (for example the mptopdf format step) even after every
        # requested package was installed. The export step below is the real
        # check, so only warn here and let it fail loudly if something is
        # genuinely missing.
        installed = subprocess.run(
            [tlmgr, 'install', *config['macos_tex_packages']], check=False
        )
        if installed.returncode != 0:
            print(
                'tlmgr reported an error after installing TeX packages; '
                'continuing to the export check',
            )


if __name__ == '__main__':
    main()
