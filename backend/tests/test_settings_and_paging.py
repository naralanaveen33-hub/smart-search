"""Settings must actually change behaviour, and paging must be server-side."""

from __future__ import annotations

import time

import pytest

from app.services.engine import BYTES_PER_POSTING, SwiftSearchEngine


def build_index(client, **payload):
    payload.setdefault("block_size", 200)
    payload.setdefault("step_delay", 0)
    assert client.post("/api/index/start", json=payload).status_code == 200
    for _ in range(400):
        status = client.get("/api/index/status").json()
        if status["state"] in ("completed", "error"):
            return status
        time.sleep(0.02)
    raise AssertionError("indexing did not finish in time")


# ------------------------------------------------------------------- paging


def test_pagination_is_served_by_the_backend(client):
    build_index(client)
    first = client.post(
        "/api/search", json={"query": "index search", "mode": "or", "limit": 2, "offset": 0}
    ).json()

    assert len(first["results"]) <= 2
    assert first["limit"] == 2
    assert first["offset"] == 0
    assert first["total"] >= len(first["results"])
    if first["total"] > 2:
        assert first["has_more"] is True


def test_pages_do_not_overlap_and_cover_every_result(client):
    build_index(client)
    query = {"query": "index search learning", "mode": "or"}
    everything = client.post("/api/search", json={**query, "limit": 100}).json()
    total = everything["total"]
    assert total >= 3, "need several results for paging to be meaningful"

    collected = []
    for offset in range(0, total, 2):
        page = client.post("/api/search", json={**query, "limit": 2, "offset": offset}).json()
        collected.extend(r["document_id"] for r in page["results"])

    assert collected == [r["document_id"] for r in everything["results"]]
    assert len(collected) == len(set(collected)), "pages must not repeat documents"


def test_ranking_order_is_stable_across_pages(client):
    build_index(client)
    query = {"query": "index search learning", "mode": "or"}
    everything = client.post("/api/search", json={**query, "limit": 100}).json()

    second_page = client.post("/api/search", json={**query, "limit": 1, "offset": 1}).json()
    assert second_page["results"][0]["document_id"] == everything["results"][1]["document_id"]
    assert second_page["results"][0]["score"] == everything["results"][1]["score"]
    # Relevance is relative to the top result overall, not to the page.
    assert second_page["results"][0]["relevance"] == everything["results"][1]["relevance"]


def test_last_page_reports_no_more_results(client):
    build_index(client)
    query = {"query": "index search learning", "mode": "or"}
    total = client.post("/api/search", json={**query, "limit": 100}).json()["total"]
    last = client.post(
        "/api/search", json={**query, "limit": 100, "offset": max(0, total - 1)}
    ).json()
    assert last["has_more"] is False


def test_paging_does_not_inflate_search_history(client):
    build_index(client)
    before = len(client.get("/api/search/history").json()["history"])

    query = {"query": "paging probe machine", "mode": "or"}
    client.post("/api/search", json={**query, "limit": 1, "offset": 0})
    client.post("/api/search", json={**query, "limit": 1, "offset": 1})
    client.post("/api/search", json={**query, "limit": 1, "offset": 2})

    after = client.get("/api/search/history").json()["history"]
    assert len(after) == before + 1, "only the first page counts as a search"


# ----------------------------------------------------------------- settings


def test_results_per_page_is_the_default_page_size(client):
    build_index(client)
    settings = client.get("/api/settings").json()
    assert client.put("/api/settings", json=dict(settings, results_per_page=5)).status_code == 200

    body = client.post("/api/search", json={"query": "index search learning", "mode": "or"}).json()
    assert body["limit"] == 5, "an unspecified page size must use the setting"
    assert len(body["results"]) <= 5

    # An explicit limit still wins over the setting.
    explicit = client.post(
        "/api/search", json={"query": "index search learning", "mode": "or", "limit": 1}
    ).json()
    assert explicit["limit"] == 1
    assert len(explicit["results"]) == 1


