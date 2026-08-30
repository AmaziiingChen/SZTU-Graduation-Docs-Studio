"""Command-line entry point."""

from __future__ import annotations

import sys

from .server import configure_logging, serve


def main() -> int:
    configure_logging()
    serve(sys.stdin, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
