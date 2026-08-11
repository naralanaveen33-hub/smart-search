"""Supabase persistence behaviour, exercised against a fake remote.

These tests never touch the network. They pin the parts that are easy to get
wrong and invisible until production: that an empty remote is not mistaken for
a failed one, that `documents.text` is fetched only on demand, and that syncing
indexing state cannot clobber the stored text.
"""

from __future__ import annotations

import pytest

from app.database.store import DOCUMENT_COLUMNS, Store


class FakeRemote:
    """Stands in for SupabaseStore. Records calls; can be told to fail."""

    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "documents": [],
            "search_history": [],
            "index_runs": [],
        }
        self.texts: dict[str, str] = {}
        self.files: dict[str, bytes] = {}
        self.fail: set[str] = set()
        self.selected_columns: list[str] = []
        self.upserts: list[list[dict]] = []

    def _check(self, op: str) -> None:
        if op in self.fail:
            raise RuntimeError(f"simulated {op} failure")

    def all(self, table, *, columns="*", order=None, descending=False, limit=None):
        self._check(f"all:{table}")
        if table == "documents":
            self.selected_columns.append(columns)
        rows = [dict(r) for r in self.tables[table]]
        if order:
            rows.sort(key=lambda r: r.get(order) or "", reverse=descending)
        return rows[:limit] if limit else rows

    def insert(self, table, row):
        self._check(f"insert:{table}")
        self.tables[table].append(dict(row))
        return row

    def upsert(self, table, rows):
        self._check(f"upsert:{table}")
        self.upserts.append([dict(r) for r in rows])
        for row in rows:
            existing = next(
                (r for r in self.tables[table] if r.get("id") == row.get("id")), None
            )
            if existing is None:
                self.tables[table].append(dict(row))
            else:
                # Postgres upsert only writes the columns actually supplied.
                existing.update(row)
            if "text" in row:
                self.texts[row["id"]] = row["text"]

    def delete_where(self, table, key, value):
        self._check(f"delete:{table}")
        self.tables[table] = [r for r in self.tables[table] if r.get(key) != value]
        self.texts.pop(value, None)

    def fetch_text(self, doc_id):
        self._check("fetch_text")
        return self.texts.get(doc_id) or None

    def upload_file(self, name, content, content_type):
        self.files[name] = content
        return f"https://example.test/{name}"

    def remove_file(self, name):
        self._check("remove_file")
        self.files.pop(name, None)


@pytest.fixture()
def store(temp_data_dir):
    """A Store wired to a fake remote, bypassing create_client entirely."""
    store = Store(temp_data_dir)
    assert not store.using_supabase  # conftest guarantees no live credentials
    store.remote = FakeRemote()
    return store


def _doc(doc_id="DOC_001", **overrides):
    row = {
        "id": doc_id,
        "title": "Machine Learning",
        "file_name": f"{doc_id}.txt",
        "size_bytes": 42,
        "status": "ready",
        "source": "upload",
        "uploaded_at": "2026-01-01T00:00:00+00:00",
        "indexed": False,
        "term_count": 0,
        "storage_url": None,
        "preview": "Machine learning is powerful.",
    }
    row.update(overrides)
    return row


# ------------------------------------------------------------------ documents


def test_documents_are_written_to_both_backends(store):
    store.add_document(_doc(), text="machine learning is powerful")

    assert [r["id"] for r in store.remote.tables["documents"]] == ["DOC_001"]
    assert [r["id"] for r in store.local.all("documents")] == ["DOC_001"]


def test_text_is_persisted_remotely_but_not_in_the_local_mirror(store):
    store.add_document(_doc(), text="machine learning is powerful")

    assert store.remote.texts["DOC_001"] == "machine learning is powerful"
    assert "text" not in store.local.all("documents")[0]


def test_list_documents_never_selects_the_text_column(store):
    store.add_document(_doc(), text="a lot of text")
    store.list_documents()

    assert store.remote.selected_columns, "the remote should have been queried"
    for columns in store.remote.selected_columns:
        assert "text" not in columns.split(",")
    assert columns == DOCUMENT_COLUMNS


