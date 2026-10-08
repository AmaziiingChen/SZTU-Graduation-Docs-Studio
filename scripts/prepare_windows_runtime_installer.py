"""Embed a versioned runtime separately so application upgrades can reuse it."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    runtime = ROOT / "build/offline-runtime"
    digest = hashlib.sha256()
    for file in sorted(runtime.rglob("*")):
        if file.is_symlink():
            raise RuntimeError("Runtime cannot contain symlinks")
        if file.is_file():
            digest.update(file.relative_to(runtime).as_posix().encode())
            digest.update(hashlib.sha256(file.read_bytes()).digest())
    identity = digest.hexdigest()
    manifest_hash = hashlib.sha256((runtime / "runtime-manifest.json").read_bytes()).hexdigest()
    descriptor = {"schema_version": "1.0", "runtime_id": identity, "manifest_sha256": manifest_hash}
    (ROOT / "build/offline-runtime-location.json").write_text(json.dumps(descriptor, indent=2) + "\n", encoding="utf-8")
    # Fixed app-owned location, independent of the replaceable installation folder.
    # A completion marker is written last; interrupted first installs retry extraction.
    source = str(runtime).replace("$", "$$")
    include = f'''!macro customInstall
  SetShellVarContext current
  StrCpy $R8 "$LOCALAPPDATA\\SZTU-Docs-Studio\\runtimes\\{identity}"
  SetDetailsView show
  SetDetailsPrint both
  ${{If}} ${{FileExists}} "$R8\\complete.txt"
  ${{AndIf}} ${{FileExists}} "$R8\\texlive\\bin\\windows\\xelatex.exe"
  ${{AndIf}} ${{FileExists}} "$R8\\poppler\\Library\\bin\\pdftoppm.exe"
    DetailPrint "复用已安装的文档编译环境，无需重复解压。"
  ${{Else}}
    DetailPrint "正在首次配置离线编译环境，文件较多，可能需要几分钟。"
    Delete "$R8\\complete.txt"
    SetOutPath "$R8"
    SetOverwrite on
    ClearErrors
    File /r "{source}\\*"
    ${{If}} ${{Errors}}
      MessageBox MB_OK|MB_ICONSTOP "离线编译环境安装失败，请重新运行安装包修复。"
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
