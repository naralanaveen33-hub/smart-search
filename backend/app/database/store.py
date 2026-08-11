"""Persistence for documents, search history and index metadata.

Supabase PostgreSQL is used when credentials are configured; otherwise the same
interface is served from a local JSON file so the app runs on first clone with
zero setup. Both backends are write-through — nothing in the API layer needs to
know which one is active.

Supabase is *persistence only*. Retrieval and ranking stay entirely inside the
BSBI pipeline and the BM25 ranker; nothing here ever queries Postgres for search.

Document text
-------------
`documents.text` holds the extracted plain text the BSBI indexer reads. It is
deliberately excluded from `DOCUMENT_COLUMNS`, so list and analytics queries
never drag the whole corpus over the wire. Fetch it explicitly with
`fetch_document_text()` — used only for indexing, preview and text retrieval.
Original uploaded files live in Storage and are never re-parsed on read.
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

# Every documents column except `text`. Selecting these keeps list/analytics
# queries lightweight no matter how large the corpus grows.
DOCUMENT_COLUMNS = (
    "id,title,file_name,size_bytes,status,source,"
    "uploaded_at,indexed,term_count,storage_url,preview"
)

# Upper bounds on remote history reads. Both exceed the local mirror's own caps
# (500 searches / 100 runs), so switching to Supabase never loses history.
SEARCH_HISTORY_LIMIT = 2000
INDEX_RUN_LIMIT = 200

# Distinguishes "the remote call failed" from "the remote legitimately returned
# nothing". Without it an empty table silently reads as a fallback to local.
_FAILED = object()


class StorageUploadError(RuntimeError):
    """The original file could not be written to Supabase Storage.

    Propagated to the API layer so the response carries the real Storage error
    instead of a success the file never had.
    """


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
    """Thin wrapper over supabase-py. Errors propagate; `Store` decides policy."""

    TABLES = ("documents", "search_history", "index_runs")

    def __init__(self, settings: Settings) -> None:
        from supabase import create_client  # imported lazily

        self.client = create_client(settings.supabase_url, settings.supabase_service_key)
        self.bucket = settings.supabase_bucket

    def all(
        self,
        table: str,
        *,
        columns: str = "*",
        order: str | None = None,
        descending: bool = False,
        limit: int | None = None,
    ) -> list[dict]:
        query = self.client.table(table).select(columns)
        if order:
            query = query.order(order, desc=descending)
        if limit:
            query = query.limit(limit)
        return query.execute().data or []

    def insert(self, table: str, row: dict) -> dict:
        self.client.table(table).insert(row).execute()
        return row

    def upsert(self, table: str, rows: list[dict]) -> None:
        """Insert-or-update by primary key.

        Only the columns present in `rows` are written, so omitting `text` here
        leaves an existing document's extracted text untouched.
        """
        if rows:
            self.client.table(table).upsert(rows).execute()

    def delete_where(self, table: str, key: str, value: Any) -> None:
        self.client.table(table).delete().eq(key, value).execute()

    def fetch_text(self, doc_id: str) -> str | None:
        rows = (
            self.client.table("documents")
            .select("text")
            .eq("id", doc_id)
            .limit(1)
            .execute()
            .data
        )
        if not rows:
            return None
        return rows[0].get("text") or None

    def upload_file(self, name: str, content: bytes, content_type: str) -> str:
        """Write the original file to Storage.

        Raises `StorageUploadError` on failure rather than returning None: a
        document whose source file never reached Storage must not be reported
        to the caller as a successful upload.
        """
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
            raise StorageUploadError(
                f"Supabase Storage upload failed for {name} "
                f"(bucket={self.bucket}): {exc}"
            ) from exc

    def remove_file(self, name: str) -> None:
        self.client.storage.from_(self.bucket).remove([name])


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
                self.remote.all("documents", columns="id", limit=1)
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

    def status(self) -> dict:
        """Non-secret diagnostics for /api/health."""
        return {
            "supabase": self.using_supabase,
            "storage": "supabase" if self.using_supabase else "local",
            "supabase_error": self.remote_error,
        }

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

    def _try_remote(self, operation: str, call):
        """Run a remote call, returning `_FAILED` (not a default) on error."""
        try:
            return call()
        except Exception as exc:
            self._degraded(operation, exc)
            return _FAILED

    @staticmethod
    def _document_row(row: dict) -> dict:
        """Project a row onto the remote documents columns, dropping `text`."""
        allowed = set(DOCUMENT_COLUMNS.split(","))
        return {k: v for k, v in row.items() if k in allowed}

    # ------------------------------------------------------------ documents

    def list_documents(self) -> list[dict]:
        if self.remote is not None:
            rows = self._try_remote(
                "list documents",
                lambda: self.remote.all(
                    "documents", columns=DOCUMENT_COLUMNS, order="uploaded_at"
                ),
            )
            # An empty table is a real answer — only a failure falls back.
            if rows is not _FAILED:
                return sorted(rows, key=lambda r: r.get("uploaded_at") or "")
        return self.local.all("documents")

    def add_document(self, row: dict, *, text: str = "") -> dict:
        self.local.insert("documents", row)
        if self.remote is not None:
            payload = self._document_row(row)
            payload["text"] = text
            self._try_remote(
                f"insert document {row.get('id')}",
                lambda: self.remote.upsert("documents", [payload]),
            )
        return row

    def delete_document(self, doc_id: str, *, file_name: str | None = None) -> None:
        self.local.delete_where("documents", "id", doc_id)
        if self.remote is not None:
            self._try_remote(
                f"delete document {doc_id}",
                lambda: self.remote.delete_where("documents", "id", doc_id),
            )
            if file_name:
                self._try_remote(
                    f"delete stored file for {doc_id}",
                    lambda: self.remote.remove_file(f"{doc_id}/{file_name}"),
                )

    def replace_documents(self, rows: list[dict]) -> None:
        """Write the full document list back — this is the `indexed`/`term_count` path.

        The remote payload omits `text`, so an upsert refreshes indexing state
        without touching the extracted text already stored for each document.
        """
        self.local.replace("documents", rows)
        if self.remote is not None and rows:
            payload = [self._document_row(r) for r in rows if r.get("id")]
            self._try_remote(
                "sync document index state",
                lambda: self.remote.upsert("documents", payload),
            )

    def fetch_document_text(self, doc_id: str) -> str | None:
        """Extracted text for one document. Remote only; `None` when unavailable."""
        if self.remote is None:
            return None
        text = self._try_remote(
            f"fetch text for {doc_id}", lambda: self.remote.fetch_text(doc_id)
        )
        return None if text is _FAILED else text

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
            self._try_remote(
                "record search history",
                lambda: self.remote.insert("search_history", row),
            )

    def list_searches(self) -> list[dict]:
        if self.remote is not None:
            rows = self._try_remote(
                "list search history",
                lambda: self.remote.all(
                    "search_history",
                    order="created_at",
                    descending=True,
                    limit=SEARCH_HISTORY_LIMIT,
                ),
            )
            if rows is not _FAILED:
                # Callers expect oldest-first, matching the local mirror.
                return sorted(rows, key=lambda r: r.get("created_at") or "")
        return self.local.all("search_history")

    # ----------------------------------------------------------- index runs

    def add_index_run(self, row: dict) -> None:
        runs = self.local.all("index_runs")
        runs.append(row)
        self.local.replace("index_runs", runs[-100:])
        if self.remote is not None:
            self._try_remote(
                "record index run", lambda: self.remote.insert("index_runs", row)
            )

    def list_index_runs(self) -> list[dict]:
        if self.remote is not None:
            rows = self._try_remote(
                "list index runs",
                lambda: self.remote.all(
                    "index_runs",
                    order="created_at",
                    descending=True,
                    limit=INDEX_RUN_LIMIT,
                ),
            )
            if rows is not _FAILED:
                return sorted(rows, key=lambda r: r.get("created_at") or "")
        return self.local.all("index_runs")

    # ------------------------------------------------------------- settings
    # Runtime settings stay local by design: they describe this installation
    # (block size, pacing), not shared corpus state.

    def get_settings(self) -> dict:
        return self.local.get_settings()

    def save_settings(self, payload: dict) -> None:
        self.local.save_settings(payload)
