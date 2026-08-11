import math

import pytest

from app.bsbi.indexer import BSBIIndexer, IndexDocument
from app.bsbi.tokenizer import Tokenizer
from app.ranking.bm25 import BM25Ranker
from app.ranking.snippets import build_snippet


async def build(tmp_path, docs):
    indexer = BSBIIndexer(
        blocks_dir=tmp_path / "blocks",
        index_path=tmp_path / "index.json",
        block_size=1000,
        tokenizer=Tokenizer(),
        step_delay=0,
    )
    return await indexer.build(docs)


@pytest.mark.asyncio
async def test_idf_is_higher_for_rarer_terms(tmp_path):
    docs = [
        IndexDocument("DOC_001", "a", "common term alpha"),
        IndexDocument("DOC_002", "b", "common term beta"),
        IndexDocument("DOC_003", "c", "common term gamma"),
    ]
    ranker = BM25Ranker(await build(tmp_path, docs))
    assert ranker.idf("alpha") > ranker.idf("common")
    assert ranker.idf("missing") == 0.0


@pytest.mark.asyncio
async def test_more_occurrences_rank_higher(tmp_path):
    docs = [
        IndexDocument("DOC_001", "a", "search search search engine ranking model"),
        IndexDocument("DOC_002", "b", "search engine ranking model overview text"),
    ]
    ranked = BM25Ranker(await build(tmp_path, docs)).rank(["search"])
    assert ranked[0].document_id == "DOC_001"
    assert ranked[0].score > ranked[1].score


@pytest.mark.asyncio
async def test_length_normalisation_prefers_the_shorter_document(tmp_path):
    filler = " ".join(f"filler{i}" for i in range(60))
    docs = [
        IndexDocument("DOC_001", "short", "retrieval ranking"),
        IndexDocument("DOC_002", "long", f"retrieval ranking {filler}"),
    ]
    terms = Tokenizer().tokenize_query("retrieval")
    ranked = BM25Ranker(await build(tmp_path, docs)).rank(terms)
    assert ranked[0].document_id == "DOC_001"


@pytest.mark.asyncio
async def test_score_matches_the_bm25_formula(tmp_path):
    docs = [
        IndexDocument("DOC_001", "a", "alpha alpha beta"),
        IndexDocument("DOC_002", "b", "beta gamma delta"),
    ]
    index = await build(tmp_path, docs)
    ranker = BM25Ranker(index, k1=1.2, b=0.75)

    tf = 2
    doc_len = index.doc_lengths["DOC_001"]
    avgdl = index.avg_doc_length
    df = index.document_frequency("alpha")
    n = index.num_docs
    idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
    expected = idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * doc_len / avgdl))

    assert ranker.score_document("DOC_001", ["alpha"]).score == pytest.approx(
        round(expected, 4), abs=1e-3
    )


@pytest.mark.asyncio
async def test_and_mode_requires_every_term(tmp_path):
    docs = [
        IndexDocument("DOC_001", "a", "machine learning models"),
        IndexDocument("DOC_002", "b", "machine tooling hardware"),
    ]
    ranker = BM25Ranker(await build(tmp_path, docs))
    terms = ["machin", "learn"]
    assert {d.document_id for d in ranker.rank(terms, mode="and")} == {"DOC_001"}
    assert {d.document_id for d in ranker.rank(terms, mode="or")} == {"DOC_001", "DOC_002"}


@pytest.mark.asyncio
async def test_retrieval_modes_are_ordered_or_ge_all_ge_and(tmp_path):
    """OR ⊇ ALL ⊇ AND on a corpus that distinguishes them."""
    docs = [
        IndexDocument("DOC_001", "both", "machine learning is powerful"),
        IndexDocument("DOC_002", "one", "machine tooling and hardware"),
        IndexDocument("DOC_003", "other", "learning to read is useful"),
        IndexDocument("DOC_004", "neither", "completely unrelated content here"),
    ]
    index = await build(tmp_path, docs)
    ranker = BM25Ranker(index)
    terms = Tokenizer().tokenize_query("machine learning")

    results = {
        mode: {d.document_id for d in ranker.rank(terms, mode=mode)}
        for mode in ("or", "all", "and")
    }

    assert len(results["or"]) >= len(results["all"]) >= len(results["and"])
    assert results["and"] < results["all"], "AND must be a strict subset here"
    assert results["and"] == {"DOC_001"}
    assert results["or"] == {"DOC_001", "DOC_002", "DOC_003"}
    assert "DOC_004" not in results["or"]


