"""Tests for the external-memory properties of the pipeline.

These are the guarantees that make this BSBI rather than "sort a big list":
the merge never materialises the posting stream, and the live-view buffers are
bounded regardless of corpus size.
"""

from __future__ import annotations

import tracemalloc
from pathlib import Path

import pytest

from app.bsbi.blocks import BlockStore
from app.bsbi.indexer import MAX_STREAM_ITEMS, BSBIIndexer, IndexDocument
from app.bsbi.tokenizer import Tokenizer
from app.ranking.bm25 import BM25Ranker


def make_indexer(
    tmp_path: Path, block_size: int = 200, step_delay: float = 0
) -> BSBIIndexer:
    return BSBIIndexer(
        blocks_dir=tmp_path / "blocks",
        index_path=tmp_path / "index" / "index.json",
        block_size=block_size,
        tokenizer=Tokenizer(),
        step_delay=step_delay,
    )


async def run_stages_manually(indexer: BSBIIndexer, docs: list[IndexDocument]) -> None:
    """Drive stages 1-4 without build(), which owns setup and the clock."""
    indexer.store.reset()
    await indexer._stage_documents(docs)
    await indexer._stage_tokenize_and_block(docs)
    await indexer._stage_sorting()


def synthetic_corpus(docs: int = 12, words: int = 400) -> list[IndexDocument]:
    """A corpus big enough that a materialised merge list would be obvious."""
    return [
        IndexDocument(
            doc_id=f"DOC_{i:03d}",
            title=f"Document {i}",
            text=" ".join(f"term{(i * words + w) % 900}" for w in range(words)),
        )
        for i in range(1, docs + 1)
    ]


@pytest.mark.asyncio
async def test_merge_writes_a_sorted_run_without_returning_a_list(tmp_path):
    indexer = make_indexer(tmp_path, block_size=150)
    await indexer.build(synthetic_corpus(6, 200))

    merged_path = indexer.store.merged_path
    assert merged_path.exists(), "the merge stage must persist its run to disk"

    records = list(BlockStore.iter_block(merged_path))
    assert records == sorted(records), "the merged run must be globally ordered"
    assert len(records) == sum(m.entries for m in indexer.store.blocks)


@pytest.mark.asyncio
async def test_merge_stage_returns_a_count_not_the_stream(tmp_path):
    indexer = make_indexer(tmp_path, block_size=100)
    docs = synthetic_corpus(4, 150)

    await run_stages_manually(indexer, docs)
    result = await indexer._stage_merging()

    assert isinstance(result, int), "the merge stage must not hand back a list"
    assert result == sum(m.entries for m in indexer.store.blocks)


@pytest.mark.asyncio
async def test_merge_peak_memory_does_not_scale_with_the_corpus(tmp_path):
    """The merge must stream, not accumulate.

    A k-way merge legitimately costs O(k) — one open reader and one pending
    record per block. So the experiment holds the block count fixed and grows
    the corpus 10x: streaming keeps peak memory flat, while collecting the
    stream into a list would grow it in step with the posting count.
    """

    async def merge_peak(
        path: Path, docs: list[IndexDocument], block_size: int
    ) -> tuple[int, int, int]:
        indexer = make_indexer(path, block_size=block_size)
        await run_stages_manually(indexer, docs)
        blocks = len(indexer.store.blocks)

        tracemalloc.start()
        tracemalloc.reset_peak()
        count = await indexer._stage_merging()
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        return peak, count, blocks

    small_peak, small_count, small_blocks = await merge_peak(
        tmp_path / "small", synthetic_corpus(4, 200), block_size=100
    )
    large_peak, large_count, large_blocks = await merge_peak(
        tmp_path / "large", synthetic_corpus(40, 200), block_size=1000
    )

    assert small_blocks == large_blocks, "the k of the k-way merge must be held fixed"
    assert large_count > small_count * 8, "the large corpus must really be larger"

    # Collecting ~8k postings into a list costs roughly 1 MB of tuples and ints.
    # Streaming keeps peak flat, so a 2x allowance is far below that signal.
    assert large_peak < small_peak * 2, (
        f"merge peak scaled with corpus size: {small_peak} -> {large_peak} bytes "
        f"for {small_count} -> {large_count} postings across {small_blocks} blocks"
    )


@pytest.mark.asyncio
async def test_index_is_identical_whatever_the_block_size(tmp_path):
    docs = synthetic_corpus(6, 250)
    tiny = await make_indexer(tmp_path / "tiny", block_size=17).build(docs)
    huge = await make_indexer(tmp_path / "huge", block_size=1_000_000).build(docs)

    assert tiny.postings == huge.postings
    assert tiny.doc_lengths == huge.doc_lengths
    assert tiny.total_postings == huge.total_postings
    assert tiny.vocabulary_size == huge.vocabulary_size


