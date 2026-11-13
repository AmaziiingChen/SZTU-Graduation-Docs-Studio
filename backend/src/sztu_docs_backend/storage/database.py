"""SQLite lifecycle, transactions, migrations, and recoverable backups."""

from __future__ import annotations

import contextlib
import os
import sqlite3
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from .errors import MigrationError
from ..diagnostic_steps import step
from .migrations import DEFAULT_MIGRATIONS, Migration, validate_migration_plan
from .paths import prepare_private_directory, protect_private_file, resolve_data_directory

DATABASE_FILENAME = "workspace.sqlite3"
BACKUP_DIRECTORY_NAME = "backups"
BACKUP_PREFIX = "workspace-before-v"


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Database:
    """A single local workspace database.

    Temporary instances use one in-memory connection and never resolve or create
    an application-data directory.
    """

    def __init__(
        self,
        connection: sqlite3.Connection,
        *,
        data_directory: Path | None,
        database_path: Path | None,
        temporary: bool,
    ) -> None:
        self.connection = connection
        self.data_directory = data_directory
        self.database_path = database_path
        self.temporary = temporary
        self.last_backup: Path | None = None
        self._closed = False

    @classmethod
    def open_persistent(
        cls,
        data_dir: str | os.PathLike[str] | None = None,
        *,
        migrations: tuple[Migration, ...] = DEFAULT_MIGRATIONS,
    ) -> Database:
        with step("database_open"):
            directory = resolve_data_directory(data_dir)
            prepare_private_directory(directory)
            database_path = directory / DATABASE_FILENAME
            existed_before = database_path.exists()
            connection = sqlite3.connect(database_path, isolation_level=None, timeout=5.0)
        database = cls(
            connection,
            data_directory=directory,
            database_path=database_path,
            temporary=False,
        )
        try:
            database._configure_connection(persistent=True)
            protect_private_file(database_path)
            with step("migration"):
                database._migrate(migrations, backup_existing=existed_before)
            return database
        except Exception:
            connection.close()
            raise

    @classmethod
    def open_temporary(
        cls,
        *,
        migrations: tuple[Migration, ...] = DEFAULT_MIGRATIONS,
    ) -> Database:
        connection = sqlite3.connect(":memory:", isolation_level=None, timeout=5.0)
        database = cls(
            connection,
            data_directory=None,
            database_path=None,
            temporary=True,
        )
        try:
            database._configure_connection(persistent=False)
            database._migrate(migrations, backup_existing=False)
            return database
        except Exception:
            connection.close()
            raise

    def _configure_connection(self, *, persistent: bool) -> None:
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA busy_timeout = 5000")
        if persistent:
            self.connection.execute("PRAGMA journal_mode = WAL")
            self.connection.execute("PRAGMA synchronous = FULL")

    def _current_migration_version(self) -> int:
        exists = self.connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
        ).fetchone()
        if exists is None:
            return 0
        row = self.connection.execute(
            "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
        ).fetchone()
        return int(row["version"])

    def _migrate(
        self,
        migrations: tuple[Migration, ...],
        *,
        backup_existing: bool,
    ) -> None:
        validate_migration_plan(migrations)
        current_version = self._current_migration_version()
        pending = tuple(item for item in migrations if item.version > current_version)
        if not pending:
            return

        if backup_existing and not self.temporary:
            try:
                self.last_backup = self._create_backup(
                    current_version, pending[-1].version
                )
            except (OSError, sqlite3.Error) as exc:
                raise MigrationError(pending[0].version) from exc

        active_version = pending[0].version
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            for migration in pending:
                active_version = migration.version
                migration.apply(self.connection)
                self.connection.execute(
                    "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
                    (migration.version, migration.name, utc_now()),
                )
                self.connection.execute(f"PRAGMA user_version = {migration.version:d}")
            self.connection.commit()
        except Exception as exc:
            self.connection.rollback()
            raise MigrationError(active_version) from exc

    def _create_backup(self, current_version: int, target_version: int) -> Path:
        if self.data_directory is None:
            raise RuntimeError("Temporary databases do not have backups.")
        backup_directory = self.data_directory / BACKUP_DIRECTORY_NAME
        prepare_private_directory(backup_directory)
        nonce = uuid.uuid4().hex[:12]
        backup_path = backup_directory / (
            f"{BACKUP_PREFIX}{current_version}-to-v{target_version}-{nonce}.sqlite3"
        )
        descriptor = os.open(
            backup_path,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            0o600,
        )
        os.close(descriptor)
        destination: sqlite3.Connection | None = None
        try:
            destination = sqlite3.connect(backup_path)
            self.connection.backup(destination)
        except Exception:
            if destination is not None:
                destination.close()
            backup_path.unlink(missing_ok=True)
            raise
        else:
            destination.close()
        protect_private_file(backup_path)
        return backup_path

    @contextlib.contextmanager
    def transaction(self, *, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        if self._closed:
            raise RuntimeError("Database is closed.")
        self.connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
        try:
            yield self.connection
        except Exception:
            self.connection.rollback()
            raise
        else:
            self.connection.commit()

    def app_backup_files(self) -> tuple[Path, ...]:
        if self.data_directory is None:
            return ()
        backup_directory = self.data_directory / BACKUP_DIRECTORY_NAME
        if not backup_directory.is_dir():
            return ()
        return tuple(
            path
            for path in backup_directory.iterdir()
            if path.is_file()
            and path.name.startswith(BACKUP_PREFIX)
            and path.suffix == ".sqlite3"
        )

    def close(self) -> None:
        if self._closed:
            return
        self.connection.close()
        self._closed = True

    def __enter__(self) -> Database:
        return self

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        self.close()
