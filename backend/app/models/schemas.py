"""Pydantic request/response models for the SwiftSearch API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

SearchMode = Literal["all", "and", "or", "phrase"]
SortMode = Literal["relevance", "newest", "oldest"]
StageStatus = Literal["waiting", "in_progress", "completed", "error"]


class HealthResponse(BaseModel):
    status: str
    version: str
    index_ready: bool
    supabase: bool
    documents: int
    # Which backend is actually live, plus the last non-secret Supabase error.
    # Without these a misconfigured project is indistinguishable from an
    # unconfigured one — both simply serve local JSON.
    storage: Literal["supabase", "local"] = "local"
    supabase_error: str | None = None
    # True when destructive endpoints require the admin token. Only the fact is
    # exposed, never the token itself.
    admin_protected: bool = False


class DocumentSummary(BaseModel):
    id: str
    title: str
    file_name: str
    size_bytes: int
    status: str = "ready"
    source: str = "demo"
    uploaded_at: str | None = None
    indexed: bool = False
    term_count: int = 0
    preview: str = ""


class DocumentListResponse(BaseModel):
    documents: list[DocumentSummary]
    total: int


class UploadResponse(BaseModel):
    uploaded: list[DocumentSummary]
    skipped: list[dict[str, str]] = Field(default_factory=list)


class IndexStartRequest(BaseModel):
    block_size: int | None = Field(default=None, ge=10, le=1_000_000)
    use_stop_words: bool | None = None
    use_stemming: bool | None = None
    step_delay: float | None = Field(default=None, ge=0, le=2)
    document_ids: list[str] | None = None


class StageState(BaseModel):
    key: str
    label: str
    status: StageStatus
    progress: int


class IndexStats(BaseModel):
    documents_total: int = 0
    documents_processed: int = 0
    tokens_generated: int = 0
    postings_generated: int = 0
    blocks_created: int = 0
    current_block: int = 0
    memory_entries: int = 0
    memory_capacity: int = 0
    memory_used: int = 0
    peak_memory_entries: int = 0
    peak_memory_used: int = 0
    unique_terms: int = 0
    index_size_bytes: int = 0
    elapsed_seconds: float = 0
    merge_progress: int = 0
    avg_block_size: int = 0


class BlockSummary(BaseModel):
    id: int
    name: str
    entries: int
    status: str
    size_bytes: int
    first_term: str | None = None
    last_term: str | None = None
    created_ms: float = 0
    sorted_ms: float = 0


class PostingEntry(BaseModel):
    term: str
    document_id: str
    position: int


class TokenEntry(BaseModel):
    term: str
    raw: str
    document_id: str
    position: int


class IndexStatusResponse(BaseModel):
    state: Literal["idle", "running", "completed", "error"]
    stages: list[StageState]
    stats: IndexStats
    blocks: list[BlockSummary]
    memory_block: list[PostingEntry]
    token_stream: list[TokenEntry]
    error: str | None = None
    index_ready: bool = False


class BlockDetailResponse(BaseModel):
    block: BlockSummary
    entries: list[PostingEntry]
    truncated: bool


class TermPosting(BaseModel):
    document_id: str
    title: str
    positions: list[int]
    term_frequency: int


class TermResponse(BaseModel):
    term: str
    normalized: str
    found: bool
    document_frequency: int = 0
    total_occurrences: int = 0
    postings: list[TermPosting] = Field(default_factory=list)
    idf: float = 0


class TermSuggestion(BaseModel):
    term: str
    document_frequency: int


class VocabularyResponse(BaseModel):
    terms: list[TermSuggestion]
    total: int


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    mode: SearchMode = "all"
    sort: SortMode = "relevance"
    # Omit `limit` to use the configured results_per_page setting.
    limit: int | None = Field(default=None, ge=1, le=100)
    offset: int = Field(default=0, ge=0)

    @field_validator("query")
    @classmethod
    def query_must_not_be_blank(cls, value: str) -> str:
        """Reject whitespace-only queries.

        They retrieve nothing and would be written to search history as an
        empty string, which the Postgres check constraint on
        `search_history.query` rejects.
        """
        stripped = value.strip()
        if not stripped:
            raise ValueError("Query must contain at least one non-whitespace character")
        return stripped


class RankingSignal(BaseModel):
    label: str
    detail: str
    passed: bool


class TermDetail(BaseModel):
    term: str
    term_frequency: int
    document_frequency: int
    idf: float
    contribution: float


class SearchResult(BaseModel):
    document_id: str
    title: str
    snippet: str
    score: float
    relevance: int
    matched_terms: list[str]
    highlight_terms: list[str]
    file_name: str
    page: int | None = None
    doc_length: int
    term_details: list[TermDetail]
    signals: list[RankingSignal]


class SearchResponse(BaseModel):
    query: str
    normalized_terms: list[str]
    mode: SearchMode
    total: int
    took_seconds: float
    results: list[SearchResult]
    candidates_examined: int
    limit: int = 20
    offset: int = 0
    has_more: bool = False


class SearchHistoryItem(BaseModel):
    query: str
    mode: str
    results: int
    took_seconds: float
    created_at: str


class SearchHistoryResponse(BaseModel):
    history: list[SearchHistoryItem]
    popular: list[str]


class TimeseriesPoint(BaseModel):
    label: str
    value: float
    secondary: float | None = None


class AnalyticsResponse(BaseModel):
    documents: int
    unique_terms: int
    index_size_bytes: int
    searches: int
    avg_response_ms: float
    indexing_seconds: float
    blocks: int
    avg_block_size: int
    peak_memory_entries: int = 0
    peak_memory_used: int = 0
    block_capacity: int = 0
    documents_over_time: list[TimeseriesPoint]
    searches_over_time: list[TimeseriesPoint]
    response_time_over_time: list[TimeseriesPoint]
    top_terms: list[dict[str, Any]]
    top_queries: list[dict[str, Any]]


class SettingsPayload(BaseModel):
    block_size: int = Field(ge=10, le=1_000_000)
    # Allowed down to 1 MB: the point of the budget is to demonstrate a real
    # memory constraint, which needs to be reachable on a small corpus.
    max_memory_mb: int = Field(ge=1, le=8192)
    language: str
    use_stop_words: bool
    use_stemming: bool
    bm25_enabled: bool = True
    case_sensitive: bool = False
    phrase_search: bool = True
    highlight_results: bool = True
    results_per_page: int = Field(ge=5, le=100)
    step_delay: float = Field(ge=0, le=2)


class MemoryBudget(BaseModel):
    requested_block_size: int
    effective_block_size: int
    max_postings_in_budget: int
    bytes_per_posting: int
    capped: bool


class LanguageSupport(BaseModel):
    current: str
    supported: list[str]
    note: str


class ExplainStep(BaseModel):
    key: str
    label: str
    description: str
    data: dict[str, Any]


class PipelineExplainResponse(BaseModel):
    steps: list[ExplainStep]
