"""Embed a versioned runtime separately so application upgrades can reuse it."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Preserve the published 0.1.10/0.1.11 runtime location when all immutable
# components match. The previous identifier also hashed a machine font cache.
LEGACY_RUNTIME_IDS = {
    "9b38f8e72395cf6dd862a1f5b69f2bbbd76aa8d9826d758158519df32c5b471b":
        "bdb4c8e1ac7053a7c7af5c236bc62d3eff05d9d539f4ce456a7571df5a7464ee",
}


def runtime_content_hash(runtime: Path) -> str:
    digest = hashlib.sha256()
    for file in sorted(runtime.rglob("*")):
        if file.is_symlink():
            raise RuntimeError("Runtime cannot contain symlinks")
        if file.is_file():
            relative = file.relative_to(runtime).as_posix()
            # Fontconfig regenerates these files from the user's installed fonts.
            # They must not turn an unchanged toolchain into another runtime.
            if relative.startswith("texlive/texmf-var/fonts/cache/"):
                continue
            digest.update(relative.encode())
            digest.update(hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()


def windows_units(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def validate_runtime_paths(runtime: Path, identity: str) -> int:
    relatives = [(str(p.relative_to(runtime)).replace("/", "\\"), p.is_file()) for p in runtime.rglob("*")]
    root_limit = min((259 if is_file else 247) - windows_units(name) - 1 for name, is_file in relatives)
    # Machine-wide engine root. `%PROGRAMDATA%` is the shortest realistic prefix; a longer
    # ProgramData volume is caught by the installer's own length check at run time.
    prefix = "C:\\ProgramData\\SZTU-Docs\\engine\\" + identity[:16]
    for relative, is_file in relatives:
        target = prefix + "\\" + relative
        limit = 259 if is_file else 247
        if windows_units(target) > limit:
            raise RuntimeError(f"Installer path exceeds Windows limit: {relative}")
    return root_limit


def main():
    runtime = ROOT / "build/offline-runtime"
    content_hash = runtime_content_hash(runtime)
    identity = LEGACY_RUNTIME_IDS.get(content_hash, content_hash)
    manifest_hash = hashlib.sha256((runtime / "runtime-manifest.json").read_bytes()).hexdigest()
    root_limit = validate_runtime_paths(runtime, identity)
    descriptor = {
        "schema_version": "3.0",
        "runtime_id": identity,
        "content_sha256": content_hash,
        "manifest_sha256": manifest_hash,
        # Ordered fallback chain shared by the installer, Electron and the frozen sidecar.
        "roots": [
            {"kind": "env", "name": "SZTU_ENGINE_ROOT"},
            {"kind": "path", "value": "%PROGRAMDATA%\\SZTU-Docs\\engine\\" + identity[:16]},
            {"kind": "path", "value": "%LOCALAPPDATA%\\SZTU-Docs\\r\\" + identity[:16], "legacy": True},
        ],
    }
    (ROOT / "build/offline-runtime-location.json").write_text(json.dumps(descriptor, indent=2) + "\n", encoding="utf-8")
    # The engine lives outside %LOCALAPPDATA% so a Chinese profile name can never reach
    # XeTeX. A completion marker is written last; interrupted installs retry extraction.
    source = str(runtime).replace("$", "$$")
    include = f'''!macro customInstall
  SetShellVarContext current
  ReadEnvStr $R7 "PROGRAMDATA"
  ${{If}} $R7 == ""
    SetShellVarContext all
    StrCpy $R7 "$APPDATA"
    SetShellVarContext current
  ${{EndIf}}
  StrCpy $R8 "$R7\\SZTU-Docs\\engine\\{identity[:16]}"
  StrLen $R6 "$R8"
  ${{If}} $R6 > {root_limit}
    MessageBox MB_OK|MB_ICONSTOP "编译环境安装路径过长（$R8），无法安全安装。请联系开发者处理。"
    Abort
  ${{EndIf}}
  SetDetailsView show
  SetDetailsPrint both
  StrCpy $R6 ""
  ${{If}} ${{FileExists}} "$R8\\complete.txt"
    FileOpen $R9 "$R8\\complete.txt" r
    FileRead $R9 $R6
    FileClose $R9
  ${{EndIf}}
  ${{If}} $R6 == "{identity}"
  ${{AndIf}} ${{FileExists}} "$R8\\texlive\\bin\\windows\\xelatex.exe"
  ${{AndIf}} ${{FileExists}} "$R8\\poppler\\Library\\bin\\pdftoppm.exe"
    DetailPrint "复用已安装的文档编译环境，无需重复解压。"
  ${{Else}}
    DetailPrint "正在配置离线编译环境，文件较多，可能需要几分钟。"
    Delete "$R8\\complete.txt"
    ClearErrors
    CreateDirectory "$R8"
    CreateDirectory "$R8\\texlive\\texmf-var"
    CreateDirectory "$R8\\texlive\\texmf-config"
    ${{If}} ${{Errors}}
      MessageBox MB_OK|MB_ICONSTOP "无法创建编译环境目录（$R8）。请确认磁盘空间与权限后重新运行安装包。"
      Abort
    ${{EndIf}}
    ; Other accounts only need write access to regenerated caches, never to the binaries.
    ExecWait '"$SYSDIR\\icacls.exe" "$R8\\texlive\\texmf-var" /grant *S-1-5-32-545:(OI)(CI)M /Q' $0
    ExecWait '"$SYSDIR\\icacls.exe" "$R8\\texlive\\texmf-config" /grant *S-1-5-32-545:(OI)(CI)M /Q' $0
    SetOutPath "$R8"
    SetOverwrite on
    ClearErrors
    File /r "{source}\\*"
    ${{If}} ${{Errors}}
      MessageBox MB_OK|MB_ICONSTOP "离线编译环境安装失败（目标：$R8）。请重新运行安装包修复。"
      Abort
    ${{EndIf}}
    FileOpen $R9 "$R8\\complete.txt" w
    FileWrite $R9 "{identity}"
    FileClose $R9
    ${{If}} ${{Errors}}
      Delete "$R8\\complete.txt"
      MessageBox MB_OK|MB_ICONSTOP "编译环境安装状态保存失败，请重新运行安装包修复。"
      Abort
    ${{EndIf}}
  ${{EndIf}}
  SetOutPath "$INSTDIR"
!macroend
'''
    (ROOT / "build/offline-runtime-installer.nsh").write_text(include, encoding="utf-8")
    print(f"Prepared reusable Windows runtime: {identity}")


if __name__ == "__main__":
    main()
