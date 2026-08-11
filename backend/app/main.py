"""SwiftSearch FastAPI application."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes import router
from .config import get_settings
from .services.engine import SwiftSearchEngine

logger = logging.getLogger("swiftsearch")


def configure_logging() -> None:
    """Give the swiftsearch loggers a handler of their own.

    Uvicorn configures only its own loggers, so without this the storage and
    engine warnings would be written nowhere — exactly the silent-failure mode
    we want to avoid.
    """
    if logger.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(levelname)-8s %(name)s: %(message)s")
    )
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    engine = SwiftSearchEngine(settings)
    engine.bootstrap()
    app.state.engine = engine
    if engine.store.remote_error:
        logger.warning(
            "Supabase unavailable (%s) — using local storage.", engine.store.remote_error
        )

    # The index lives on ephemeral disk; the corpus does not. Rebuild in the
    # background rather than serving 409s until someone clicks "Build Index".
    await engine.recover_index_if_missing()

    if settings.supabase_enabled and not settings.admin_protected:
        logger.warning(
            "ADMIN_TOKEN is not set: document delete, index reset and demo seed "
            "are reachable by anyone who can reach this API. Set ADMIN_TOKEN for "
            "any internet-facing deployment."
        )

    logger.info(
        "SwiftSearch ready — %d documents, storage=%s, index=%s",
        len(engine.documents.list_documents()),
        "supabase" if engine.store.using_supabase else "local",
        "ready" if engine.index is not None else engine.state,
    )
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description="Blocked Sort-Based Indexing search engine with BM25 ranking.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router, prefix=settings.api_prefix)

    @app.exception_handler(ValueError)
    async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.get("/")
    def root() -> dict:
        return {
            "name": settings.app_name,
            "docs": "/docs",
            "api": settings.api_prefix,
        }

    return app


app = create_app()
