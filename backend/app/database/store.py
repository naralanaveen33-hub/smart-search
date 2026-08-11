"""Persistence for documents, search history and index metadata.

Supabase PostgreSQL is used when credentials are configured; otherwise the same
interface is served from a local JSON file so the app runs on first clone with
zero setup. Both backends are write-through — nothing in the API layer needs to
know which one is active.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import Settings

logger = logging.getLogger("swiftsearch.store")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LocalStore:
    """Small thread-safe JSON document store."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._data: dict[str, Any] = {
            "documents": [],
            "search_history": [],
            "index_runs": [],
            "settings": {},
        }
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                self._data.update(loaded)
            except (json.JSONDecodeError, OSError):
                pass

    def _persist(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")

    def all(self, table: str) -> list[dict]:
        with self._lock:
            return list(self._data.get(table, []))

    def insert(self, table: str, row: dict) -> dict:
        with self._lock:
            self._data.setdefault(table, []).append(row)
            self._persist()
            return row

    def replace(self, table: str, rows: list[dict]) -> None:
        with self._lock:
            self._data[table] = rows
            self._persist()

    def delete_where(self, table: str, key: str, value: Any) -> None:
        with self._lock:
            self._data[table] = [
                r for r in self._data.get(table, []) if r.get(key) != value
            ]
            self._persist()

    def get_settings(self) -> dict:
        with self._lock:
            return dict(self._data.get("settings", {}))

    def save_settings(self, payload: dict) -> None:
        with self._lock:
            self._data["settings"] = payload
            self._persist()


class SupabaseStore:
    """Thin wrapper over supabase-py. Falls back gracefully on any error."""

    TABLES = ("documents", "search_history", "index_runs")

    def __init__(self, settings: Settings) -> None:
        from supabase import create_client  # imported lazily

        self.client = create_client(settings.supabase_url, settings.supabase_service_key)
        self.bucket = settings.supabase_bucket

    def all(self, table: str) -> list[dict]:
        response = self.client.table(table).select("*").execute()
        return response.data or []

    def insert(self, table: str, row: dict) -> dict:
        self.client.table(table).insert(row).execute()
        return row

    def delete_where(self, table: str, key: str, value: Any) -> None:
        self.client.table(table).delete().eq(key, value).execute()

    def upload_file(self, name: str, content: bytes, content_type: str) -> str | None:
        try:
            self.client.storage.from_(self.bucket).upload(
                name, content, {"content-type": content_type, "upsert": "true"}
            )
            return self.client.storage.from_(self.bucket).get_public_url(name)
        except Exception as exc:
            logger.warning(
                "Supabase Storage upload failed for %s (bucket=%s): %s",
                name,
                self.bucket,
                exc,
            )
            return None


class Store:
    """Facade that prefers Supabase and always keeps the local mirror in sync."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.local = LocalStore(settings.data_dir / "store.json")
        self.remote: SupabaseStore | None = None
        self.remote_error: str | None = None
        self.degraded_operations: list[str] = []

        if settings.supabase_enabled:
            try:
                self.remote = SupabaseStore(settings)
                # Touch a table so a misconfigured project fails loudly here
                # rather than on the first user request.
                self.remote.all("documents")
            except Exception as exc:
                self.remote = None
                self.remote_error = str(exc)
                logger.error(
                    "Supabase is configured but unreachable (%s). "
                    "Falling back to local storage at %s.",
                    exc,
                    self.local.path,
                )

    @property
    def using_supabase(self) -> bool:
        return self.remote is not None

    def _degraded(self, operation: str, exc: Exception) -> None:
        """Record a Supabase failure loudly; the local mirror still holds the data.

        Failures are never swallowed silently — the write already succeeded
        locally, so the app stays usable, but the operator sees exactly which
        operation degraded and why.
        """
        self.remote_error = f"{operation}: {exc}"
        self.degraded_operations.append(self.remote_error)
        del self.degraded_operations[:-20]
        logger.warning("Supabase %s failed: %s (kept in local storage)", operation, exc)

    # ------------------------------------------------------------ documents

    def list_documents(self) -> list[dict]:
        if self.remote is not None:
            try:
                rows = self.remote.all("documents")
                if rows:
                    return sorted(rows, key=lambda r: r.get("uploaded_at") or "")
            except Exception as exc:
                self._degraded("list documents", exc)
        return self.local.all("documents")

    def add_document(self, row: dict) -> dict:
        self.local.insert("documents", row)
        if self.remote is not None:
            try:
                self.remote.insert("documents", {k: v for k, v in row.items() if k != "text"})
            except Exception as exc:
                self._degraded(f"insert document {row.get('id')}", exc)
        return row

    def delete_document(self, doc_id: str) -> None:
        self.local.delete_where("documents", "id", doc_id)
        if self.remote is not None:
            try:
                self.remote.delete_where("documents", "id", doc_id)
            except Exception as exc:
                self._degraded(f"delete document {doc_id}", exc)

    def replace_documents(self, rows: list[dict]) -> None:
        self.local.replace("documents", rows)

    def upload_to_storage(self, name: str, content: bytes, content_type: str) -> str | None:
        if self.remote is None:
            return None
        return self.remote.upload_file(name, content, content_type)

    # ------------------------------------------------------- search history

    def add_search(self, row: dict) -> None:
        history = self.local.all("search_history")
        history.append(row)
        self.local.replace("search_history", history[-500:])
        if self.remote is not None:
            try:
                self.remote.insert("search_history", row)
            except Exception as exc:
                self._degraded("record search history", exc)

    def list_searches(self) -> list[dict]:
        return self.local.all("search_history")

    # ----------------------------------------------------------- index runs

    def add_index_run(self, row: dict) -> None:
        runs = self.local.all("index_runs")
        runs.append(row)
        self.local.replace("index_runs", runs[-100:])
        if self.remote is not None:
            try:
                self.remote.insert("index_runs", row)
            except Exception as exc:
                self._degraded("record index run", exc)

    def list_index_runs(self) -> list[dict]:
        return self.local.all("index_runs")

    # ------------------------------------------------------------- settings

    def get_settings(self) -> dict:
        return self.local.get_settings()

    def save_settings(self, payload: dict) -> None:
        self.local.save_settings(payload)
