from __future__ import annotations

import sys
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BACKEND_SOURCE = REPOSITORY_ROOT / "backend" / "src"
BACKEND_TESTS = REPOSITORY_ROOT / "backend" / "tests"


def main() -> int:
    sys.path.insert(0, str(BACKEND_SOURCE))
    suite = unittest.defaultTestLoader.discover(str(BACKEND_TESTS))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
