"""Command-line entry point."""

from __future__ import annotations

import sys
import os
from .runtime_paths import windows_tool_path, offline_tex_environment

from .server import configure_logging, serve


def main() -> int:
    os.environ["PATH"] = windows_tool_path(os.environ.get("PATH", ""))
    os.environ.update(offline_tex_environment(os.environ["PATH"]))
    # JSONL is UTF-8 on every platform, including frozen Windows executables.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    configure_logging()
    serve(sys.stdin, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
