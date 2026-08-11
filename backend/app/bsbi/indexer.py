"""Blocked Sort-Based Indexing.

The pipeline, and why each stage exists:

1. Documents      collect the corpus, assign stable document IDs
2. Tokenization   text -> normalized terms with positions
3. Block Creation postings accumulate in memory; when memory fills, the run is
                  flushed to disk. This is the reason BSBI exists: the full
                  postings list of a real corpus does not fit in RAM.
4. Sorting        each block is small enough to sort in memory, so we sort it
                  by (term, doc_id, position) on its own.
5. Merging        sorted blocks are merged with a k-way merge, holding only one
                  record per block in memory. The merged run is streamed
                  straight back out to a single file on disk — it is never
                  collected into a list.
6. Inverted Index the merged run is read back sequentially. Because it arrives
                  in term order every postings list is contiguous, so the index
                  is built one term at a time.

The external-memory property is the whole point: at no stage does the pipeline
hold more than one block (stage 3/4) or one record per block (stage 5) in
memory, whatever the size of the corpus.

Note: textbook BSBI sorts each run *before* writing it. SwiftSearch flushes the
run first and sorts it in a separate pass so that "sorting" is a visible,
inspectable stage. The result is identical and both passes do real work on real
files.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

from .blocks import BlockStore, Posting
from .tokenizer import Tokenizer

EventCallback = Callable[[dict], Awaitable[None]]

STAGES: list[tuple[str, str]] = [
    ("documents", "Documents"),
    ("tokenization", "Tokenization"),
    ("block_creation", "Block Creation"),
    ("sorting", "Sorting"),
    ("merging", "Merging"),
    ("inverted_index", "Inverted Index"),
]

MAX_STREAM_ITEMS = 60


@dataclass
class IndexDocument:
    """A document as the indexer sees it."""

    doc_id: str
    title: str
    text: str
    source: str = "demo"
    file_name: str = ""
    size_bytes: int = 0


@dataclass
class InvertedIndex:
    """term -> {doc_id: [positions]}, plus the statistics BM25 needs."""

    postings: dict[str, dict[str, list[int]]] = field(default_factory=dict)
    doc_lengths: dict[str, int] = field(default_factory=dict)
    documents: dict[str, dict] = field(default_factory=dict)
    total_postings: int = 0

    @property
    def num_docs(self) -> int:
        return len(self.doc_lengths)

    @property
    def avg_doc_length(self) -> float:
        if not self.doc_lengths:
            return 0.0
        return sum(self.doc_lengths.values()) / len(self.doc_lengths)

    @property
    def vocabulary_size(self) -> int:
        return len(self.postings)

    def document_frequency(self, term: str) -> int:
        return len(self.postings.get(term, {}))

    def collection_frequency(self, term: str) -> int:
        return sum(len(p) for p in self.postings.get(term, {}).values())

    def term_entry(self, term: str) -> dict | None:
        posting = self.postings.get(term)
        if posting is None:
            return None
        return {
            "term": term,
            "document_frequency": len(posting),
            "total_occurrences": sum(len(p) for p in posting.values()),
            "postings": [
                {
                    "document_id": doc_id,
                    "title": self.documents.get(doc_id, {}).get("title", doc_id),
                    "positions": positions,
                    "term_frequency": len(positions),
                }
                for doc_id, positions in sorted(posting.items())
            ],
        }

    def to_dict(self) -> dict:
        return {
            "postings": self.postings,
            "doc_lengths": self.doc_lengths,
            "documents": self.documents,
            "total_postings": self.total_postings,
        }

    @classmethod
    def from_dict(cls, payload: dict) -> InvertedIndex:
        return cls(
            postings=payload.get("postings", {}),
            doc_lengths=payload.get("doc_lengths", {}),
            documents=payload.get("documents", {}),
            total_postings=payload.get("total_postings", 0),
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict()), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> InvertedIndex | None:
        if not path.exists():
            return None
        try:
            return cls.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            return None


class BSBIIndexer:
    """Runs the six-stage BSBI pipeline, emitting an event after every step."""

    def __init__(
        self,
        *,
        blocks_dir: Path,
        index_path: Path,
        block_size: int = 5000,
        tokenizer: Tokenizer | None = None,
        on_event: EventCallback | None = None,
        step_delay: float = 0.0,
    ) -> None:
        self.block_size = max(1, block_size)
        self.tokenizer = tokenizer or Tokenizer()
        self.store = BlockStore(directory=blocks_dir)
        self.index_path = index_path
        self.on_event = on_event
        self.step_delay = step_delay

        # Live, inspectable state — this is exactly what the UI renders.
        self.stages: dict[str, dict] = {
            key: {"key": key, "label": label, "status": "waiting", "progress": 0}
            for key, label in STAGES
        }
        self.memory_block: list[Posting] = []
        # Ring buffer: the UI shows the tail of the token stream, so only the
        # tail is retained. A full corpus would otherwise be kept alive purely
        # for display.
        self.token_stream: deque[dict] = deque(maxlen=MAX_STREAM_ITEMS)
        self.documents: dict[str, IndexDocument] = {}
        self.stats: dict = self._empty_stats()
        self.error: str | None = None
        self._started_at = 0.0
        self._finished_at: float | None = None

    # ---------------------------------------------------------------- events

    def _empty_stats(self) -> dict:
        return {
            "documents_total": 0,
            "documents_processed": 0,
            "tokens_generated": 0,
            "postings_generated": 0,
            "blocks_created": 0,
            "current_block": 0,
            "memory_entries": 0,
            "memory_capacity": self.block_size,
            "memory_used": 0,
            # High-water mark of the block buffer over the whole run. This is
            # postings held, not OS memory.
            "peak_memory_entries": 0,
            "peak_memory_used": 0,
            "unique_terms": 0,
            "index_size_bytes": 0,
            "elapsed_seconds": 0.0,
            "merge_progress": 0,
            "avg_block_size": 0,
        }

    @property
    def elapsed_seconds(self) -> float:
        """Wall-clock for the run. Frozen once the run finishes or fails."""
        if not self._started_at:
            return 0.0
        end = self._finished_at if self._finished_at is not None else time.perf_counter()
        return round(end - self._started_at, 2)

    def snapshot(self) -> dict:
        self.stats["elapsed_seconds"] = self.elapsed_seconds
        return {
            "stages": list(self.stages.values()),
            "stats": dict(self.stats),
            "blocks": [b.to_dict() for b in self.store.blocks],
            "memory_block": [
                {"term": t, "document_id": d, "position": p}
                for t, d, p in self.memory_block[-MAX_STREAM_ITEMS:]
            ],
            "token_stream": list(self.token_stream),
            "error": self.error,
        }

    async def _emit(self, stage: str, status: str, progress: int, **extra) -> None:
        self.stages[stage]["status"] = status
        self.stages[stage]["progress"] = max(0, min(100, int(progress)))
        if self.on_event is None:
            return
        payload = {
            "stage": stage,
            "status": status,
            "progress": self.stages[stage]["progress"],
            **self.snapshot(),
            **extra,
        }
        await self.on_event(payload)

    def _record_memory(self) -> None:
        """Update current and peak block-buffer occupancy."""
        entries = len(self.memory_block)
        used = round(entries / self.block_size * 100)
        self.stats["memory_entries"] = entries
        self.stats["memory_used"] = used
        if entries > self.stats["peak_memory_entries"]:
            self.stats["peak_memory_entries"] = entries
            self.stats["peak_memory_used"] = used

    async def _tick(self, factor: float = 1.0) -> None:
        """Yield to the event loop so SSE subscribers see intermediate states."""
        if self.step_delay > 0:
            await asyncio.sleep(self.step_delay * factor)
        else:
            await asyncio.sleep(0)

    # ----------------------------------------------------------------- build

    async def build(self, documents: list[IndexDocument]) -> InvertedIndex:
        self._started_at = time.perf_counter()
        self._finished_at = None
        self.error = None
        self.stats = self._empty_stats()
        self.stats["documents_total"] = len(documents)
        self.memory_block = []
        self.token_stream.clear()
        self.store.reset()
        self.documents = {doc.doc_id: doc for doc in documents}
        for stage in self.stages.values():
            stage["status"] = "waiting"
            stage["progress"] = 0

        if not documents:
            raise ValueError("No documents to index. Upload a document first.")

        try:
            await self._stage_documents(documents)
            postings_written = await self._stage_tokenize_and_block(documents)
            await self._stage_sorting()
            merged_count = await self._stage_merging()
            index = await self._stage_inverted_index(merged_count, postings_written)
            self._finished_at = time.perf_counter()
        except Exception as exc:  # surfaced to the UI as an error stage
            self._finished_at = time.perf_counter()
            self.error = str(exc)
            current = next(
                (s for s in self.stages.values() if s["status"] == "in_progress"),
                None,
            )
            if current is not None:
                await self._emit(current["key"], "error", current["progress"])
            raise

        return index

    async def _stage_documents(self, documents: list[IndexDocument]) -> None:
        await self._emit("documents", "in_progress", 0)
        for i, doc in enumerate(documents, start=1):
            self.stats["documents_processed"] = i
            await self._emit(
                "documents", "in_progress", i / len(documents) * 100,
                active_document=doc.doc_id,
            )
            await self._tick(0.4)
        await self._emit("documents", "completed", 100)

    async def _stage_tokenize_and_block(self, documents: list[IndexDocument]) -> int:
        """Stages 2 and 3 interleave: tokens stream straight into the block."""
        await self._emit("tokenization", "in_progress", 0)
        await self._emit("block_creation", "in_progress", 0)

        self.stats["documents_processed"] = 0
        self.stats["current_block"] = 1
        postings_written = 0
        total = len(documents)

        for i, doc in enumerate(documents, start=1):
            tokens = self.tokenizer.tokenize(doc.text)
            self.stats["tokens_generated"] += len(tokens)
            self.stats["documents_processed"] = i

            for token in tokens:
                self.memory_block.append((token.term, doc.doc_id, token.position))
                self.token_stream.append(
                    {
                        "term": token.term,
                        "raw": token.raw,
                        "document_id": doc.doc_id,
                        "position": token.position,
                    }
                )
                self.stats["postings_generated"] += 1
                self._record_memory()

                # Memory is full -> flush this run to disk and start a new block.
                if len(self.memory_block) >= self.block_size:
                    postings_written += await self._flush_block()

            self._record_memory()
            progress = i / total * 100
            await self._emit(
                "tokenization", "in_progress", progress, active_document=doc.doc_id
            )
            await self._emit(
                "block_creation", "in_progress", progress, active_document=doc.doc_id
            )
            await self._tick()

        await self._emit("tokenization", "completed", 100)

        if self.memory_block:
            postings_written += await self._flush_block(final=True)

        self.stats["avg_block_size"] = (
            round(postings_written / len(self.store.blocks)) if self.store.blocks else 0
        )
        await self._emit("block_creation", "completed", 100)
        return postings_written

    async def _flush_block(self, *, final: bool = False) -> int:
        block_id = len(self.store.blocks) + 1
        entries = len(self.memory_block)
        started = time.perf_counter()

        self.stats["current_block"] = block_id
        await self._emit(
            "block_creation",
            "in_progress",
            self.stages["block_creation"]["progress"],
            event="memory_full" if not final else "final_flush",
            block_id=block_id,
        )
        await self._tick(0.6)

        meta = self.store.write(block_id, self.memory_block)
        meta.created_ms = (time.perf_counter() - started) * 1000
        self.memory_block = []
        self.stats["blocks_created"] = len(self.store.blocks)
        self.stats["memory_entries"] = 0
        self.stats["memory_used"] = 0

        await self._emit(
            "block_creation",
            "in_progress",
            self.stages["block_creation"]["progress"],
            event="block_written",
            block_id=block_id,
        )
        await self._tick(0.5)
        return entries

    async def _stage_sorting(self) -> None:
        await self._emit("sorting", "in_progress", 0)
        total = len(self.store.blocks) or 1
        for i, meta in enumerate(self.store.blocks, start=1):
            meta.status = "sorting"
            await self._emit("sorting", "in_progress", (i - 1) / total * 100,
                             block_id=meta.id)
            await self._tick(0.5)
            started = time.perf_counter()
            self.store.rewrite_sorted(meta)
            meta.sorted_ms = (time.perf_counter() - started) * 1000
            await self._emit("sorting", "in_progress", i / total * 100, block_id=meta.id)
            await self._tick(0.4)
        await self._emit("sorting", "completed", 100)

    async def _stage_merging(self) -> int:
        """Stream the k-way merge straight to `merged.tsv`.

        Nothing is accumulated: one record is pulled from the heap, written,
        and dropped. Peak memory here is one record per block, regardless of
        corpus size. Returns the number of records written.
        """
        await self._emit("merging", "in_progress", 0)
        expected = sum(m.entries for m in self.store.blocks) or 1
        emit_every = max(1, expected // 20)
        written = 0

        merged_path = self.store.merged_path
        with merged_path.open("w", encoding="utf-8") as handle:
            for term, doc_id, position in self.store.merge_stream():
                handle.write(f"{term}\t{doc_id}\t{position}\n")
                written += 1
                if written % emit_every == 0:
                    self.stats["merge_progress"] = round(written / expected * 100)
                    await self._emit(
                        "merging", "in_progress", written / expected * 100,
                        current_term=term,
                    )
                    await self._tick(0.25)

        for meta in self.store.blocks:
            meta.status = "merged"
        self.stats["merge_progress"] = 100
        await self._emit("merging", "completed", 100)
        return written

    def _iter_merged(self) -> Iterator[Posting]:
        """Sequential read back over the merged run."""
        path = self.store.merged_path
        if not path.exists():
            return iter(())
        return self.store.iter_block(path)

    async def _stage_inverted_index(
        self, merged_count: int, postings_written: int
    ) -> InvertedIndex:
        await self._emit("inverted_index", "in_progress", 0)
        index = InvertedIndex()

        for doc in self.documents.values():
            index.documents[doc.doc_id] = {
                "id": doc.doc_id,
                "title": doc.title,
                "source": doc.source,
                "file_name": doc.file_name,
                "size_bytes": doc.size_bytes,
                "text": doc.text,
            }
            index.doc_lengths[doc.doc_id] = 0

        total = merged_count or 1
        emit_every = max(1, total // 15)
        seen = 0
        # The merged run is ordered by term, so postings lists build up
        # contiguously — one record at a time, no random access, and the run
        # itself is never held in memory.
        for term, doc_id, position in self._iter_merged():
            index.postings.setdefault(term, {}).setdefault(doc_id, []).append(position)
            index.doc_lengths[doc_id] = index.doc_lengths.get(doc_id, 0) + 1
            seen += 1
            if seen % emit_every == 0:
                self.stats["unique_terms"] = len(index.postings)
                await self._emit("inverted_index", "in_progress", seen / total * 100,
                                 current_term=term)
                await self._tick(0.25)

        index.total_postings = seen
        index.save(self.index_path)

        self.stats["unique_terms"] = index.vocabulary_size
        self.stats["index_size_bytes"] = (
            self.index_path.stat().st_size if self.index_path.exists() else 0
        )
        self.stats["postings_generated"] = postings_written
        await self._emit("inverted_index", "completed", 100)
        return index
