"""Application configuration, loaded from environment variables."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent


def _default_env_file() -> str:
    """Prefer backend/.env, fall back to the repo-root .env."""
    local = BACKEND_ROOT / ".env"
    if local.exists():
        return str(local)
    return str(PROJECT_ROOT / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_default_env_file(), env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "SwiftSearch API"
    api_prefix: str = "/api"

    # Browser origins allowed to call this API. A deployed frontend MUST be
    # listed here or the browser discards every response, which surfaces in the
    # UI as an unreachable backend even though the API is healthy.
    #
    # The deployed frontend is in the default so a fresh deploy works before
    # anyone touches the dashboard. CORS_ORIGINS overrides this entirely, so a
    # deployment that sets it must include its own frontend URL.
    cors_origins: str = (
        "https://smart-search-five-umber.vercel.app,"
        "http://localhost:5173,http://127.0.0.1:5173"
    )

    # Pattern for origins that cannot be enumerated ahead of time — chiefly
    # Vercel preview deployments, which get a fresh hostname per build.
    #
    # This is deliberately narrow: it matches only this project's own Vercel
    # hostnames, not *.vercel.app, so an unrelated site cannot read this API
    # from a visitor's browser. It is applied *in addition to* cors_origins
    # (Starlette checks allow_origins and allow_origin_regex independently),
    # which means the deployed frontend keeps working even if CORS_ORIGINS is
    # set to a wrong value in the dashboard.
    cors_origin_regex: str = r"https://smart-search-[a-z0-9-]+\.vercel\.app"

    # Supabase (optional — the app falls back to local JSON storage when unset).
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_bucket: str = "swiftsearch-documents"

    # Load the bundled demo corpus on first start when the store is empty.
    # Set SEED_DEMO_DOCUMENTS=false against a real project — otherwise the first
    # boot writes six demo documents straight into production persistence.
    seed_demo_documents: bool = True

    # The inverted index lives on local disk, which is ephemeral on most hosting
    # platforms. Document text survives in Supabase, so when a fresh instance
    # finds documents but no index it rebuilds one in the background instead of
    # serving 409s until somebody clicks "Build Index".
    auto_rebuild_index: bool = True

    # Shared secret for the destructive endpoints (document delete, index reset,
    # demo seed). Empty means unprotected, which is fine locally — set it for any
    # deployment reachable from the internet.
    admin_token: str = ""

    # BSBI defaults. block_size is the number of (term, doc) postings held in
    # memory before a block is flushed to disk.
    #
    # 250 is deliberately small: the bundled demo corpus produces ~700 postings,
    # so a small block forces several real flush/sort/merge cycles and the
    # algorithm is actually observable. Raise it in Settings for real corpora —
    # the resulting index is identical either way, only the block count changes.
    block_size: int = 250
    max_memory_mb: int = 512
    language: str = "english"
    use_stop_words: bool = True
    use_stemming: bool = True

    # BM25
    bm25_k1: float = 1.2
    bm25_b: float = 0.75

    # Artificial pacing (seconds) so the indexing pipeline is observable in the
    # UI. Set to 0 for maximum throughput.
    index_step_delay: float = 0.12

    @property
    def data_dir(self) -> Path:
        return Path(os.environ.get("SWIFTSEARCH_DATA_DIR", BACKEND_ROOT / ".data"))

    @property
    def blocks_dir(self) -> Path:
        return self.data_dir / "blocks"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def index_dir(self) -> Path:
        return self.data_dir / "index"

    @property
    def demo_dir(self) -> Path:
        return BACKEND_ROOT / "data" / "demo"

    @property
    def cors_origin_list(self) -> list[str]:
        """Allowed origins, with trailing slashes stripped.

        A browser Origin header never has a trailing slash, so "https://x.app/"
        in configuration would silently match nothing.
        """
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def cors_allow_origin_regex(self) -> str:
        """Localhost, plus any operator-supplied pattern."""
        local = r"http://(localhost|127\.0\.0\.1):\d+"
        extra = self.cors_origin_regex.strip()
        return f"{local}|{extra}" if extra else local

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_key)

    @property
    def admin_protected(self) -> bool:
        return bool(self.admin_token)

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.blocks_dir, self.uploads_dir, self.index_dir):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
