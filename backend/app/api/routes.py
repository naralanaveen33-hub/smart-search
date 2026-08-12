"""HTTP surface for SwiftSearch."""

from __future__ import annotations

import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from ..models.schemas import (
    AnalyticsResponse,
    BlockDetailResponse,
    DocumentListResponse,
    HealthResponse,
    IndexStartRequest,
    IndexStatusResponse,
    LanguageSupport,
    MemoryBudget,
    PipelineExplainResponse,
    SearchHistoryResponse,
    SearchRequest,
    SearchResponse,
    SettingsPayload,
    TermResponse,
    UploadResponse,
    VocabularyResponse,
)
from ..database.store import StorageUploadError
from ..services.document_service import SUPPORTED_EXTENSIONS, UnsupportedFileType
from ..services.engine import SUPPORTED_LANGUAGES, SwiftSearchEngine

router = APIRouter()

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def get_engine(request: Request) -> SwiftSearchEngine:
    engine: SwiftSearchEngine | None = getattr(request.app.state, "engine", None)
    if engine is None:  # pragma: no cover - startup guard
        raise HTTPException(status_code=503, detail="Engine not initialised")
    return engine


EngineDep = Depends(get_engine)

ADMIN_HEADER = "X-Admin-Token"


def require_admin(
    request: Request, engine: SwiftSearchEngine = EngineDep
) -> None:
    """Guard the endpoints that destroy data.

    Deleting a document, resetting the index and seeding the demo corpus all
    discard or overwrite real state, so they are gated behind a shared secret.
    When ADMIN_TOKEN is unset the guard is inert — that keeps local development
    frictionless, and startup logs a warning so an unprotected deployment is
    never silent.
    """
    settings = engine.settings
    if not settings.admin_protected:
        return

    supplied = request.headers.get(ADMIN_HEADER, "")
    # compare_digest keeps the check constant-time.
    if not supplied or not secrets.compare_digest(supplied, settings.admin_token):
        raise HTTPException(
            status_code=401,
            detail=(
                "This action requires the admin token. Add it under "
                "Settings → Admin access."
            ),
            headers={"WWW-Authenticate": ADMIN_HEADER},
        )


AdminDep = Depends(require_admin)


@router.get("/health", response_model=HealthResponse)
def health(engine: SwiftSearchEngine = EngineDep) -> HealthResponse:
    return HealthResponse(
        status="ok",
        version="1.0.0",
        index_ready=engine.index is not None,
        documents=len(engine.documents.list_documents()),
        admin_protected=engine.settings.admin_protected,
        **engine.store.status(),
    )


# --------------------------------------------------------------- documents


@router.get("/documents", response_model=DocumentListResponse)
def list_documents(engine: SwiftSearchEngine = EngineDep) -> DocumentListResponse:
    docs = engine.documents.list_documents()
    return DocumentListResponse(documents=docs, total=len(docs))


@router.post("/documents/upload", response_model=UploadResponse)
async def upload_documents(
    files: list[UploadFile] = File(...), engine: SwiftSearchEngine = EngineDep
) -> UploadResponse:
    uploaded, skipped = [], []
    for upload in files:
        name = upload.filename or "document.txt"
        suffix = Path(name).suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            skipped.append({"file_name": name, "reason": f"Unsupported type {suffix or '?'}"})
            continue
        content = await upload.read()
        if len(content) > MAX_UPLOAD_BYTES:
            skipped.append({"file_name": name, "reason": "File exceeds the 20 MB limit"})
            continue
        try:
            uploaded.append(engine.documents.add_document(name, content))
        except UnsupportedFileType as exc:
            skipped.append({"file_name": name, "reason": str(exc)})
        except StorageUploadError as exc:
            # Report the real Storage error. Never count this file as uploaded:
            # the row is not persisted and the object is not in the bucket.
            skipped.append({"file_name": name, "reason": str(exc)})
        except Exception as exc:  # parsing failures should not 500 the batch
            skipped.append({"file_name": name, "reason": f"Could not read file: {exc}"})

    if not uploaded and skipped:
        raise HTTPException(status_code=400, detail=skipped[0]["reason"])
    return UploadResponse(uploaded=uploaded, skipped=skipped)


@router.delete("/documents/{doc_id}", dependencies=[AdminDep])
def delete_document(doc_id: str, engine: SwiftSearchEngine = EngineDep) -> dict:
    engine.documents.delete_document(doc_id)
    return {"deleted": doc_id}


@router.get("/documents/{doc_id}/text")
def document_text(doc_id: str, engine: SwiftSearchEngine = EngineDep) -> dict:
    text = engine.documents.read_text(doc_id)
    if not text:
        raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")
    meta = next(
        (d for d in engine.documents.list_documents() if d["id"] == doc_id), {}
    )
    return {"id": doc_id, "title": meta.get("title", doc_id), "text": text}


@router.post("/documents/seed", dependencies=[AdminDep])
def seed_documents(engine: SwiftSearchEngine = EngineDep) -> dict:
    added = engine.documents.seed_demo_documents()
    return {"added": added}


# ---------------------------------------------------------------- indexing


