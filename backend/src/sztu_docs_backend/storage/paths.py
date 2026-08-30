"""Resolve private application-data paths without depending on the source tree."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from .errors import ValidationError

DATA_DIR_ENV = "SZTU_DOCS_DATA_DIR"
APP_DIRECTORY_NAME = "SZTU Graduation Docs Studio"


def resolve_data_directory(explicit: str | os.PathLike[str] | None = None) -> Path:
    """Return an absolute application-data directory.

    Electron supplies ``SZTU_DOCS_DATA_DIR=app.getPath('userData')`` in normal
    operation.  Platform fallbacks keep direct Python use out of the checkout.
    Tests should always inject a temporary directory.
    """

    raw: str | os.PathLike[str] | None = explicit
    if raw is None:
        raw = os.environ.get(DATA_DIR_ENV)
    if raw is not None:
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            raise ValidationError("data_dir", "must_be_absolute")
        return candidate.resolve(strict=False)

    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / APP_DIRECTORY_NAME
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data) / APP_DIRECTORY_NAME
        return home / "AppData" / "Local" / APP_DIRECTORY_NAME

    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    if xdg_data_home:
        return Path(xdg_data_home) / "sztu-graduation-docs-studio"
    return home / ".local" / "share" / "sztu-graduation-docs-studio"


def prepare_private_directory(path: Path) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != "nt":
        path.chmod(0o700)


def protect_private_file(path: Path) -> None:
    if os.name != "nt" and path.exists():
        path.chmod(0o600)
