"""On-disk block files for BSBI.

A block is a plain TSV file of `term<TAB>doc_id<TAB>position` records. Plain
text keeps blocks inspectable — the Index Explorer and the live indexing view
read them straight off disk.
"""

from __future__ import annotations

import heapq
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

Posting = tuple[str, str, int]  # (term, doc_id, position)


@dataclass
class BlockMeta:
    """Everything the UI needs to render one block on disk."""

    id: int
    path: str
    entries: int
    status: str = "writing"  # writing | written | sorting | sorted | merged
    size_bytes: int = 0
    first_term: str | None = None
    last_term: str | None = None
    created_ms: float = 0.0
    sorted_ms: float = 0.0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": f"Block {self.id}",
            "entries": self.entries,
            "status": self.status,
            "size_bytes": self.size_bytes,
            "first_term": self.first_term,
            "last_term": self.last_term,
            "created_ms": round(self.created_ms, 2),
            "sorted_ms": round(self.sorted_ms, 2),
        }


@dataclass
class BlockStore:
    """Owns the block directory and the block metadata list."""

    directory: Path
    blocks: list[BlockMeta] = field(default_factory=list)

    def reset(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        for stale in self.directory.glob("block_*.tsv"):
            stale.unlink()
        self.merged_path.unlink(missing_ok=True)
        self.blocks = []

    def path_for(self, block_id: int) -> Path:
        return self.directory / f"block_{block_id:04d}.tsv"

    def write(self, block_id: int, postings: Iterable[Posting]) -> BlockMeta:
        """Persist a run of postings to disk and record its metadata."""
        path = self.path_for(block_id)
        count = 0
        first_term: str | None = None
        last_term: str | None = None
        with path.open("w", encoding="utf-8") as handle:
            for term, doc_id, position in postings:
                if first_term is None:
                    first_term = term
                last_term = term
                handle.write(f"{term}\t{doc_id}\t{position}\n")
                count += 1
        meta = BlockMeta(
            id=block_id,
            path=str(path),
            entries=count,
            status="written",
            size_bytes=path.stat().st_size,
            first_term=first_term,
            last_term=last_term,
        )
        self.blocks.append(meta)
        return meta

    def read(self, block_id: int) -> list[Posting]:
        return list(self.iter_block(self.path_for(block_id)))

    def rewrite_sorted(self, meta: BlockMeta) -> BlockMeta:
        """Load a block, sort it by (term, doc_id, position), write it back.

        This is the external-sort pass: each block is small enough to sort in
        memory, which is precisely why BSBI splits the corpus into blocks.
        """
        path = Path(meta.path)
        postings = sorted(self.iter_block(path))
        with path.open("w", encoding="utf-8") as handle:
            for term, doc_id, position in postings:
                handle.write(f"{term}\t{doc_id}\t{position}\n")
        meta.status = "sorted"
        meta.size_bytes = path.stat().st_size
        meta.first_term = postings[0][0] if postings else None
        meta.last_term = postings[-1][0] if postings else None
        return meta

    @staticmethod
    def iter_block(path: Path) -> Iterator[Posting]:
        """Stream a block file without loading it entirely into memory."""
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.rstrip("\n")
                if not line:
                    continue
                term, doc_id, position = line.split("\t")
                yield term, doc_id, int(position)

    def merge_stream(self) -> Iterator[Posting]:
        """K-way merge across every sorted block — one linear pass, O(n log k).

        Only one record per block is held in memory at a time, which is the
        whole point of sorting the blocks first. This is a lazy generator: the
        caller must never materialise it into a list.
        """
        readers = [self.iter_block(Path(meta.path)) for meta in self.blocks]
        return heapq.merge(*readers)

    @property
    def merged_path(self) -> Path:
        return self.directory / "merged.tsv"

    def discover(self) -> list[BlockMeta]:
        """Rebuild block metadata from the files already on disk.

        Called on startup so that a restarted backend can still serve
        `/api/index/blocks` and the block drill-down for an index it did not
        build in this process.
        """
        self.blocks = []
        for path in sorted(self.directory.glob("block_*.tsv")):
            try:
                block_id = int(path.stem.split("_")[1])
            except (IndexError, ValueError):
                continue

            entries = 0
            first_term: str | None = None
            last_term: str | None = None
            for term, _, _ in self.iter_block(path):
                if first_term is None:
                    first_term = term
                last_term = term
                entries += 1

            self.blocks.append(
                BlockMeta(
                    id=block_id,
                    path=str(path),
                    entries=entries,
                    status="merged",
                    size_bytes=path.stat().st_size,
                    first_term=first_term,
                    last_term=last_term,
                )
            )
        return self.blocks

    def preview(self, block_id: int, limit: int = 200) -> list[Posting]:
        path = self.path_for(block_id)
        if not path.exists():
            return []
        out: list[Posting] = []
        for posting in self.iter_block(path):
            out.append(posting)
            if len(out) >= limit:
                break
        return out