@router.post("/index/start", response_model=IndexStatusResponse)
async def start_index(
    payload: IndexStartRequest | None = None, engine: SwiftSearchEngine = EngineDep
) -> IndexStatusResponse:
    payload = payload or IndexStartRequest()
    try:
        await engine.start_indexing(
            block_size=payload.block_size,
            use_stop_words=payload.use_stop_words,
            use_stemming=payload.use_stemming,
            step_delay=payload.step_delay,
            document_ids=payload.document_ids,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return IndexStatusResponse(**engine.status())


@router.post("/index/reset", response_model=IndexStatusResponse, dependencies=[AdminDep])
def reset_index(engine: SwiftSearchEngine = EngineDep) -> IndexStatusResponse:
    if engine.is_running:
        raise HTTPException(status_code=409, detail="Cannot reset while indexing is running.")
    engine.reset_index()
    return IndexStatusResponse(**engine.status())


@router.get("/index/status", response_model=IndexStatusResponse)
def index_status(engine: SwiftSearchEngine = EngineDep) -> IndexStatusResponse:
    return IndexStatusResponse(**engine.status())


@router.get("/index/steps")
def index_steps(engine: SwiftSearchEngine = EngineDep) -> dict:
    status = engine.status()
    return {"steps": status["stages"], "state": status["state"]}


@router.get("/index/events")
async def index_events(engine: SwiftSearchEngine = EngineDep) -> StreamingResponse:
    """Server-Sent Events stream of live indexing progress."""
    return StreamingResponse(
        engine.bus.stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/index/blocks")
def index_blocks(engine: SwiftSearchEngine = EngineDep) -> dict:
    return {"blocks": [b.to_dict() for b in engine.indexer.store.blocks]}


@router.get("/index/block/{block_id}", response_model=BlockDetailResponse)
def index_block(
    block_id: int, limit: int = 200, engine: SwiftSearchEngine = EngineDep
) -> BlockDetailResponse:
    meta = next((b for b in engine.indexer.store.blocks if b.id == block_id), None)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Block {block_id} not found")
    entries = engine.indexer.store.preview(block_id, limit=limit)
    return BlockDetailResponse(
        block=meta.to_dict(),
        entries=[
            {"term": t, "document_id": d, "position": p} for t, d, p in entries
        ],
        truncated=len(entries) >= limit,
    )


@router.get("/index/term/{term}", response_model=TermResponse)
def index_term(term: str, engine: SwiftSearchEngine = EngineDep) -> TermResponse:
    return TermResponse(**engine.term(term))


@router.get("/index/vocabulary", response_model=VocabularyResponse)
def index_vocabulary(
    prefix: str = "", limit: int = 50, engine: SwiftSearchEngine = EngineDep
) -> VocabularyResponse:
    return VocabularyResponse(**engine.vocabulary(prefix, limit))


@router.get("/index/explain", response_model=PipelineExplainResponse)
def index_explain(engine: SwiftSearchEngine = EngineDep) -> PipelineExplainResponse:
    return PipelineExplainResponse(**engine.explain_pipeline())


# ------------------------------------------------------------------ search


@router.post("/search", response_model=SearchResponse)
def search(payload: SearchRequest, engine: SwiftSearchEngine = EngineDep) -> SearchResponse:
    try:
        return SearchResponse(
            **engine.search(
                payload.query,
                mode=payload.mode,
                sort=payload.sort,
                limit=payload.limit,
                offset=payload.offset,
            )
        )
    except LookupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/search/history", response_model=SearchHistoryResponse)
def search_history(engine: SwiftSearchEngine = EngineDep) -> SearchHistoryResponse:
    return SearchHistoryResponse(**engine.search_history())


# --------------------------------------------------------- analytics/config


@router.get("/analytics", response_model=AnalyticsResponse)
def analytics(engine: SwiftSearchEngine = EngineDep) -> AnalyticsResponse:
    return AnalyticsResponse(**engine.analytics())


@router.get("/settings", response_model=SettingsPayload)
def get_settings_route(engine: SwiftSearchEngine = EngineDep) -> SettingsPayload:
    return SettingsPayload(**engine.get_settings_payload())


@router.put("/settings", response_model=SettingsPayload)
def update_settings_route(
    payload: SettingsPayload, engine: SwiftSearchEngine = EngineDep
) -> SettingsPayload:
    return SettingsPayload(**engine.update_settings(payload.model_dump()))


@router.get("/settings/memory", response_model=MemoryBudget)
def memory_budget(engine: SwiftSearchEngine = EngineDep) -> MemoryBudget:
    """How the max_memory_mb budget translates into a block-size ceiling."""
    return MemoryBudget(**engine.memory_budget())


@router.get("/settings/languages", response_model=LanguageSupport)
def language_support(engine: SwiftSearchEngine = EngineDep) -> LanguageSupport:
    return LanguageSupport(
        current=str(engine.runtime["language"]),
        supported=SUPPORTED_LANGUAGES,
        note=(
            "English is the only supported language: the stop word list and the "
            "Porter stemmer are English-specific."
        ),
    )
