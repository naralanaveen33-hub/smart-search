"""SwiftSearchEngine — the single stateful service the API layer talks to.

Owns the live BSBI indexer, the in-memory inverted index, runtime settings and
the derived analytics.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from ..bsbi.indexer import STAGES, BSBIIndexer, IndexDocument, InvertedIndex
from ..bsbi.tokenizer import Tokenizer
from ..config import Settings
from ..database.store import Store, utc_now
from ..ranking.bm25 import BM25Ranker
from ..ranking.snippets import build_snippet, estimate_page
from .document_service import DocumentService
from .events import EventBus

logger = logging.getLogger("swiftsearch.engine")

# Rough cost of one in-memory posting: a (str, str, int) tuple plus the shared
# interned strings. Used only to translate the max_memory_mb setting into a
# block-size ceiling — it is an estimate, not a measurement of process memory.
BYTES_PER_POSTING = 120

# The stop word list and the Porter stemmer are English-specific, so English is
# the only language the pipeline can honestly claim to support.
SUPPORTED_LANGUAGES = ["english"]

DEFAULT_SETTINGS_KEYS = (
    "block_size", "max_memory_mb", "language", "use_stop_words", "use_stemming",
    "bm25_enabled", "case_sensitive", "phrase_search", "highlight_results",
    "results_per_page", "step_delay",
)


class SwiftSearchEngine:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.store = Store(settings)
        self.documents = DocumentService(settings, self.store)
        self.bus = EventBus()

        self.runtime = {
            "block_size": settings.block_size,
            "max_memory_mb": settings.max_memory_mb,
            "language": settings.language,
            "use_stop_words": settings.use_stop_words,
            "use_stemming": settings.use_stemming,
            "bm25_enabled": True,
            "case_sensitive": False,
            "phrase_search": True,
            "highlight_results": True,
            "results_per_page": 20,
            "step_delay": settings.index_step_delay,
        }
        self.runtime.update(
            {k: v for k, v in self.store.get_settings().items() if k in DEFAULT_SETTINGS_KEYS}
        )

        self.index: InvertedIndex | None = None
        self.state: str = "idle"
        self.last_error: str | None = None
        self.last_run: dict[str, Any] | None = None
        self._task: asyncio.Task | None = None
        self.indexer = self._new_indexer()

    # --------------------------------------------------------------- setup

    def bootstrap(self) -> None:
        """Called on startup: seed demo docs and reload any existing index."""
        if self.settings.seed_demo_documents:
            self.documents.seed_demo_documents()
        loaded = InvertedIndex.load(self.settings.index_dir / "index.json")
        if loaded is not None and loaded.num_docs:
            self.index = loaded
            self.state = "completed"
            runs = self.store.list_index_runs()
            if runs:
                self.last_run = runs[-1]
            recovered = self._restore_completed_state()
            logger.info(
                "Restored index: %d documents, %d terms, %d block(s) on disk",
                loaded.num_docs,
                loaded.vocabulary_size,
                len(recovered),
            )

    async def recover_index_if_missing(self) -> bool:
        """Rebuild the index at startup when documents exist but the index does not.

        The corpus survives in Supabase; the inverted index and its blocks live
        on local disk, which most hosting platforms wipe on every deploy and
        cold start. Without this, a restarted instance shows a full document
        list while every search returns 409.

        Runs in the background — `start_indexing` schedules a task and returns —
        so startup is never blocked. Progress is published on the usual SSE
        stream, so the UI shows a normal indexing run.
        """
        if self.index is not None or self.is_running:
            return False
        if not self.settings.auto_rebuild_index:
            logger.info("No index on disk; auto-rebuild is disabled.")
            return False

        documents = self.documents.list_documents()
        if not documents:
            return False

        try:
            # No artificial pacing: this is recovery, not a demo.
            await self.start_indexing(step_delay=0.0)
        except Exception as exc:
            # Never prevent the app from starting — the UI still offers a
            # manual "Build Index", and search reports the index as missing.
            logger.error("Automatic index rebuild could not start: %s", exc)
            return False

        logger.info(
            "No index found on disk — rebuilding from %d recovered document(s).",
            len(documents),
        )
        return True

    def _restore_completed_state(self) -> list:
        """Repopulate a fresh indexer from what is already on disk.

        Used on startup *and* whenever settings replace the indexer — otherwise
        changing a setting would silently discard the recovered block list and
        the statistics of the last run.
        """
        if self.index is None:
            return []

        for stage in self.indexer.stages.values():
            stage["status"] = "completed"
            stage["progress"] = 100

        # Rebuild block metadata from the files on disk, so /api/index/blocks
        # and the block drill-down keep working.
        recovered = self.indexer.store.discover()
        self.indexer.stats.update(
            {
                "documents_total": self.index.num_docs,
                "documents_processed": self.index.num_docs,
                "unique_terms": self.index.vocabulary_size,
                "postings_generated": self.index.total_postings,
                "index_size_bytes": self._index_size(),
                "blocks_created": len(recovered),
                "avg_block_size": (
                    round(sum(b.entries for b in recovered) / len(recovered))
                    if recovered
                    else 0
                ),
            }
        )

        run = self.last_run or {}
        self.indexer.stats["peak_memory_entries"] = run.get("peak_memory_entries", 0)
        self.indexer.stats["peak_memory_used"] = run.get("peak_memory_used", 0)
        if not recovered:
            self.indexer.stats["blocks_created"] = run.get("blocks", 0)
            self.indexer.stats["avg_block_size"] = run.get("avg_block_size", 0)
        return recovered

    def _index_size(self) -> int:
        path = self.settings.index_dir / "index.json"
        return path.stat().st_size if path.exists() else 0

    def tokenizer(self) -> Tokenizer:
        return Tokenizer(
            use_stop_words=bool(self.runtime["use_stop_words"]),
            use_stemming=bool(self.runtime["use_stemming"]),
            case_sensitive=bool(self.runtime["case_sensitive"]),
        )

    def effective_block_size(self) -> int:
        """Block size after applying the max_memory_mb budget.

        The memory budget is a real constraint on the pipeline: a block may
        never exceed the number of postings that fit in the configured budget,
        so lowering max_memory_mb produces more, smaller blocks.
        """
        requested = int(self.runtime["block_size"])
        budget = int(self.runtime["max_memory_mb"]) * 1024 * 1024 // BYTES_PER_POSTING
        return max(1, min(requested, budget))

    def memory_budget(self) -> dict:
        requested = int(self.runtime["block_size"])
        effective = self.effective_block_size()
        return {
            "requested_block_size": requested,
            "effective_block_size": effective,
            "max_postings_in_budget": int(self.runtime["max_memory_mb"])
            * 1024
            * 1024
            // BYTES_PER_POSTING,
            "bytes_per_posting": BYTES_PER_POSTING,
            "capped": effective < requested,
        }

    def _new_indexer(self) -> BSBIIndexer:
        return BSBIIndexer(
            blocks_dir=self.settings.blocks_dir,
            index_path=self.settings.index_dir / "index.json",
            block_size=self.effective_block_size(),
            tokenizer=self.tokenizer(),
            on_event=self._on_event,
            step_delay=float(self.runtime["step_delay"]),
        )

    async def _on_event(self, payload: dict) -> None:
        payload["type"] = "progress"
        payload["state"] = self.state
        payload["index_ready"] = self.index is not None
        await self.bus.publish(payload)

    # ------------------------------------------------------------ indexing

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start_indexing(
        self,
        *,
        block_size: int | None = None,
        use_stop_words: bool | None = None,
        use_stemming: bool | None = None,
        step_delay: float | None = None,
        document_ids: list[str] | None = None,
    ) -> None:
        if self.is_running:
            raise RuntimeError("Indexing is already running.")

        if block_size is not None:
            self.runtime["block_size"] = block_size
        if use_stop_words is not None:
            self.runtime["use_stop_words"] = use_stop_words
        if use_stemming is not None:
            self.runtime["use_stemming"] = use_stemming
        if step_delay is not None:
            self.runtime["step_delay"] = step_delay
        self._persist_settings()

        rows = self.documents.list_documents()
        if document_ids:
            wanted = set(document_ids)
            rows = [r for r in rows if r["id"] in wanted]
        if not rows:
            raise ValueError("No documents available to index. Upload a document first.")

        docs = [
            IndexDocument(
                doc_id=row["id"],
                title=row.get("title") or row["id"],
                text=self.documents.read_text(row["id"]),
                source=row.get("source", "upload"),
                file_name=row.get("file_name", ""),
                size_bytes=row.get("size_bytes", 0),
            )
            for row in rows
        ]
        docs = [d for d in docs if d.text.strip()]
        if not docs:
            raise ValueError("Selected documents contain no extractable text.")

        self.indexer = self._new_indexer()
        self.state = "running"
        self.last_error = None
        self._task = asyncio.create_task(self._run(docs))

    async def _run(self, docs: list[IndexDocument]) -> None:
        started = time.perf_counter()
        try:
            index = await self.indexer.build(docs)
            self.index = index
            self.state = "completed"
            self.documents.mark_indexed(index.doc_lengths)
            self.last_run = {
                "created_at": utc_now(),
                "documents": index.num_docs,
                "unique_terms": index.vocabulary_size,
                "postings": index.total_postings,
                "blocks": len(self.indexer.store.blocks),
                "avg_block_size": self.indexer.stats["avg_block_size"],
                "seconds": round(time.perf_counter() - started, 3),
                "index_size_bytes": self._index_size(),
                "block_size": self.effective_block_size(),
                "peak_memory_entries": self.indexer.stats["peak_memory_entries"],
                "peak_memory_used": self.indexer.stats["peak_memory_used"],
            }
            self.store.add_index_run(self.last_run)
            await self.bus.publish(
                {
                    "type": "completed",
                    "state": "completed",
                    "index_ready": True,
                    "run": self.last_run,
                    **self.indexer.snapshot(),
                }
            )
        except Exception as exc:
            self.state = "error"
            self.last_error = str(exc)
            await self.bus.publish(
                {
                    "type": "error",
                    "state": "error",
                    "error": str(exc),
                    "index_ready": self.index is not None,
                    **self.indexer.snapshot(),
                }
            )

    def status(self) -> dict:
        snapshot = self.indexer.snapshot()
        snapshot["state"] = self.state
        snapshot["error"] = self.last_error or snapshot.get("error")
        snapshot["index_ready"] = self.index is not None
        if self.index is not None and self.state != "running":
            snapshot["stats"]["unique_terms"] = self.index.vocabulary_size
            snapshot["stats"]["index_size_bytes"] = self._index_size()
        return snapshot

    def reset_index(self) -> None:
        path = self.settings.index_dir / "index.json"
        if path.exists():
            path.unlink()
        self.indexer.store.reset()
        self.index = None
        self.state = "idle"
        self.last_error = None
        self.indexer = self._new_indexer()

    # -------------------------------------------------------------- search

    def search(
        self, query: str, *, mode: str = "all", sort: str = "relevance",
        limit: int | None = None, offset: int = 0,
    ) -> dict:
        started = time.perf_counter()
        # An unspecified page size falls back to the configured preference.
        if limit is None:
            limit = int(self.runtime["results_per_page"])
        if self.index is None or not self.index.num_docs:
            raise LookupError("No index has been built yet. Build the index first.")

        tokenizer = self.tokenizer()
        terms = tokenizer.tokenize_query(query)
        effective_mode = mode if mode != "phrase" or self.runtime["phrase_search"] else "and"

        ranker = BM25Ranker(
            self.index, k1=self.settings.bm25_k1, b=self.settings.bm25_b
        )
        candidates = ranker.candidates(terms, effective_mode)
        # Rank the full candidate set, then serve one page from it — ordering
        # must not depend on which page was requested.
        scored = ranker.rank(terms, mode=effective_mode)

        if not self.runtime["bm25_enabled"]:
            # Fall back to raw match count so the toggle is observable.
            scored.sort(key=lambda s: (-len(s.matched_terms), s.document_id))

        if sort in ("newest", "oldest"):
            order = {row["id"]: row.get("uploaded_at") or "" for row in self.documents.list_documents()}
            scored.sort(key=lambda s: order.get(s.document_id, ""), reverse=(sort == "newest"))

        total = len(scored)
        page = scored[offset : offset + limit]
        top_score = max((s.score for s in scored), default=0.0) or 1.0

        results = []
        for doc in page:
            meta = self.index.documents.get(doc.document_id, {})
            text = meta.get("text") or self.documents.read_text(doc.document_id)
            snippet, highlight_terms = build_snippet(text, doc.matched_terms, tokenizer)
            first_position = min((p[0] for p in doc.positions.values() if p), default=0)
            results.append(
                {
                    "document_id": doc.document_id,
                    "title": meta.get("title", doc.document_id),
                    "snippet": snippet,
                    "score": doc.score,
                    "relevance": max(1, round(doc.score / top_score * 100)),
                    "matched_terms": doc.matched_terms,
                    "highlight_terms": highlight_terms,
                    "file_name": meta.get("file_name", ""),
                    "page": estimate_page(text, first_position * 6),
                    "doc_length": doc.doc_length,
                    "term_details": [
                        {
                            "term": d.term,
                            "term_frequency": d.term_frequency,
                            "document_frequency": d.document_frequency,
                            "idf": d.idf,
                            "contribution": d.contribution,
                        }
                        for d in doc.term_details
                    ],
                    "signals": self._signals(doc, terms),
                }
            )

        took = round(time.perf_counter() - started, 4)
        # Only the first page counts as a search — paging through results must
        # not inflate the search history or the analytics counters.
        if offset == 0:
            self.store.add_search(
                {
                    "query": query.strip(),
                    "mode": mode,
                    "results": total,
                    "took_seconds": took,
                    "created_at": utc_now(),
                }
            )

        return {
            "query": query,
            "normalized_terms": terms,
            "mode": mode,
            "total": total,
            "took_seconds": took,
            "results": results,
            "candidates_examined": len(candidates),
            "limit": limit,
            "offset": offset,
            "has_more": offset + len(page) < total,
        }

    def _signals(self, doc, terms: list[str]) -> list[dict]:
        """Human-readable reasons behind a document's rank."""
        avgdl = self.index.avg_doc_length or 1.0
        matched_all = len(set(doc.matched_terms)) == len(set(terms)) and bool(terms)
        max_tf = max((d.term_frequency for d in doc.term_details), default=0)
        rare = max((d.idf for d in doc.term_details), default=0.0)
        return [
            {
                "label": "Query terms matched",
                "detail": f"{len(set(doc.matched_terms))} of {len(set(terms))} terms found in this document",
                "passed": matched_all,
            },
            {
                "label": "Term frequency",
                "detail": f"Highest term frequency in this document: {max_tf}",
                "passed": max_tf >= 2,
            },
            {
                "label": "Document length",
                "detail": f"{doc.doc_length} terms vs {avgdl:.0f} average — BM25 normalises for length",
                "passed": doc.doc_length <= avgdl * 1.5,
            },
            {
                "label": "Term rarity (IDF)",
                "detail": f"Strongest inverse document frequency: {rare:.2f}",
                "passed": rare >= 0.5,
            },
        ]

    def search_history(self) -> dict:
        history = self.store.list_searches()[-25:][::-1]
        counter = Counter(
            h["query"].strip().lower() for h in self.store.list_searches() if h.get("query")
        )
        popular = [q for q, _ in counter.most_common(6)]
        defaults = [
            "machine learning", "information retrieval", "inverted index",
            "natural language processing", "blocked sort based indexing", "bm25 ranking",
        ]
        for item in defaults:
            if len(popular) >= 6:
                break
            if item not in popular:
                popular.append(item)
        return {"history": history, "popular": popular[:6]}

    # ----------------------------------------------------------- vocabulary

    def term(self, raw_term: str) -> dict:
        tokenizer = self.tokenizer()
        normalized_list = tokenizer.tokenize_query(raw_term)
        normalized = normalized_list[0] if normalized_list else raw_term.lower()
        if self.index is None:
            return {"term": raw_term, "normalized": normalized, "found": False}
        entry = self.index.term_entry(normalized)
        if entry is None:
            return {"term": raw_term, "normalized": normalized, "found": False}
        ranker = BM25Ranker(self.index)
        return {
            "term": raw_term,
            "normalized": normalized,
            "found": True,
            "document_frequency": entry["document_frequency"],
            "total_occurrences": entry["total_occurrences"],
            "postings": entry["postings"],
            "idf": round(ranker.idf(normalized), 4),
        }

    def vocabulary(self, prefix: str = "", limit: int = 50) -> dict:
        if self.index is None:
            return {"terms": [], "total": 0}
        prefix = prefix.lower().strip()
        terms = [t for t in self.index.postings if not prefix or t.startswith(prefix)]
        terms.sort(key=lambda t: (-self.index.document_frequency(t), t))
        return {
            "terms": [
                {"term": t, "document_frequency": self.index.document_frequency(t)}
                for t in terms[:limit]
            ],
            "total": len(terms),
        }

    # ------------------------------------------------------------ analytics

    def analytics(self) -> dict:
        searches = self.store.list_searches()
        runs = self.store.list_index_runs()
        docs = self.documents.list_documents()

        avg_ms = (
            round(sum(s.get("took_seconds", 0) for s in searches) / len(searches) * 1000, 2)
            if searches
            else 0.0
        )

        top_terms: list[dict] = []
        if self.index is not None:
            ranked = sorted(
                self.index.postings.items(),
                key=lambda kv: (-sum(len(p) for p in kv[1].values()), kv[0]),
            )[:10]
            top_terms = [
                {
                    "term": term,
                    "occurrences": sum(len(p) for p in postings.values()),
                    "documents": len(postings),
                }
                for term, postings in ranked
            ]

        query_counts = Counter(
            s["query"].strip().lower() for s in searches if s.get("query")
        )
        top_queries = [
            {"query": q, "count": c} for q, c in query_counts.most_common(6)
        ]

        return {
            "documents": len(docs),
            "unique_terms": self.index.vocabulary_size if self.index else 0,
            "index_size_bytes": self._index_size(),
            "searches": len(searches),
            "avg_response_ms": avg_ms,
            "indexing_seconds": (self.last_run or {}).get("seconds", 0.0),
            "blocks": (self.last_run or {}).get("blocks", self.indexer.stats["blocks_created"]),
            "avg_block_size": (self.last_run or {}).get(
                "avg_block_size", self.indexer.stats["avg_block_size"]
            ),
            "peak_memory_entries": self.indexer.stats["peak_memory_entries"],
            "peak_memory_used": self.indexer.stats["peak_memory_used"],
            "block_capacity": self.indexer.stats["memory_capacity"],
            "documents_over_time": self._daily(
                [(d.get("uploaded_at"), 1) for d in docs], cumulative=True
            ),
            "searches_over_time": self._daily([(s.get("created_at"), 1) for s in searches]),
            "response_time_over_time": self._daily(
                [(s.get("created_at"), s.get("took_seconds", 0) * 1000) for s in searches],
                average=True,
            ),
            "top_terms": top_terms,
            "top_queries": top_queries,
            "runs": runs[-10:],
        }

    @staticmethod
    def _daily(
        rows: list[tuple[str | None, float]],
        *,
        days: int = 14,
        cumulative: bool = False,
        average: bool = False,
    ) -> list[dict]:
        today = datetime.now(timezone.utc).date()
        buckets: dict[str, list[float]] = {
            (today - timedelta(days=i)).isoformat(): [] for i in range(days - 1, -1, -1)
        }
        for timestamp, value in rows:
            if not timestamp:
                continue
            try:
                day = datetime.fromisoformat(str(timestamp)).date().isoformat()
            except ValueError:
                continue
            if day in buckets:
                buckets[day].append(float(value))

        points: list[dict] = []
        running = 0.0
        for day, values in buckets.items():
            if average:
                value = round(sum(values) / len(values), 2) if values else 0.0
            else:
                value = sum(values)
            if cumulative:
                running += value
                value = running
            points.append({"label": day[5:], "value": value})
        return points

    # ------------------------------------------------------------- settings

    def get_settings_payload(self) -> dict:
        return {k: self.runtime[k] for k in DEFAULT_SETTINGS_KEYS}

    def update_settings(self, payload: dict) -> dict:
        self.runtime.update({k: v for k, v in payload.items() if k in DEFAULT_SETTINGS_KEYS})
        self._persist_settings()
        if not self.is_running:
            self.indexer = self._new_indexer()
            self._restore_completed_state()
        return self.get_settings_payload()

    def _persist_settings(self) -> None:
        self.store.save_settings(self.get_settings_payload())

    # ------------------------------------------------- pipeline explanation

    def explain_pipeline(self) -> dict:
        """Real data for How It Works / Presentation Mode.

        Runs the actual tokenizer and the actual block/sort/merge routines over
        a two-document sample so the teaching screens never show invented data.
        """
        tokenizer = self.tokenizer()
        sample = [
            ("DOC_001", "Machine learning is powerful."),
            ("DOC_002", "Machine learning algorithms are useful."),
        ]

        tokenization = []
        pairs: list[tuple[str, str, int]] = []
        for doc_id, text in sample:
            explained = tokenizer.explain(text)
            tokenization.append({"document_id": doc_id, "text": text, **explained})
            for token in tokenizer.tokenize(text):
                pairs.append((token.term, doc_id, token.position))

        # Distinct terms in first-appearance order. The sorting demo then shows
        # a true permutation of one list rather than two unrelated lists.
        unsorted_block: list[str] = []
        for term in (p[0] for p in pairs):
            if term not in unsorted_block:
                unsorted_block.append(term)
        unsorted_block = unsorted_block[:8]
        sorted_pairs = sorted(pairs)

        blocks = [sorted(pairs[i : i + 3]) for i in range(0, len(pairs), 3)] or [[]]

        inverted: dict[str, list[str]] = {}
        for term, doc_id, _ in sorted_pairs:
            inverted.setdefault(term, [])
            if doc_id not in inverted[term]:
                inverted[term].append(doc_id)

        live_terms: list[dict] = []
        if self.index is not None:
            for term, postings in list(
                sorted(
                    self.index.postings.items(),
                    key=lambda kv: (-len(kv[1]), kv[0]),
                )
            )[:6]:
                live_terms.append(
                    {"term": term, "documents": sorted(postings.keys())[:6]}
                )

        steps = [
            {
                "key": "documents",
                "label": "Documents",
                "description": "Documents are collected and assigned unique document IDs.",
                "data": {"documents": [{"id": d, "text": t} for d, t in sample]},
            },
            {
                "key": "tokenization",
                "label": "Tokenization",
                "description": "Text is split into individual terms and normalized before indexing.",
                "data": {"documents": tokenization},
            },
            {
                "key": "block_creation",
                "label": "Block Creation",
                "description": "Term-document pairs accumulate in memory. When memory fills, the block is written to disk.",
                "data": {
                    "pairs": [
                        {"term": t, "document_id": d, "position": p} for t, d, p in pairs
                    ],
                    "capacity": 3,
                },
            },
            {
                "key": "sorting",
                "label": "Sorting",
                "description": "Each block is sorted by term. Sorted blocks can later be merged in a single linear pass.",
                "data": {
                    "unsorted": unsorted_block,
                    "sorted": sorted(unsorted_block),
                },
            },
            {
                "key": "merging",
                "label": "Merging",
                "description": "Sorted blocks are merged with a k-way merge, holding only one record per block in memory.",
                "data": {
                    "blocks": [
                        {"id": i + 1, "terms": [p[0] for p in block]}
                        for i, block in enumerate(blocks)
                    ],
                    "merged": [p[0] for p in sorted_pairs],
                },
            },
            {
                "key": "inverted_index",
                "label": "Inverted Index",
                "description": "The final inverted index maps terms to documents, making search fast.",
                "data": {
                    "index": [
                        {"term": term, "documents": docs}
                        for term, docs in list(inverted.items())[:6]
                    ],
                    "live": live_terms,
                },
            },
        ]
        return {"steps": steps}
