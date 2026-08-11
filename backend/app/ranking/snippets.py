"""Snippet extraction with matched-term offsets for client-side highlighting."""

from __future__ import annotations

import re

from ..bsbi.tokenizer import Tokenizer

WORD_RE = re.compile(r"[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*")


def build_snippet(
    text: str,
    matched_terms: list[str],
    tokenizer: Tokenizer,
    *,
    window: int = 240,
) -> tuple[str, list[str]]:
    """Return a text window centred on the densest cluster of matches.

    Also returns the *surface forms* that matched, so the frontend highlights
    the words the user actually sees rather than the stemmed terms.
    """
    if not text:
        return "", []

    wanted = set(matched_terms)
    spans: list[tuple[int, int, str]] = []
    for match in WORD_RE.finditer(text):
        normalized = tokenizer.normalize(match.group(0))
        if normalized is not None and normalized in wanted:
            spans.append((match.start(), match.end(), match.group(0)))

    surface_forms = sorted({s[2].lower() for s in spans})

    if not spans:
        snippet = text[:window].strip()
        return snippet + ("…" if len(text) > window else ""), surface_forms

    # Pick the window containing the most matches.
    best_index, best_count = 0, 0
    for i, (start, _, _) in enumerate(spans):
        count = sum(1 for s, _, _ in spans if start <= s < start + window)
        if count > best_count:
            best_index, best_count = i, count

    centre = spans[best_index][0]
    start = max(0, centre - window // 3)
    end = min(len(text), start + window)

    # Snap to word boundaries so the snippet does not start mid-word.
    if start > 0:
        space = text.find(" ", start)
        start = space + 1 if 0 <= space < start + 30 else start
    if end < len(text):
        space = text.rfind(" ", start, end)
        end = space if space > start else end

    snippet = text[start:end].strip()
    if start > 0:
        snippet = "… " + snippet
    if end < len(text):
        snippet = snippet + " …"
    return snippet, surface_forms


def estimate_page(text: str, position: int, chars_per_page: int = 1800) -> int | None:
    """Rough page number for a character offset — only useful for long docs."""
    if len(text) <= chars_per_page:
        return None
    return position // chars_per_page + 1