@pytest.mark.asyncio
async def test_bm25_results_are_identical_whatever_the_block_size(tmp_path):
    docs = synthetic_corpus(8, 200)
    tiny = await make_indexer(tmp_path / "a", block_size=13).build(docs)
    huge = await make_indexer(tmp_path / "b", block_size=999_999).build(docs)

    query = ["term1", "term42", "term100"]
    tiny_ranked = BM25Ranker(tiny).rank(query)
    huge_ranked = BM25Ranker(huge).rank(query)

    assert [d.document_id for d in tiny_ranked] == [d.document_id for d in huge_ranked]
    assert [d.score for d in tiny_ranked] == [d.score for d in huge_ranked]


@pytest.mark.asyncio
async def test_positions_survive_the_streaming_merge(tmp_path):
    """Phrase search depends on positions, so verify them end to end."""
    docs = [
        IndexDocument("DOC_001", "a", "machine learning is powerful and machine learning wins"),
        IndexDocument("DOC_002", "b", "learning about the machine takes time"),
    ]
    index = await make_indexer(tmp_path, block_size=3).build(docs)
    tokenizer = Tokenizer()

    for doc in docs:
        for token in tokenizer.tokenize(doc.text):
            assert token.position in index.postings[token.term][doc.doc_id]

    phrase = BM25Ranker(index).rank(tokenizer.tokenize_query("machine learning"), mode="phrase")
    assert {d.document_id for d in phrase} == {"DOC_001"}


@pytest.mark.asyncio
async def test_token_stream_buffer_is_bounded(tmp_path):
    indexer = make_indexer(tmp_path, block_size=500)
    docs = synthetic_corpus(10, 300)

    seen_max = 0

    async def watch(_payload):
        nonlocal seen_max
        seen_max = max(seen_max, len(indexer.token_stream))

    indexer.on_event = watch
    await indexer.build(docs)

    total_tokens = indexer.stats["tokens_generated"]
    assert total_tokens > MAX_STREAM_ITEMS * 20, "corpus must exceed the buffer many times"
    assert seen_max <= MAX_STREAM_ITEMS
    assert len(indexer.token_stream) <= MAX_STREAM_ITEMS
    assert len(indexer.snapshot()["token_stream"]) <= MAX_STREAM_ITEMS


@pytest.mark.asyncio
async def test_token_stream_keeps_the_most_recent_tokens(tmp_path):
    indexer = make_indexer(tmp_path, block_size=500)
    await indexer.build(synthetic_corpus(3, 100))

    last_doc = "DOC_003"
    assert all(t["document_id"] == last_doc for t in list(indexer.token_stream)[-5:])


@pytest.mark.asyncio
async def test_elapsed_time_freezes_when_the_run_completes(tmp_path):
    import asyncio

    # A little pacing so the run is measurably longer than the 0.01s rounding.
    indexer = make_indexer(tmp_path, block_size=100, step_delay=0.01)
    await indexer.build(synthetic_corpus(3, 120))

    first = indexer.snapshot()["stats"]["elapsed_seconds"]
    assert first > 0
    await asyncio.sleep(0.2)
    second = indexer.snapshot()["stats"]["elapsed_seconds"]
    third = indexer.snapshot()["stats"]["elapsed_seconds"]

    assert first == second == third, "elapsed time must stop when indexing stops"


@pytest.mark.asyncio
async def test_elapsed_time_freezes_when_the_run_fails(tmp_path):
    import asyncio

    indexer = make_indexer(tmp_path, block_size=100, step_delay=0.01)

    async def explode():
        raise RuntimeError("disk on fire")

    indexer._stage_sorting = explode  # type: ignore[assignment]

    with pytest.raises(RuntimeError):
        await indexer.build(synthetic_corpus(2, 60))

    first = indexer.snapshot()["stats"]["elapsed_seconds"]
    assert first > 0
    await asyncio.sleep(0.2)
    assert indexer.snapshot()["stats"]["elapsed_seconds"] == first


@pytest.mark.asyncio
async def test_a_new_run_restarts_the_clock(tmp_path):
    indexer = make_indexer(tmp_path, block_size=100, step_delay=0.01)
    docs = synthetic_corpus(2, 80)

    await indexer.build(docs)
    first_finished = indexer._finished_at
    assert indexer.elapsed_seconds > 0

    await indexer.build(docs)
    assert indexer._finished_at != first_finished
    assert indexer.elapsed_seconds > 0


@pytest.mark.asyncio
async def test_peak_buffer_usage_is_recorded(tmp_path):
    indexer = make_indexer(tmp_path, block_size=120)
    await indexer.build(synthetic_corpus(5, 200))
    stats = indexer.stats

    assert stats["peak_memory_entries"] == 120, "buffer must have reached capacity"
    assert stats["peak_memory_used"] == 100
    # Current usage drops to zero after the final flush — peak must not.
    assert stats["memory_entries"] == 0
    assert stats["peak_memory_entries"] > stats["memory_entries"]
