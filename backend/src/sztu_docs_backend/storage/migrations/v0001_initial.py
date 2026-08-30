"""Initial local-workspace schema."""

from __future__ import annotations

import sqlite3


STATEMENTS = (
    """
    CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE student_profiles (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        student_number TEXT NOT NULL UNIQUE,
        college TEXT NOT NULL,
        major TEXT NOT NULL,
        class_name TEXT,
        advisor_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        soft_deleted_at TEXT
    )
    """,
    """
    CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        profile_id TEXT REFERENCES student_profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        document_type TEXT NOT NULL,
        template_version TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft', 'ready', 'archived')),
        is_temporary INTEGER NOT NULL DEFAULT 0 CHECK (is_temporary IN (0, 1)),
        current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE draft_revisions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        revision_number INTEGER NOT NULL CHECK (revision_number > 0),
        content_json TEXT NOT NULL,
        save_reason TEXT NOT NULL
            CHECK (save_reason IN ('auto', 'manual', 'restore', 'import')),
        based_on_revision INTEGER NOT NULL CHECK (based_on_revision >= 0),
        created_at TEXT NOT NULL,
        UNIQUE (document_id, revision_number)
    )
    """,
    """
    CREATE TABLE export_jobs (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        requested_formats_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        error_code TEXT,
        output_directory TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE export_artifacts (
        id TEXT PRIMARY KEY,
        export_job_id TEXT NOT NULL REFERENCES export_jobs(id) ON DELETE CASCADE,
        format TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        checks_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (export_job_id, format, relative_path)
    )
    """,
    """
    CREATE TABLE template_installations (
        template_id TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        PRIMARY KEY (template_id, version)
    )
    """,
    """
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX idx_documents_profile_id ON documents(profile_id)",
    "CREATE INDEX idx_draft_revisions_document ON draft_revisions(document_id, revision_number DESC)",
    "CREATE INDEX idx_export_jobs_document ON export_jobs(document_id, created_at DESC)",
    "CREATE INDEX idx_export_artifacts_job ON export_artifacts(export_job_id)",
)


def apply(connection: sqlite3.Connection) -> None:
    for statement in STATEMENTS:
        connection.execute(statement)