@pytest.mark.asyncio
async def test_and_excludes_documents_missing_any_query_term(tmp_path):
    docs = [
        IndexDocument("DOC_001", "a", "alpha beta gamma"),
        IndexDocument("DOC_002", "b", "alpha beta"),
        IndexDocument("DOC_003", "c", "alpha gamma"),
    ]
    ranker = BM25Ranker(await build(tmp_path, docs))
    matched = {d.document_id for d in ranker.rank(["alpha", "beta", "gamma"], mode="and")}
    assert matched == {"DOC_001"}

    for doc in ranker.rank(["alpha", "beta", "gamma"], mode="and"):
        assert set(doc.matched_terms) == {"alpha", "beta", "gamma"}


@pytest.mark.asyncio
async def test_and_is_empty_when_a_term_is_not_in_the_vocabulary(tmp_path):
    docs = [IndexDocument("DOC_001", "a", "alpha beta gamma")]
    ranker = BM25Ranker(await build(tmp_path, docs))
    assert ranker.candidates(["alpha", "zzzmissing"], "and") == set()
    assert ranker.rank(["alpha", "zzzmissing"], mode="and") == []
    # OR still returns the documents that match the terms it does know.
    assert {d.document_id for d in ranker.rank(["alpha", "zzzmissing"], mode="or")} == {
        "DOC_001"
    }


@pytest.mark.asyncio
async def test_all_and_or_share_a_candidate_set_but_rank_identically(tmp_path):
    docs = [
        IndexDocument("DOC_001", "a", "machine learning is powerful"),
        IndexDocument("DOC_002", "b", "machine tooling and hardware"),
    ]
    ranker = BM25Ranker(await build(tmp_path, docs))
    terms = Tokenizer().tokenize_query("machine learning")

    assert ranker.candidates(terms, "all") == ranker.candidates(terms, "or")
    all_ranked = ranker.rank(terms, mode="all")
    or_ranked = ranker.rank(terms, mode="or")
    assert [(d.document_id, d.score) for d in all_ranked] == [
        (d.document_id, d.score) for d in or_ranked
    ]


@pytest.mark.asyncio
async def test_phrase_mode_requires_adjacent_terms(tmp_path):
    docs = [
        IndexDocument("DOC_001", "a", "machine learning is powerful"),
        IndexDocument("DOC_002", "b", "learning about the machine takes time"),
    ]
    ranker = BM25Ranker(await build(tmp_path, docs))
    matches = ranker.rank(["machin", "learn"], mode="phrase")
    assert {d.document_id for d in matches} == {"DOC_001"}


@pytest.mark.asyncio
async def test_term_contributions_are_reported(tmp_path):
    docs = [IndexDocument("DOC_001", "a", "ranking function ranking model")]
    scored = BM25Ranker(await build(tmp_path, docs)).score_document(
        "DOC_001", ["rank", "model"]
    )
    assert {d.term for d in scored.term_details} == {"rank", "model"}
    assert scored.term_details[0].contribution >= scored.term_details[-1].contribution
    assert scored.score == pytest.approx(
        sum(d.contribution for d in scored.term_details), abs=1e-3
    )


@pytest.mark.asyncio
async def test_empty_query_returns_nothing(tmp_path):
    docs = [IndexDocument("DOC_001", "a", "anything at all")]
    assert BM25Ranker(await build(tmp_path, docs)).rank([]) == []


def test_snippet_centres_on_the_match_and_reports_surface_forms():
    text = (
        "Introduction paragraph with unrelated filler text. " * 4
        + "The machine learning model was trained on data."
    )
    snippet, forms = build_snippet(text, ["machin", "learn"], Tokenizer())
    assert "machine learning" in snippet.lower()
    assert set(forms) == {"machine", "learning"}


def test_snippet_falls_back_to_the_document_start():
    snippet, forms = build_snippet("no matching content here", ["zzz"], Tokenizer())
    assert snippet.startswith("no matching")
    assert forms == []
