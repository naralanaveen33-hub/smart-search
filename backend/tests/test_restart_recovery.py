"""A restarted backend must still be able to explain the index it loaded.

The index survives in index.json and the blocks survive as TSV files, but the
in-memory block metadata does not — it has to be rebuilt from disk on startup.
"""

from __future__ import annotations

import pytest

from app.services.engine import SwiftSearchEngine


async def build_index(engine: SwiftSearchEngine, **kwargs) -> None:
    kwargs.setdefault("block_size", 150)
    kwargs.setdefault("step_delay", 0)
    await engine.start_indexing(**kwargs)
    assert engine._task is not None
    await engine._task
    assert engine.state == "completed", engine.last_error


@pytest.mark.asyncio
async def test_blocks_are_rediscovered_by_a_fresh_engine(temp_data_dir):
    builder = SwiftSearchEngine(temp_data_dir)
    builder.bootstrap()
    await build_index(builder)

    original = [b.to_dict() for b in builder.indexer.store.blocks]
    assert len(original) >= 2, "need several blocks for this to be meaningful"

    # Simulate a process restart: nothing carries over but the files on disk.
    restarted = SwiftSearchEngine(temp_data_dir)
    assert restarted.indexer.store.blocks == []
    restarted.bootstrap()

    recovered = [b.to_dict() for b in restarted.indexer.store.blocks]
    assert len(recovered) == len(original)
    for before, after in zip(original, recovered):
        assert after["id"] == before["id"]
        assert after["entries"] == before["entries"]
        assert after["size_bytes"] == before["size_bytes"]
        assert after["first_term"] == before["first_term"]
        assert after["last_term"] == before["last_term"]


@pytest.mark.asyncio
async def test_block_contents_are_readable_after_restart(temp_data_dir):
    builder = SwiftSearchEngine(temp_data_dir)
    builder.bootstrap()
    await build_index(builder)

    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()

    first = restarted.indexer.store.blocks[0]
    entries = restarted.indexer.store.preview(first.id, limit=500)
    assert entries, "block drill-down must work after a restart"
    terms = [term for term, _, _ in entries]
    assert terms == sorted(terms)


@pytest.mark.asyncio
async def test_restart_reports_blocks_in_the_status_payload(temp_data_dir):
    builder = SwiftSearchEngine(temp_data_dir)
    builder.bootstrap()
    await build_index(builder)
    expected = len(builder.indexer.store.blocks)

    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()
    status = restarted.status()

    assert status["state"] == "completed"
    assert status["index_ready"] is True
    assert len(status["blocks"]) == expected
    assert status["stats"]["blocks_created"] == expected
    assert status["stats"]["avg_block_size"] > 0


@pytest.mark.asyncio
async def test_restart_without_an_index_reports_nothing(temp_data_dir):
    engine = SwiftSearchEngine(temp_data_dir)
    engine.bootstrap()
    status = engine.status()
    assert status["state"] == "idle"
    assert status["blocks"] == []


@pytest.mark.asyncio
async def test_search_still_works_after_restart(temp_data_dir):
    builder = SwiftSearchEngine(temp_data_dir)
    builder.bootstrap()
    await build_index(builder)
    before = builder.search("machine learning")

    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()
    after = restarted.search("machine learning")

    assert after["total"] == before["total"]
    assert [r["document_id"] for r in after["results"]] == [
        r["document_id"] for r in before["results"]
    ]
    assert [r["score"] for r in after["results"]] == [
        r["score"] for r in before["results"]
    ]


@pytest.mark.asyncio
async def test_changing_settings_does_not_discard_recovered_state(temp_data_dir):
    """Settings rebuild the indexer; the recovered index state must survive.

    Regression: updating any setting replaced the indexer with a fresh one,
    silently emptying the block list and the peak-usage statistics restored at
    startup.
    """
    builder = SwiftSearchEngine(temp_data_dir)
    builder.bootstrap()
    await build_index(builder)
    expected_blocks = len(builder.indexer.store.blocks)
    expected_peak = builder.indexer.stats["peak_memory_entries"]
    assert expected_peak > 0

    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()
    assert len(restarted.status()["blocks"]) == expected_blocks

    restarted.update_settings(
        dict(restarted.get_settings_payload(), results_per_page=25)
    )

    status = restarted.status()
    assert len(status["blocks"]) == expected_blocks, "blocks survived the settings change"
    assert status["stats"]["blocks_created"] == expected_blocks
    assert status["stats"]["peak_memory_entries"] == expected_peak
    assert status["stats"]["unique_terms"] == restarted.index.vocabulary_size
    assert restarted.analytics()["peak_memory_entries"] == expected_peak


@pytest.mark.asyncio
async def test_settings_change_after_a_run_keeps_run_statistics(temp_data_dir):
    engine = SwiftSearchEngine(temp_data_dir)
    engine.bootstrap()
    await build_index(engine)
    before = engine.analytics()

    engine.update_settings(dict(engine.get_settings_payload(), highlight_results=False))
    after = engine.analytics()

    assert after["blocks"] == before["blocks"]
    assert after["peak_memory_entries"] == before["peak_memory_entries"]
    assert after["unique_terms"] == before["unique_terms"]


@pytest.mark.asyncio
async def test_reset_clears_blocks_and_the_merged_run(temp_data_dir):
    engine = SwiftSearchEngine(temp_data_dir)
    engine.bootstrap()
    await build_index(engine)

    merged = engine.indexer.store.merged_path
    assert merged.exists()

    engine.reset_index()
    assert engine.indexer.store.blocks == []
    assert not merged.exists()
    assert not list(temp_data_dir.blocks_dir.glob("block_*.tsv"))

    restarted = SwiftSearchEngine(temp_data_dir)
    restarted.bootstrap()
    assert restarted.status()["blocks"] == []
