"""BM25 (Okapi) ranking over the BSBI inverted index."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..bsbi.indexer import InvertedIndex


@dataclass
class TermContribution:
    term: str
    term_frequency: int
    document_frequency: int
    idf: float
    contribution: float


@dataclass
class ScoredDocument:
    document_id: str
    score: float
    matched_terms: list[str] = field(default_factory=list)
    term_details: list[TermContribution] = field(default_factory=list)
    doc_length: int = 0
    positions: dict[str, list[int]] = field(default_factory=dict)


class BM25Ranker:
    """Standard BM25 with the usual k1/b parameters.

    score(q, d) = sum over query terms of
        idf(t) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * |d| / avgdl))

    k1 damps term frequency (a term appearing 20x is not 20x as relevant),
    b controls length normalisation (long documents are not relevant just for
    being long).
    """

    def __init__(self, index: InvertedIndex, *, k1: float = 1.2, b: float = 0.75) -> None:
        self.index = index
        self.k1 = k1
        self.b = b

    def idf(self, term: str) -> float:
        """Probabilistic IDF with the +0.5 smoothing, floored at 0."""
        n = self.index.num_docs
        df = self.index.document_frequency(term)
        if df == 0:
            return 0.0
        value = math.log(1 + (n - df + 0.5) / (df + 0.5))
        return max(0.0, value)

    def candidates(self, terms: list[str], mode: str = "all") -> set[str]:
        """Candidate documents for a query, by retrieval mode.

        all     union — rank every document containing at least one term.
                This is the default relevance retrieval mode.
        or      union — the Boolean OR of the postings lists. Same candidate
                set as `all`; kept separate so the Boolean modes read as a
                complete set alongside AND.
        and     intersection — a document must contain *every* query term.
        phrase  intersection, then a positional adjacency check in `rank`.

        A term that is absent from the vocabulary has an empty postings list.
        For AND and PHRASE that makes the whole query empty (correct: the
        document cannot contain a term the collection has never seen), while
        for ALL and OR it simply contributes nothing.
        """
        posting_sets = [set(self.index.postings.get(term, {}).keys()) for term in terms]

        if mode in ("and", "phrase"):
            if not posting_sets or any(not s for s in posting_sets):
                return set()
            result = set(posting_sets[0])
            for s in posting_sets[1:]:
                result &= s
            return result

        non_empty = [s for s in posting_sets if s]
        if not non_empty:
            return set()
        return set().union(*non_empty)

    def score_document(self, doc_id: str, terms: list[str]) -> ScoredDocument:
        avgdl = self.index.avg_doc_length or 1.0
        doc_len = self.index.doc_lengths.get(doc_id, 0)
        total = 0.0
        matched: list[str] = []
        details: list[TermContribution] = []
        positions: dict[str, list[int]] = {}

        for term in terms:
            postings = self.index.postings.get(term, {})
            tf = len(postings.get(doc_id, []))
            if tf == 0:
                continue
            matched.append(term)
            positions[term] = postings[doc_id]
            idf = self.idf(term)
            denominator = tf + self.k1 * (1 - self.b + self.b * doc_len / avgdl)
            contribution = idf * (tf * (self.k1 + 1)) / denominator
            total += contribution
            details.append(
                TermContribution(
                    term=term,
                    term_frequency=tf,
                    document_frequency=self.index.document_frequency(term),
                    idf=round(idf, 4),
                    contribution=round(contribution, 4),
                )
            )

        return ScoredDocument(
            document_id=doc_id,
            score=round(total, 4),
            matched_terms=matched,
            term_details=sorted(details, key=lambda d: -d.contribution),
            doc_length=doc_len,
            positions=positions,
        )

    def rank(
        self, terms: list[str], *, mode: str = "all", limit: int | None = None
    ) -> list[ScoredDocument]:
        """Retrieve candidates by mode, then rank them all with BM25."""
        if not terms:
            return []
        scored = [
            self.score_document(doc_id, terms)
            for doc_id in self.candidates(terms, mode)
        ]
        scored = [s for s in scored if s.matched_terms]
        if mode in ("and", "phrase"):
            # Defensive: candidate intersection already guarantees this.
            scored = [s for s in scored if len(set(s.matched_terms)) == len(set(terms))]
        if mode == "phrase":
            scored = [s for s in scored if self._has_phrase(s, terms)]
        scored.sort(key=lambda s: (-s.score, s.document_id))
        return scored if limit is None else scored[:limit]

    @staticmethod
    def _has_phrase(doc: ScoredDocument, terms: list[str]) -> bool:
        """True when the query terms occur consecutively, in order."""
        if len(terms) < 2:
            return True
        first_positions = doc.positions.get(terms[0], [])
        for start in first_positions:
            if all(
                (start + offset) in doc.positions.get(term, [])
                for offset, term in enumerate(terms)
            ):
                return True
        return False
