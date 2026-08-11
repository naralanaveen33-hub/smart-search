import time

import pytest


def build_index(client, **payload):
    payload.setdefault("block_size", 200)
    payload.setdefault("step_delay", 0)
    response = client.post("/api/index/start", json=payload)
    assert response.status_code == 200, response.text
    for _ in range(400):
        status = client.get("/api/index/status").json()
        if status["state"] in ("completed", "error"):
            return status
        time.sleep(0.02)
    raise AssertionError("indexing did not finish in time")


def test_health_reports_seeded_demo_corpus(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["documents"] >= 5


def test_documents_are_listed_with_metadata(client):
    body = client.get("/api/documents").json()
    assert body["total"] == len(body["documents"])
    first = body["documents"][0]
    assert first["id"].startswith("DOC_")
    assert first["file_name"].endswith(".txt")
    assert first["preview"]


def test_upload_accepts_text_and_rejects_unsupported_types(client):
    response = client.post(
        "/api/documents/upload",
        files=[("files", ("notes.txt", b"Blocked sort based indexing notes.", "text/plain"))],
    )
    assert response.status_code == 200
    assert response.json()["uploaded"][0]["title"]

    rejected = client.post(
        "/api/documents/upload",
        files=[("files", ("image.png", b"\x89PNG", "image/png"))],
    )
    assert rejected.status_code == 400


def test_indexing_completes_and_reports_real_statistics(client):
    status = build_index(client)
    assert status["state"] == "completed"
    assert [s["status"] for s in status["stages"]] == ["completed"] * 6
    assert status["stats"]["blocks_created"] >= 1
    assert status["stats"]["unique_terms"] > 50
    assert status["stats"]["tokens_generated"] > 100


def test_starting_twice_conflicts(client):
    client.post("/api/index/start", json={"block_size": 100, "step_delay": 0.3})
    second = client.post("/api/index/start", json={"block_size": 100})
    assert second.status_code == 409


def test_blocks_are_inspectable(client):
    build_index(client, block_size=150)
    blocks = client.get("/api/index/blocks").json()["blocks"]
    assert blocks
    detail = client.get(f"/api/index/block/{blocks[0]['id']}").json()
    terms = [entry["term"] for entry in detail["entries"]]
    assert terms == sorted(terms)
    assert client.get("/api/index/block/9999").status_code == 404


def test_search_returns_ranked_results(client):
    build_index(client)
    body = client.post("/api/search", json={"query": "machine learning"}).json()
    assert body["total"] >= 1
    assert body["normalized_terms"]
    scores = [r["score"] for r in body["results"]]
    assert scores == sorted(scores, reverse=True)
    top = body["results"][0]
    assert top["relevance"] == 100
    assert top["snippet"]
    assert top["term_details"]
    assert len(top["signals"]) == 4


def test_search_before_indexing_is_a_conflict(client):
    client.post("/api/index/reset")
    assert client.post("/api/search", json={"query": "machine"}).status_code == 409


def test_search_modes_change_the_result_set(client):
    build_index(client)
    any_mode = client.post("/api/search", json={"query": "machine learning", "mode": "or"}).json()
    strict = client.post("/api/search", json={"query": "machine learning", "mode": "and"}).json()
    assert any_mode["total"] >= strict["total"]


def test_term_lookup_exposes_the_postings_list(client):
    build_index(client)
    body = client.get("/api/index/term/machine").json()
    assert body["found"] is True
    assert body["document_frequency"] == len(body["postings"])
    assert body["postings"][0]["positions"]
    assert body["idf"] > 0

    missing = client.get("/api/index/term/zzzznotaterm").json()
    assert missing["found"] is False


def test_vocabulary_supports_prefix_lookup(client):
    build_index(client)
    body = client.get("/api/index/vocabulary", params={"prefix": "in", "limit": 5}).json()
    assert all(t["term"].startswith("in") for t in body["terms"])
    assert len(body["terms"]) <= 5


def test_search_history_and_popular_queries(client):
    build_index(client)
    client.post("/api/search", json={"query": "inverted index"})
    body = client.get("/api/search/history").json()
    assert body["history"][0]["query"] == "inverted index"
    assert len(body["popular"]) == 6


def test_analytics_reflects_indexing_and_searching(client):
    build_index(client)
    client.post("/api/search", json={"query": "bm25"})
    body = client.get("/api/analytics").json()
    assert body["documents"] >= 5
    assert body["unique_terms"] > 0
    assert body["searches"] >= 1
    assert len(body["documents_over_time"]) == 14
    assert body["top_terms"]


def test_settings_round_trip(client):
    original = client.get("/api/settings").json()
    updated = dict(original, block_size=1234, use_stemming=False, results_per_page=25)
    response = client.put("/api/settings", json=updated)
    assert response.status_code == 200
    assert response.json()["block_size"] == 1234
    assert client.get("/api/settings").json()["use_stemming"] is False


def test_settings_reject_invalid_values(client):
    original = client.get("/api/settings").json()
    assert client.put("/api/settings", json=dict(original, block_size=1)).status_code == 422


def test_explain_pipeline_uses_the_real_tokenizer(client):
    steps = client.get("/api/index/explain").json()["steps"]
    assert [s["key"] for s in steps] == [
        "documents", "tokenization", "block_creation",
        "sorting", "merging", "inverted_index",
    ]
    tokenization = steps[1]["data"]["documents"][0]
    assert "is" in tokenization["removed"]
    assert tokenization["kept"]
    assert steps[4]["data"]["merged"] == sorted(steps[4]["data"]["merged"])


def test_sorting_demo_is_a_permutation_of_distinct_terms(client):
    """The sort animation reorders one list, so both sides must match exactly."""
    sorting = client.get("/api/index/explain").json()["steps"][3]["data"]
    assert len(set(sorting["unsorted"])) == len(sorting["unsorted"])
    assert sorted(sorting["unsorted"]) == sorting["sorted"]


def test_reset_clears_the_index(client):
    build_index(client)
    body = client.post("/api/index/reset").json()
    assert body["state"] == "idle"
    assert client.get("/api/health").json()["index_ready"] is False


@pytest.mark.parametrize("query", ["", " " * 3])
def test_blank_queries_are_rejected(client, query):
    response = client.post("/api/search", json={"query": query})
    assert response.status_code in (409, 422)
