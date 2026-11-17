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


def bundled_tool_root(executable: "str | os.PathLike[str] | None") -> Path | None:
    """Return the runtime root owning an executable, recognized by its markers.

    The engine directory has no fixed name, so path segments cannot identify it.
    """
    if not executable:
        return None
    path = Path(executable)
    if not path.is_absolute():
        return None
    for parent in path.parents:
        if (parent / "runtime-manifest.json").is_file() and (parent / "texlive").is_dir():
            return parent
    return None


def portable_tex_root(path_value: str) -> Path | None:
    """Locate any portable TeX root on PATH, whether or not its path is ASCII.

    Callers use this to tell "no bundled engine" apart from "bundled engine in a
    path XeTeX cannot read", so it deliberately does not reject non-ASCII roots.
    """
    if os.name != "nt":
        return None
    for entry in path_value.split(os.pathsep):
        directory = Path(entry)
        if directory.name.lower() != "windows" or directory.parent.name.lower() != "bin":
            continue
        root = directory.parent.parent
        if (root.parent / "runtime-manifest.json").is_file() and (root / "texmf.cnf").is_file():
            return root
    return None


def offline_tex_root(path_value: str) -> Path | None:
    """Locate the portable TeX root behind a runtime bin directory.

    Windows has no short-name alias for a three-character Chinese profile directory, so
    a non-ASCII root is not merely untidy: kpathsea replaces those bytes with '?',
    cannot open `texmf.cnf`, and reports `I can't find the format file 'xelatex.fmt'!`.
    Refuse such a root here instead of handing it to XeTeX.
    """
    root = portable_tex_root(path_value)
    if root is None or not str(root).isascii():
        return None
    return root


def offline_tex_environment(path_value: str) -> dict[str, str]:
    root = offline_tex_root(path_value)
    if root is None:
        return {}
    root_path = str(root).replace("\\", "/")
    return {"TEXMFROOT": root_path, "TEXMFCNF": root_path + ";" + root_path + "/texmf-dist/web2c"}