def test_case_sensitive_setting_changes_the_vocabulary(temp_data_dir):
    engine = SwiftSearchEngine(temp_data_dir)
    engine.update_settings(dict(engine.get_settings_payload(), case_sensitive=False))
    insensitive = {t.term for t in engine.tokenizer().tokenize("Machine machine MACHINE")}
    assert insensitive == {"machin"}

    engine.update_settings(dict(engine.get_settings_payload(), case_sensitive=True))
    sensitive = {t.term for t in engine.tokenizer().tokenize("Machine machine MACHINE")}
    assert len(sensitive) > 1, "case-sensitive mode must keep the variants distinct"


@pytest.mark.asyncio
async def test_case_sensitive_index_distinguishes_capitalised_terms(temp_data_dir):
    engine = SwiftSearchEngine(temp_data_dir)
    engine.bootstrap()
    engine.update_settings(
        dict(engine.get_settings_payload(), case_sensitive=True, use_stemming=False)
    )
    await engine.start_indexing(block_size=500, step_delay=0)
    await engine._task

    terms = set(engine.index.postings)
    assert "Machine" in terms or "Learning" in terms, (
        "capitalised surface forms must survive into the index"
    )


def test_max_memory_caps_the_block_size(temp_data_dir):
    engine = SwiftSearchEngine(temp_data_dir)
    engine.update_settings(
        dict(engine.get_settings_payload(), block_size=10_000_000, max_memory_mb=16)
    )
    budget = engine.memory_budget()

    assert budget["capped"] is True
    assert budget["effective_block_size"] == 16 * 1024 * 1024 // BYTES_PER_POSTING
    assert engine.effective_block_size() < 10_000_000
    assert engine.indexer.block_size == engine.effective_block_size()


def test_generous_memory_leaves_block_size_untouched(temp_data_dir):
    engine = SwiftSearchEngine(temp_data_dir)
    engine.update_settings(
        dict(engine.get_settings_payload(), block_size=1000, max_memory_mb=512)
    )
    budget = engine.memory_budget()
    assert budget["capped"] is False
    assert budget["effective_block_size"] == 1000


@pytest.mark.asyncio
async def test_memory_cap_actually_produces_more_blocks(temp_data_dir):
    """The budget is a real constraint on the pipeline, not a label.

    A corpus large enough to exceed a 1 MB posting budget must be split into
    several blocks even when the requested block size is enormous.
    """
    engine = SwiftSearchEngine(temp_data_dir)
    engine.bootstrap()

    # ~24k postings, comfortably above the 1 MB budget (~8.7k postings).
    for i in range(30):
        body = " ".join(f"term{(i * 800 + w) % 5000}" for w in range(800))
        engine.documents.add_document(f"bulk_{i}.txt", body.encode(), source="upload")

    engine.update_settings(
        dict(engine.get_settings_payload(), block_size=1_000_000, max_memory_mb=8192)
    )
    await engine.start_indexing(step_delay=0)
    await engine._task
    unconstrained = len(engine.indexer.store.blocks)
    total_postings = engine.index.total_postings

    engine.update_settings(
        dict(engine.get_settings_payload(), block_size=1_000_000, max_memory_mb=1)
    )
    await engine.start_indexing(step_delay=0)
    await engine._task
    constrained = len(engine.indexer.store.blocks)

    assert total_postings > BYTES_PER_POSTING_BUDGET_1MB, "corpus must exceed a 1 MB budget"
    assert unconstrained == 1, "a huge budget must leave the block size alone"
    assert constrained > unconstrained, "a small budget must force more blocks"
    assert engine.indexer.block_size == BYTES_PER_POSTING_BUDGET_1MB


BYTES_PER_POSTING_BUDGET_1MB = 1 * 1024 * 1024 // BYTES_PER_POSTING


def test_settings_expose_the_memory_budget(client):
    body = client.get("/api/settings/memory").json()
    assert body["bytes_per_posting"] == BYTES_PER_POSTING
    assert body["effective_block_size"] >= 1
    assert "capped" in body


def test_language_reports_english_only(client):
    body = client.get("/api/settings").json()
    assert body["language"] == "english"
    options = client.get("/api/settings/languages").json()
    assert options["supported"] == ["english"]
