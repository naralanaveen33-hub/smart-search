from pathlib import Path

import pytest

from app.bsbi.blocks import BlockStore
from app.bsbi.indexer import BSBIIndexer, IndexDocument, InvertedIndex
from app.bsbi.tokenizer import Tokenizer


def make_indexer(tmp_path: Path, block_size: int = 8, **kwargs) -> BSBIIndexer:
    return BSBIIndexer(
        blocks_dir=tmp_path / "blocks",
        index_path=tmp_path / "index" / "index.json",
        block_size=block_size,
        tokenizer=Tokenizer(),
        step_delay=0,
        **kwargs,
    )


@pytest.mark.asyncio
async def test_memory_full_flushes_a_block(tmp_path, sample_documents):
    indexer = make_indexer(tmp_path, block_size=6)
    await indexer.build(sample_documents)

    assert len(indexer.store.blocks) > 1, "small memory must force multiple blocks"
    # Every block except the final flush is exactly at capacity.
    for meta in indexer.store.blocks[:-1]:
        assert meta.entries == 6


@pytest.mark.asyncio
async def test_every_block_on_disk_is_sorted(tmp_path, sample_documents):
    indexer = make_indexer(tmp_path, block_size=5)
    await indexer.build(sample_documents)

    for meta in indexer.store.blocks:
        postings = list(BlockStore.iter_block(Path(meta.path)))
        assert postings == sorted(postings)
        assert meta.status == "merged"


@pytest.mark.asyncio
async def test_merge_stream_is_globally_ordered(tmp_path, sample_documents):
    indexer = make_indexer(tmp_path, block_size=5)
    await indexer.build(sample_documents)

    merged = list(indexer.store.merge_stream())
    assert merged == sorted(merged)
    assert len(merged) == sum(m.entries for m in indexer.store.blocks)


@pytest.mark.asyncio
async def test_inverted_index_matches_a_brute_force_index(tmp_path, sample_documents):
    indexer = make_indexer(tmp_path, block_size=4)
    index = await indexer.build(sample_documents)

    tokenizer = Tokenizer()
    expected: dict[str, dict[str, list[int]]] = {}
    for doc in sample_documents:
        for token in tokenizer.tokenize(doc.text):
            expected.setdefault(token.term, {}).setdefault(doc.doc_id, []).append(
                token.position
            )

    assert index.postings == expected
    assert index.vocabulary_size == len(expected)


@pytest.mark.asyncio
async def test_block_size_does_not_change_the_result(tmp_path, sample_documents):
    small = await make_indexer(tmp_path / "a", block_size=3).build(sample_documents)
    large = await make_indexer(tmp_path / "b", block_size=10_000).build(sample_documents)
    assert small.postings == large.postings
    assert small.doc_lengths == large.doc_lengths


@pytest.mark.asyncio
async def test_doc_lengths_count_indexed_terms(tmp_path, sample_documents):
    index = await make_indexer(tmp_path).build(sample_documents)
    tokenizer = Tokenizer()
    for doc in sample_documents:
        assert index.doc_lengths[doc.doc_id] == len(tokenizer.tokenize(doc.text))
    assert index.num_docs == 3
    assert index.avg_doc_length > 0


@pytest.mark.asyncio
async def test_events_are_emitted_for_every_stage(tmp_path, sample_documents):
    seen: list[tuple[str, str]] = []

    async def collect(payload):
        seen.append((payload["stage"], payload["status"]))

    indexer = make_indexer(tmp_path, block_size=5, on_event=collect)
    await indexer.build(sample_documents)

    completed = {stage for stage, status in seen if status == "completed"}
    assert completed == {
        "documents", "tokenization", "block_creation",
        "sorting", "merging", "inverted_index",
    }
    assert any(stage == "block_creation" for stage, _ in seen)


@pytest.mark.asyncio
async def test_index_round_trips_through_disk(tmp_path, sample_documents):
    indexer = make_indexer(tmp_path)
    index = await indexer.build(sample_documents)
    reloaded = InvertedIndex.load(indexer.index_path)
    assert reloaded is not None
    assert reloaded.postings == index.postings
    assert reloaded.num_docs == index.num_docs


@pytest.mark.asyncio
async def test_empty_corpus_raises(tmp_path):
    with pytest.raises(ValueError):
        await make_indexer(tmp_path).build([])


@pytest.mark.asyncio
async def test_blocks_are_reset_between_runs(tmp_path, sample_documents):
    indexer = make_indexer(tmp_path, block_size=5)
    await indexer.build(sample_documents)
    first = len(indexer.store.blocks)
    await indexer.build(sample_documents)
    assert len(indexer.store.blocks) == first
    assert len(list((tmp_path / "blocks").glob("block_*.tsv"))) == first


@pytest.mark.asyncio
async def test_positions_are_recorded_per_occurrence(tmp_path):
    docs = [IndexDocument("DOC_001", "t", "alpha beta alpha gamma alpha")]
    index = await make_indexer(tmp_path).build(docs)
    assert index.postings["alpha"]["DOC_001"] == [0, 2, 4]
    assert index.collection_frequency("alpha") == 3
    assert index.document_frequency("alpha") == 1
