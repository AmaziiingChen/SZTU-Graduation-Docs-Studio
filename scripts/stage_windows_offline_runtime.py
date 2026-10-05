"""Create a relocatable Windows TeX/Poppler runtime from explicit local sources."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from sztu_docs_backend.environment import PROCESS_TEX_PACKAGE_FILES, THESIS_TEX_PACKAGE_FILES


def read_packages(database: Path) -> dict:
    result = {}
    for block in database.read_text(encoding="utf-8").split("\n\n"):
        lines = block.splitlines()
        if not lines or not lines[0].startswith("name "):
            continue
        record = {"dependencies": [], "run": [], "doc": [], "source": [], "revision": "", "license": ""}
        mode = ""
        for line in lines[1:]:
            if line.startswith("depend "):
                record["dependencies"].append(line[7:].replace(".ARCH", ".windows"))
            elif line.startswith("revision "):
                record["revision"] = line[9:]
            elif line.startswith("catalogue-license "):
                record["license"] = line[18:]
            if not line.startswith(" "):
                mode = line.split(" ")[0]
            elif mode in {"runfiles", "binfiles", "docfiles", "srcfiles"}:
                key = {"docfiles": "doc", "srcfiles": "source"}.get(mode, "run")
                record[key].append(line.strip().split(" ")[0])
        result[lines[0][5:]] = record
    return result


def select_packages(packages: dict) -> set[str]:
    names = set(PROCESS_TEX_PACKAGE_FILES + THESIS_TEX_PACKAGE_FILES)
    seeds = {"xetex", "latex-bin", "latexmk", "bibtex", "texlive.infra", "texlive-scripts", "tlperl.windows", "lm", "tex-gyre", "ninecolors", "tikzfill", "pdfcol"}
    for name in names:
        owners = [key for key, record in packages.items() if any(Path(p).name == name for p in record["run"]) and not key.endswith("-dev")]
        if not owners:
            raise RuntimeError(f"No installed package provides {name}")
        seeds.update(owners)
    selected, pending = set(), list(seeds)
    while pending:
        name = pending.pop()
        if name in selected:
            continue
        if name not in packages:
            raise RuntimeError(f"Missing installed TeX dependency: {name}")
        selected.add(name)
        pending.extend(packages[name]["dependencies"])
    return selected


def copy_file(source_root: Path, relative: str, output_root: Path) -> None:
    source = source_root / relative
    destination = output_root / relative
    if source.is_symlink() or not source.resolve().is_relative_to(source_root.resolve()) or not source.is_file():
        raise RuntimeError(f"Invalid or missing runtime source: {relative}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--texlive-root", type=Path, required=True)
    parser.add_argument("--poppler-zip", type=Path, required=True)
    parser.add_argument("--poppler-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "build" / "offline-runtime")
    args = parser.parse_args()
    if sys.platform != "win32":
        raise SystemExit("Stage this runtime on Windows x64.")
    source = args.texlive_root.resolve(strict=True)
    output = args.output.resolve()
    if output.exists():
        raise SystemExit("Output already exists; use a fresh directory to preserve previous builds.")
    packages = read_packages(source / "tlpkg" / "texlive.tlpdb")
    selected = select_packages(packages)
    files = set()
    for name in selected:
        files.update(packages[name]["run"])
        files.update(packages[name]["source"])
        files.update(p for p in packages[name]["doc"] if any(token in Path(p).name.lower() for token in ("license", "copying", "copyright", "readme")))
    files.update({"LICENSE.TL", "LICENSE.CTAN", "release-texlive.txt", "texmf-var/web2c/xetex/xelatex.fmt"})
    # Runtime DLLs are not all expressed as dependencies in the TeX package database.
    files.update(p.relative_to(source).as_posix() for p in (source / "bin" / "windows").glob("*.dll"))
    tex = output / "texlive"
    for relative in sorted(files):
        copy_file(source, relative, tex)
    wrapper = tex / "bin/windows/runscript.tlu"
    wrapper_source = wrapper.read_text(encoding="utf-8")
    original = "TEXDIR = kpse.var_value('SELFAUTOPARENT')"
    if original not in wrapper_source:
        raise RuntimeError("Unsupported TeX Live Windows wrapper version")
    wrapper.write_text(wrapper_source.replace(original, "-- SZTU portable runtime: honor its canonical ASCII root.\nTEXDIR = kpse.var_value('TEXMFROOT')"), encoding="utf-8")
    (tex / "texmf.cnf").write_text(
        "TEXMFLOCAL = $TEXMFROOT/texmf-local\n"
        "TEXMFHOME = $TEXMFROOT/texmf-local\n"
        "TEXMFVAR = $TEXMFROOT/texmf-var\n"
        "TEXMFCONFIG = $TEXMFROOT/texmf-config\n"
        "TEXLIVE_WINDOWS_TRY_EXTERNAL_PERL = 0\n"
        "OSFONTDIR = $SystemRoot/fonts//;$LOCALAPPDATA/Microsoft/Windows/Fonts//\n",
        encoding="utf-8",
    )
    for folder in ("texmf-config", "texmf-local"):
        (tex / folder).mkdir(parents=True, exist_ok=True)
    # Fontconfig paths stay relative, so moving the installation needs no repair.
    font_config = tex / "texmf-var" / "fonts" / "conf"
    font_config.mkdir(parents=True, exist_ok=True)
    (font_config / "fonts.conf").write_text(
        '<?xml version="1.0"?><fontconfig>'
        '<dir prefix="relative">../../../texmf-dist/fonts/opentype</dir>'
        '<dir prefix="relative">../../../texmf-dist/fonts/truetype</dir>'
        '<dir>C:/Windows/Fonts</dir></fontconfig>\n', encoding="utf-8",
    )
    poppler = output / "poppler"
    with zipfile.ZipFile(args.poppler_zip) as archive:
        members = archive.namelist()
        marker = next(name for name in members if name.endswith("/Library/bin/pdftoppm.exe"))
        prefix = marker[:-len("Library/bin/pdftoppm.exe")]
        for entry in archive.infolist():
            if entry.is_dir() or not entry.filename.startswith(prefix):
                continue
            relative = entry.filename[len(prefix):]
            target = poppler / relative
            if not target.resolve().is_relative_to(poppler.resolve()):
                raise RuntimeError("Poppler archive member escapes its root")
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as stream, target.open("wb") as destination:
                shutil.copyfileobj(stream, destination)
    environment = {**os.environ, "PATH": str(tex / "bin" / "windows") + ";" + os.environ.get("PATH", "")}
    subprocess.run([str(tex / "bin" / "windows" / "mktexlsr.exe"), str(tex / "texmf-dist"), str(tex / "texmf-var")], env=environment, check=True, timeout=60)
    tools = ["texlive/bin/windows/" + name + ".exe" for name in ("xelatex", "kpsewhich", "latexmk", "bibtex")]
    tools += ["poppler/Library/bin/" + name + ".exe" for name in ("pdfinfo", "pdffonts", "pdftoppm", "pdftotext", "pdftocairo")]
    checksums = {relative: hashlib.sha256((output / relative).read_bytes()).hexdigest() for relative in tools}
    checksums["texlive/bin/windows/runscript.tlu"] = hashlib.sha256(wrapper.read_bytes()).hexdigest()
    manifest = {"schema_version": "1.0", "platform": "win32", "architecture": "x64", "texlive_year": "2025",
                "poppler_source": "https://github.com/oschwartz10612/poppler-windows/releases/tag/v26.09.0-0",
                "poppler_archive_sha256": hashlib.sha256(args.poppler_zip.read_bytes()).hexdigest(),
                "tools": checksums, "packages": {name: {key: packages[name][key] for key in ("revision", "license")} for name in sorted(selected)},
                "excluded": ["user-data", "commercial-document-fonts", "local-font-caches"]}
    (output / "runtime-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "sources").mkdir()
    shutil.copyfile(args.poppler_source, output / "sources" / args.poppler_source.name)
    (output / "NOTICE.txt").write_text(
        "TeX Live portable subset: https://tug.org/texlive/\n"
        "TeX Live source: https://tug.org/texlive/svn/\n"
        "Package licenses and available macro source are retained in texlive/texmf-dist.\n"
        "Poppler upstream binary archive and its license notices are retained.\n"
        "No Windows, Office or commercial document fonts are included.\n", encoding="utf-8",
    )
    print(f"Offline runtime ready: {output}; {len(selected)} TeX packages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
