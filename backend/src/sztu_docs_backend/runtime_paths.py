"""Resolve Windows tool paths and pin the portable TeX configuration."""
import os
from pathlib import Path


def windows_tool_path(value: str) -> str:
    if os.name != "nt":
        return value
    import ctypes
    from ctypes import wintypes
    get_short_path = ctypes.windll.kernel32.GetShortPathNameW
    get_short_path.argtypes = (wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD)
    get_short_path.restype = wintypes.DWORD
    entries = []
    for item in value.split(os.pathsep):
        item = os.path.expandvars(item)
        if " " in item or not item.isascii():
            buffer = ctypes.create_unicode_buffer(32768)
            length = get_short_path(item, buffer, len(buffer))
            if 0 < length < len(buffer):
                item = buffer.value
        entries.append(item)
    return os.pathsep.join(entries)


def windows_process_environment(environment: dict[str, str]) -> dict[str, str]:
    """Keep native PDF drivers independent of an incomplete inherited PATH."""
    if os.name != "nt":
        return environment
    result = dict(environment)
    system_root = result.get("SYSTEMROOT") or result.get("WINDIR")
    if system_root:
        system_directory = Path(os.path.expandvars(system_root)) / "System32"
        interpreter = system_directory / "cmd.exe"
        if not result.get("COMSPEC") and interpreter.is_file():
            result["COMSPEC"] = str(interpreter)
        result["PATH"] = os.pathsep.join(filter(None, (result.get("PATH"), str(system_directory))))
    if "PATH" in result:
        result["PATH"] = windows_tool_path(result["PATH"])
    return result


def offline_tex_environment(path_value: str) -> dict[str, str]:
    if os.name != "nt":
        return {}
    for entry in path_value.split(os.pathsep):
        directory = Path(entry)
        if directory.name.lower() != "windows" or directory.parent.name.lower() != "bin":
            continue
        root = directory.parent.parent
        if (root.parent / "runtime-manifest.json").is_file() and (root / "texmf.cnf").is_file():
            root_path = windows_tool_path(str(root)).replace("\\", "/")
            return {"TEXMFROOT": root_path, "TEXMFCNF": root_path + ";" + root_path + "/texmf-dist/web2c"}
    return {}