def test_an_empty_remote_is_not_mistaken_for_a_failure(store):
    """The bug this guards: `if rows:` silently falling back to stale local data."""
    store.local.insert("documents", _doc("DOC_STALE"))

    assert store.list_documents() == []


def test_a_failing_remote_falls_back_to_local_and_is_recorded(store):
    store.local.insert("documents", _doc("DOC_LOCAL"))
    store.remote.fail.add("all:documents")

    assert [r["id"] for r in store.list_documents()] == ["DOC_LOCAL"]
    assert store.remote_error is not None
    assert "list documents" in store.degraded_operations[-1]


def test_indexed_state_and_term_count_reach_supabase(store):
    store.add_document(_doc(), text="body text")

    rows = store.list_documents()
    rows[0]["indexed"] = True
    rows[0]["term_count"] = 17
    store.replace_documents(rows)

    remote_row = store.remote.tables["documents"][0]
    assert remote_row["indexed"] is True
    assert remote_row["term_count"] == 17


def test_syncing_index_state_does_not_clobber_stored_text(store):
    store.add_document(_doc(), text="the original extracted text")

    rows = store.list_documents()  # no `text` key — excluded by DOCUMENT_COLUMNS
    rows[0]["indexed"] = True
    store.replace_documents(rows)

    assert store.remote.texts["DOC_001"] == "the original extracted text"
    assert all("text" not in payload[0] for payload in store.remote.upserts[1:])


def test_fetch_document_text_returns_none_when_absent(store):
    store.add_document(_doc(), text="hello")

    assert store.fetch_document_text("DOC_001") == "hello"
    assert store.fetch_document_text("DOC_404") is None


def test_fetch_document_text_survives_a_remote_failure(store):
    store.add_document(_doc(), text="hello")
    store.remote.fail.add("fetch_text")

    assert store.fetch_document_text("DOC_001") is None
    assert "fetch text" in store.degraded_operations[-1]


def test_deleting_a_document_removes_the_stored_file(store):
    store.upload_to_storage("DOC_001/DOC_001.txt", b"raw bytes", "text/plain")
    store.add_document(_doc(), text="hello")
    assert "DOC_001/DOC_001.txt" in store.remote.files

    store.delete_document("DOC_001", file_name="DOC_001.txt")

    assert store.remote.tables["documents"] == []
    assert store.remote.files == {}


# ------------------------------------------------------- history and runs


def test_search_history_is_read_from_supabase(store):
    store.add_search({"query": "remote", "mode": "all", "results": 1,
                      "took_seconds": 0.01, "created_at": "2026-01-02T00:00:00+00:00"})
    store.local.replace("search_history", [{"query": "stale-local"}])

    assert [r["query"] for r in store.list_searches()] == ["remote"]


def test_search_history_falls_back_to_local_when_remote_fails(store):
    store.local.replace("search_history", [{"query": "local"}])
    store.remote.fail.add("all:search_history")

    assert [r["query"] for r in store.list_searches()] == ["local"]


def test_index_runs_are_written_and_read_remotely(store):
    store.add_index_run({"created_at": "2026-01-03T00:00:00+00:00", "documents": 6,
                         "unique_terms": 350, "blocks": 3})
    store.local.replace("index_runs", [{"created_at": "1999", "documents": 0}])

    runs = store.list_index_runs()
    assert len(runs) == 1 and runs[0]["unique_terms"] == 350


def test_history_is_returned_oldest_first(store):
    for day in ("03", "01", "02"):
        store.add_search({"query": day, "mode": "all", "results": 0,
                          "took_seconds": 0.0, "created_at": f"2026-01-{day}T00:00:00+00:00"})

    assert [r["query"] for r in store.list_searches()] == ["01", "02", "03"]


# ------------------------------------------------------------------ status


def test_status_reports_the_live_backend(store):
    assert store.status() == {
        "supabase": True,
        "storage": "supabase",
        "supabase_error": None,
    }


def test_status_reports_local_when_supabase_is_absent(temp_data_dir):
    local_only = Store(temp_data_dir)

    assert local_only.status()["supabase"] is False
    assert local_only.status()["storage"] == "local"
