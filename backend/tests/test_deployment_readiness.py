"""Behaviour that only matters once the app is deployed.

Hosting platforms wipe the container filesystem on every deploy and cold start,
while the corpus lives in Supabase. These tests cover what has to happen when an
instance wakes up with documents but no index, and the guard on the endpoints
that destroy data.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.services.engine import SwiftSearchEngine


async def build_index(engine: SwiftSearchEngine, **kwargs) -> None:
    kwargs.setdefault("block_size", 150)
    kwargs.setdefault("step_delay", 0)
    await engine.start_indexing(**kwargs)
    assert engine._task is not None
    await engine._task


async def wait_for_index(engine: SwiftSearchEngine, timeout: float = 10.0) -> None:
    """Wait for a background rebuild to finish."""
    if engine._task is not None:
        await asyncio.wait_for(engine._task, timeout)


def wipe_index_files(settings) -> None:
    """Simulate a redeploy: the index and blocks are gone, documents are not."""
    index_file = settings.index_dir / "index.json"
    index_file.unlink(missing_ok=True)
    for block in settings.blocks_dir.glob("*.tsv"):
        block.unlink()


# ------------------------------------------------------- startup index recovery


@pytest.mark.asyncio
async def test_index_is_rebuilt_when_the_disk_was_wiped(temp_data_dir):
    builder = SwiftSearchEngine(temp_data_dir)
    builder.bootstrap()
    await build_index(builder)
    expected_terms = builder.index.vocabulary_size
    assert expected_terms > 0

    wipe_index_files(temp_data_dir)

    # A fresh instance: documents survive, the index does not.
    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()
    assert restarted.index is None, "precondition: the index really is gone"
    assert restarted.documents.list_documents(), "documents must survive"

    started = await restarted.recover_index_if_missing()
    assert started is True
    await wait_for_index(restarted)

    assert restarted.index is not None
    assert restarted.index.vocabulary_size == expected_terms


@pytest.mark.asyncio
async def test_search_works_after_recovery(temp_data_dir):
    """The user-visible symptom: search returned 409 after every restart."""
    builder = SwiftSearchEngine(temp_data_dir)
    builder.bootstrap()
    await build_index(builder)
    before = builder.search("machine learning")

    wipe_index_files(temp_data_dir)

    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()
    with pytest.raises(LookupError):
        restarted.search("machine learning")  # what used to happen

    await restarted.recover_index_if_missing()
    await wait_for_index(restarted)

    after = restarted.search("machine learning")
    assert after["total"] == before["total"]
    assert [r["document_id"] for r in after["results"]] == [
        r["document_id"] for r in before["results"]
    ]
    assert [r["score"] for r in after["results"]] == [
        r["score"] for r in before["results"]
    ]


@pytest.mark.asyncio
async def test_recovery_is_skipped_when_an_index_already_exists(temp_data_dir):
    engine = SwiftSearchEngine(temp_data_dir)
    engine.bootstrap()
    await build_index(engine)

    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()
    assert restarted.index is not None
    assert await restarted.recover_index_if_missing() is False


@pytest.mark.asyncio
async def test_recovery_is_skipped_without_documents(temp_data_dir):
    engine = SwiftSearchEngine(temp_data_dir)
    engine.store.replace_documents([])
    assert await engine.recover_index_if_missing() is False


@pytest.mark.asyncio
async def test_recovery_can_be_disabled(temp_data_dir):
    builder = SwiftSearchEngine(temp_data_dir)
    builder.bootstrap()
    await build_index(builder)
    wipe_index_files(temp_data_dir)

    temp_data_dir.auto_rebuild_index = False
    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()
    assert await restarted.recover_index_if_missing() is False
    assert restarted.index is None
    temp_data_dir.auto_rebuild_index = True


@pytest.mark.asyncio
async def test_recovery_uses_no_artificial_pacing(temp_data_dir):
    """Recovery is not a demo — the step delay must not slow a cold start."""
    builder = SwiftSearchEngine(temp_data_dir)
    builder.bootstrap()
    await build_index(builder)
    wipe_index_files(temp_data_dir)

    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()
    restarted.update_settings(dict(restarted.get_settings_payload(), step_delay=2.0))

    await restarted.recover_index_if_missing()
    assert restarted.indexer.step_delay == 0.0
    await wait_for_index(restarted)
    assert restarted.index is not None


@pytest.mark.asyncio
async def test_startup_survives_a_failing_rebuild(temp_data_dir, monkeypatch):
    builder = SwiftSearchEngine(temp_data_dir)
    builder.bootstrap()
    await build_index(builder)
    wipe_index_files(temp_data_dir)

    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()

    async def explode(**_kwargs):
        raise RuntimeError("storage unavailable")

    monkeypatch.setattr(restarted, "start_indexing", explode)
    # Must not raise: a failed rebuild cannot take the whole service down.
    assert await restarted.recover_index_if_missing() is False


def settle(test_client) -> None:
    """Wait out any rebuild the app started on boot.

    Startup recovery means a freshly booted instance may be mid-build, and
    `reset` correctly refuses while indexing is running.
    """
    for _ in range(400):
        if test_client.get("/api/index/status").json()["state"] != "running":
            return
        time.sleep(0.02)
    raise AssertionError("startup rebuild did not finish")


def test_health_reports_recovery_state(client):
    body = client.get("/api/health").json()
    assert "index_ready" in body
    assert body["storage"] in ("supabase", "local")


# --------------------------------------------------------------- admin guard


def test_destructive_endpoints_are_open_when_no_token_is_configured(client):
    """Local development stays frictionless."""
    settle(client)
    assert client.get("/api/health").json()["admin_protected"] is False
    assert client.post("/api/documents/seed").status_code == 200
    assert client.post("/api/index/reset").status_code == 200


@pytest.fixture()
def protected_client(temp_data_dir, monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import create_app

    monkeypatch.setenv("ADMIN_TOKEN", "test-admin-token")
    get_settings.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    get_settings.cache_clear()


def test_health_advertises_protection_without_leaking_the_token(protected_client):
    body = protected_client.get("/api/health").json()
    assert body["admin_protected"] is True
    assert "test-admin-token" not in str(body)


@pytest.mark.parametrize(
    "method,path",
    [
        ("delete", "/api/documents/DOC_001"),
        ("post", "/api/index/reset"),
        ("post", "/api/documents/seed"),
    ],
)
def test_destructive_endpoints_reject_missing_or_wrong_tokens(
    protected_client, method, path
):
    call = getattr(protected_client, method)

    assert call(path).status_code == 401
    assert call(path, headers={"X-Admin-Token": "wrong"}).status_code == 401
    assert call(path, headers={"X-Admin-Token": ""}).status_code == 401


@pytest.mark.parametrize(
    "method,path",
    [("post", "/api/index/reset"), ("post", "/api/documents/seed")],
)
def test_destructive_endpoints_accept_the_correct_token(protected_client, method, path):
    settle(protected_client)
    response = getattr(protected_client, method)(
        path, headers={"X-Admin-Token": "test-admin-token"}
    )
    assert response.status_code == 200


def test_read_endpoints_stay_open_when_protection_is_on(protected_client):
    """Search and browsing must not require a token."""
    for path in ("/api/health", "/api/documents", "/api/analytics", "/api/settings"):
        assert protected_client.get(path).status_code == 200
    assert protected_client.post("/api/index/start", json={"step_delay": 0}).status_code == 200


def test_the_error_explains_how_to_fix_it(protected_client):
    detail = protected_client.post("/api/index/reset").json()["detail"]
    assert "admin token" in detail.lower()
    assert "test-admin-token" not in detail
