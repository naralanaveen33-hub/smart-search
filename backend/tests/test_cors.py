"""CORS configuration.

A deployed frontend missing from the allow-list is invisible server-side: every
endpoint returns 200, but the browser discards the response for lack of an
Access-Control-Allow-Origin header, and the UI reports an unreachable backend.
These tests pin the behaviour that makes that correct and diagnosable.
"""

from __future__ import annotations

import pytest

VERCEL = "https://smart-search-five-umber.vercel.app"


@pytest.fixture()
def cors_client(temp_data_dir, monkeypatch):
    """An app whose allow-list is exactly the deployed frontend."""
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import create_app

    monkeypatch.setenv("CORS_ORIGINS", VERCEL)
    get_settings.cache_clear()
    with TestClient(create_app()) as client:
        yield client
    get_settings.cache_clear()


def test_allowed_origin_gets_the_header(cors_client):
    response = cors_client.get("/api/documents", headers={"Origin": VERCEL})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == VERCEL


def test_preflight_succeeds_for_an_allowed_origin(cors_client):
    response = cors_client.options(
        "/api/documents",
        headers={
            "Origin": VERCEL,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == VERCEL


def test_unknown_origin_is_refused(cors_client):
    """The exact production symptom: 200 body, but no allow-origin header."""
    response = cors_client.get("/api/documents", headers={"Origin": "https://evil.example.com"})
    assert "access-control-allow-origin" not in response.headers


def test_admin_header_is_permitted_in_preflight(cors_client):
    response = cors_client.options(
        "/api/index/reset",
        headers={
            "Origin": VERCEL,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-admin-token",
        },
    )
    assert response.status_code == 200
    assert "x-admin-token" in response.headers.get("access-control-allow-headers", "").lower()


def test_sse_endpoint_is_cors_enabled(cors_client):
    """Live indexing uses EventSource, which is subject to CORS too.

    Asserted with a preflight rather than a GET: /api/index/events is an
    endless event stream, so TestClient would block forever waiting for a
    response body that never completes. The preflight travels through the same
    CORSMiddleware, which is what this pins — that the SSE route is not
    somehow bypassing it.
    """
    response = cors_client.options(
        "/api/index/events",
        headers={
            "Origin": VERCEL,
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == VERCEL


# ------------------------------------------------------------------ parsing


def test_trailing_slashes_are_stripped(temp_data_dir, monkeypatch):
    """A browser Origin never has a trailing slash, so neither may the config."""
    from app.config import get_settings

    monkeypatch.setenv("CORS_ORIGINS", "https://a.vercel.app/, https://b.vercel.app")
    get_settings.cache_clear()
    assert get_settings().cors_origin_list == ["https://a.vercel.app", "https://b.vercel.app"]
    get_settings.cache_clear()


def test_localhost_is_always_permitted(temp_data_dir, monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("CORS_ORIGINS", VERCEL)
    monkeypatch.setenv("CORS_ORIGIN_REGEX", "")
    get_settings.cache_clear()
    import re

    pattern = re.compile(get_settings().cors_allow_origin_regex)
    assert pattern.fullmatch("http://localhost:5173")
    assert pattern.fullmatch("http://127.0.0.1:8000")
    get_settings.cache_clear()


def test_origin_regex_extends_the_allow_list(temp_data_dir, monkeypatch):
    """Vercel preview deployments get a new hostname per build."""
    import re

    from app.config import get_settings

    monkeypatch.setenv("CORS_ORIGINS", VERCEL)
    monkeypatch.setenv("CORS_ORIGIN_REGEX", r"https://smart-search-[a-z0-9-]+\.vercel\.app")
    get_settings.cache_clear()
    pattern = re.compile(get_settings().cors_allow_origin_regex)

    assert pattern.fullmatch("https://smart-search-abc123-team.vercel.app")
    assert pattern.fullmatch("http://localhost:5173"), "localhost must still work"
    assert not pattern.fullmatch("https://unrelated.vercel.app")
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_preview_origin_is_accepted_when_the_regex_allows_it(temp_data_dir, monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import create_app

    monkeypatch.setenv("CORS_ORIGINS", VERCEL)
    monkeypatch.setenv("CORS_ORIGIN_REGEX", r"https://smart-search-[a-z0-9-]+\.vercel\.app")
    get_settings.cache_clear()
    preview = "https://smart-search-otklvssbx-naralanaveen33-hubs-projects.vercel.app"
    with TestClient(create_app()) as client:
        response = client.get("/api/health", headers={"Origin": preview})
        assert response.headers.get("access-control-allow-origin") == preview
    get_settings.cache_clear()
