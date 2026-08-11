from __future__ import annotations

import os
import shutil
import tempfile
import time
from pathlib import Path

import pytest


@pytest.fixture()
def temp_data_dir(monkeypatch: pytest.MonkeyPatch):
    """Isolate every test from the developer's real .data directory.

    Supabase credentials are cleared too. Without this the suite reads the
    repo's .env and every Store() built during a test talks to the real
    project — writing demo documents, search history and index runs into live
    data on every run. Supabase behaviour is covered separately in
    test_supabase_store.py using a fake remote, so nothing is lost.
    """
    directory = Path(tempfile.mkdtemp(prefix="swiftsearch-test-"))
    monkeypatch.setenv("SWIFTSEARCH_DATA_DIR", str(directory))
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "")
    # Pin every environment-driven default the suite depends on. A developer
    # .env pointing at a real project sets SEED_DEMO_DOCUMENTS=false, which
    # would otherwise leave the corpus empty and fail ~26 tests for reasons
    # that have nothing to do with the code under test.
    monkeypatch.setenv("SEED_DEMO_DOCUMENTS", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    settings = get_settings()
    assert not settings.supabase_enabled, "tests must never touch a live Supabase project"
    assert settings.seed_demo_documents, "tests rely on the bundled demo corpus"
    yield settings
    get_settings.cache_clear()
    shutil.rmtree(directory, ignore_errors=True)


@pytest.fixture()
def client(temp_data_dir):
    """A started app, settled.

    Startup recovery rebuilds the index whenever documents exist without one,
    which is true of every fresh test data directory. A real deployment settles
    within seconds; tests wait for the same thing so they act on a steady state
    rather than racing the rebuild.
    """
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as test_client:
        for _ in range(500):
            if test_client.get("/api/index/status").json()["state"] != "running":
                break
            time.sleep(0.02)
        else:
            raise AssertionError("startup index rebuild did not finish")
        yield test_client


@pytest.fixture()
def sample_documents():
    from app.bsbi.indexer import IndexDocument

    return [
        IndexDocument("DOC_001", "Machine Learning", "Machine learning is powerful. Machine learning models learn."),
        IndexDocument("DOC_002", "Algorithms", "Machine learning algorithms are useful for retrieval."),
        IndexDocument("DOC_003", "Inverted Index", "An inverted index maps terms to documents making search fast."),
    ]
