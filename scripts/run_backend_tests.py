from __future__ import annotations

import sys
import subprocess
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BACKEND_SOURCE = REPOSITORY_ROOT / "backend" / "src"
BACKEND_TESTS = REPOSITORY_ROOT / "backend" / "tests"


def virtualenv_python() -> Path:
    if sys.platform == "win32":
        return REPOSITORY_ROOT / ".venv" / "Scripts" / "python.exe"
    return REPOSITORY_ROOT / ".venv" / "bin" / "python"


def main() -> int:
    runtime = virtualenv_python()
    if runtime.is_file() and Path(sys.executable).resolve() != runtime.resolve():
        return subprocess.run(
            [str(runtime), str(Path(__file__).resolve())],
            check=False,
        ).returncode
    sys.path.insert(0, str(BACKEND_SOURCE))
    suite = unittest.defaultTestLoader.discover(str(BACKEND_TESTS))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
