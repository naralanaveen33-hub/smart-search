from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest


@pytest.fixture()
def temp_data_dir(monkeypatch: pytest.MonkeyPatch):
    """Isolate every test from the developer's real .data directory."""
    directory = Path(tempfile.mkdtemp(prefix="swiftsearch-test-"))
    monkeypatch.setenv("SWIFTSEARCH_DATA_DIR", str(directory))
    from app.config import get_settings

    get_settings.cache_clear()
    settings = get_settings()
    yield settings
    get_settings.cache_clear()
    shutil.rmtree(directory, ignore_errors=True)


@pytest.fixture()
def client(temp_data_dir):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture()
def sample_documents():
    from app.bsbi.indexer import IndexDocument

    return [
        IndexDocument("DOC_001", "Machine Learning", "Machine learning is powerful. Machine learning models learn."),
        IndexDocument("DOC_002", "Algorithms", "Machine learning algorithms are useful for retrieval."),
        IndexDocument("DOC_003", "Inverted Index", "An inverted index maps terms to documents making search fast."),
    ]
