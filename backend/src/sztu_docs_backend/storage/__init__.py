"""Dependency-free local SQLite storage for the desktop workbench."""

from .errors import (
    MigrationError,
    NotFoundError,
    RevisionConflictError,
    StorageError,
    ValidationError,
)
from .services import Workspace

__all__ = [
    "MigrationError",
    "NotFoundError",
    "RevisionConflictError",
    "StorageError",
    "ValidationError",
    "Workspace",
]
