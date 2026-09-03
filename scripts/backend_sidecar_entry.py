"""PyInstaller entry point for the local document-engine sidecar."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

from sztu_docs_backend.__main__ import main


def run() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "--run-python-script":
        script = Path(sys.argv[2]).resolve(strict=True)
        sys.argv = [str(script), *sys.argv[3:]]
        for import_root in (script.parent, Path.cwd()):
            value = str(import_root)
            if value not in sys.path:
                sys.path.insert(0, value)
        runpy.run_path(str(script), run_name="__main__")
        return 0
    if len(sys.argv) != 1:
        raise SystemExit("Unsupported packaged-sidecar arguments.")
    return main()


if __name__ == "__main__":
    raise SystemExit(run())
