"""Ordered, transactional SQLite migrations."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Callable

from . import (
    v0001_initial,
    v0002_export_pipeline,
    v0003_student_profile_shared_fields,
    v0004_student_profile_thesis_title,
    v0005_document_recycle_bin,
    v0006_student_profile_english_thesis_title,
    v0007_scoped_profile_drafts,
)

MigrationFunction = Callable[[sqlite3.Connection], None]


@dataclass(frozen=True, slots=True)
class Migration:
    version: int
    name: str
    apply: MigrationFunction


DEFAULT_MIGRATIONS = (
    Migration(1, "initial_local_workspace", v0001_initial.apply),
    Migration(2, "trusted_engine_and_export_pipeline", v0002_export_pipeline.apply),
    Migration(
        3,
        "student_profile_shared_fields",
        v0003_student_profile_shared_fields.apply,
    ),
    Migration(
        4,
        "student_profile_thesis_title",
        v0004_student_profile_thesis_title.apply,
    ),
    Migration(
        5,
        "document_recycle_bin",
        v0005_document_recycle_bin.apply,
    ),
    Migration(6, "student_profile_english_thesis_title", v0006_student_profile_english_thesis_title.apply),
    Migration(7, "scoped_profile_drafts", v0007_scoped_profile_drafts.apply),
)


def validate_migration_plan(migrations: tuple[Migration, ...]) -> None:
    versions = [migration.version for migration in migrations]
    if versions != list(range(1, len(migrations) + 1)):
        raise ValueError("Migration versions must be unique and contiguous from 1.")
