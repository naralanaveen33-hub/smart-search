"""Lightweight tokenization: split -> normalize -> stop words -> stemming.

Deliberately dependency-free so the pipeline is fully inspectable (and so the
"How It Works" screen can show every intermediate stage).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*")

STOP_WORDS: frozenset[str] = frozenset(
    """
a about above after again against all am an and any are aren't as at be because been
before being below between both but by can't cannot could couldn't did didn't do does
doesn't doing don't down during each few for from further had hadn't has hasn't have
haven't having he he'd he'll he's her here here's hers herself him himself his how
how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most
mustn't my myself no nor not of off on once only or other ought our ours ourselves out
over own same shan't she she'd she'll she's should shouldn't so some such than that
that's the their theirs them themselves then there there's these they they'd they'll
they're they've this those through to too under until up very was wasn't we we'd we'll
we're we've were weren't what what's when when's where where's which while who who's
whom why why's with won't would wouldn't you you'd you'll you're you've your yours
yourself yourselves
""".split()
)


@dataclass(frozen=True)
class Token:
    """A single normalized term with its position in the source document."""

    term: str
    position: int
    raw: str


class PorterStemmer:
    """Compact implementation of the Porter stemming algorithm (steps 1-5)."""

    VOWELS = "aeiou"

    def _is_consonant(self, word: str, i: int) -> bool:
        ch = word[i]
        if ch in self.VOWELS:
            return False
        if ch == "y":
            return i == 0 or not self._is_consonant(word, i - 1)
        return True

    def _measure(self, stem: str) -> int:
        """Number of vowel-consonant sequences in `stem`."""
        count = 0
        i = 0
        n = len(stem)
        while i < n and self._is_consonant(stem, i):
            i += 1
        while i < n:
            while i < n and not self._is_consonant(stem, i):
                i += 1
            if i >= n:
                break
            count += 1
            while i < n and self._is_consonant(stem, i):
                i += 1
        return count

    def _has_vowel(self, stem: str) -> bool:
        return any(not self._is_consonant(stem, i) for i in range(len(stem)))

    def _double_consonant_suffix(self, word: str) -> bool:
        return (
            len(word) >= 2
            and word[-1] == word[-2]
            and self._is_consonant(word, len(word) - 1)
        )

    def _cvc(self, word: str) -> bool:
        if len(word) < 3:
            return False
        if not (
            self._is_consonant(word, len(word) - 3)
            and not self._is_consonant(word, len(word) - 2)
            and self._is_consonant(word, len(word) - 1)
        ):
            return False
        return word[-1] not in "wxy"

    def _replace(self, word: str, suffix: str, repl: str, min_measure: int) -> str | None:
        if not word.endswith(suffix):
            return None
        stem = word[: len(word) - len(suffix)]
        if self._measure(stem) > min_measure:
            return stem + repl
        return word

    def stem(self, word: str) -> str:
        if len(word) <= 2:
            return word

        # Step 1a
        if word.endswith("sses"):
            word = word[:-2]
        elif word.endswith("ies"):
            word = word[:-2]
        elif word.endswith("ss"):
            pass
        elif word.endswith("s"):
            word = word[:-1]

        # Step 1b
        if word.endswith("eed"):
            if self._measure(word[:-3]) > 0:
                word = word[:-1]
        else:
            changed = False
            for suffix in ("ed", "ing"):
                if word.endswith(suffix):
                    stem = word[: len(word) - len(suffix)]
                    if self._has_vowel(stem):
                        word = stem
                        changed = True
                    break
            if changed:
                if word.endswith(("at", "bl", "iz")):
                    word += "e"
                elif self._double_consonant_suffix(word) and not word.endswith(
                    ("l", "s", "z")
                ):
                    word = word[:-1]
                elif self._measure(word) == 1 and self._cvc(word):
                    word += "e"

        # Step 1c
        if word.endswith("y") and self._has_vowel(word[:-1]):
            word = word[:-1] + "i"

        step2 = {
            "ational": "ate", "tional": "tion", "enci": "ence", "anci": "ance",
            "izer": "ize", "abli": "able", "alli": "al", "entli": "ent",
            "eli": "e", "ousli": "ous", "ization": "ize", "ation": "ate",
            "ator": "ate", "alism": "al", "iveness": "ive", "fulness": "ful",
            "ousness": "ous", "aliti": "al", "iviti": "ive", "biliti": "ble",
        }
        for suffix, repl in step2.items():
            result = self._replace(word, suffix, repl, 0)
            if result is not None:
                word = result
                break

        step3 = {
            "icate": "ic", "ative": "", "alize": "al", "iciti": "ic",
            "ical": "ic", "ful": "", "ness": "",
        }
        for suffix, repl in step3.items():
            result = self._replace(word, suffix, repl, 0)
            if result is not None:
                word = result
                break

        step4 = (
            "al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement",
            "ment", "ent", "ou", "ism", "ate", "iti", "ous", "ive", "ize",
        )
        for suffix in step4:
            if word.endswith(suffix):
                stem = word[: len(word) - len(suffix)]
                if suffix in ("ion",) and not stem.endswith(("s", "t")):
                    continue
                if self._measure(stem) > 1:
                    word = stem
                break
        if word.endswith("ion"):
            stem = word[:-3]
            if self._measure(stem) > 1 and stem.endswith(("s", "t")):
                word = stem

        # Step 5
        if word.endswith("e"):
            stem = word[:-1]
            measure = self._measure(stem)
            if measure > 1 or (measure == 1 and not self._cvc(stem)):
                word = stem
        if (
            self._measure(word) > 1
            and self._double_consonant_suffix(word)
            and word.endswith("l")
        ):
            word = word[:-1]

        return word


_STEMMER = PorterStemmer()


class Tokenizer:
    """Turns raw document text into positioned, normalized terms."""

    def __init__(
        self,
        *,
        use_stop_words: bool = True,
        use_stemming: bool = True,
        case_sensitive: bool = False,
    ) -> None:
        self.use_stop_words = use_stop_words
        self.use_stemming = use_stemming
        self.case_sensitive = case_sensitive

    def split(self, text: str) -> list[str]:
        """Stage 1 — raw split, before any normalization.

        Case is preserved here and folded (or not) in `normalize`, so that the
        case_sensitive setting actually changes the terms that reach the index.
        """
        return TOKEN_RE.findall(text)

    def normalize(self, token: str) -> str | None:
        """Stage 2 — normalize a single raw token. `None` means 'dropped'."""
        if not token:
            return None
        term = token if self.case_sensitive else token.lower()
        # Stop words are matched case-insensitively either way: "The" is as
        # much a stop word as "the".
        if self.use_stop_words and term.lower() in STOP_WORDS:
            return None
        if self.use_stemming:
            # The stemmer's suffix rules are defined on lowercase input. In
            # case-sensitive mode the original leading case is restored so
            # "Machine" and "machine" remain distinct terms.
            stemmed = _STEMMER.stem(term.lower())
            term = (
                stemmed[:1].upper() + stemmed[1:]
                if self.case_sensitive and term[:1].isupper()
                else stemmed
            )
        return term or None

    def tokenize(self, text: str) -> list[Token]:
        """Full pipeline: positioned tokens after normalization."""
        tokens: list[Token] = []
        position = 0
        for raw in self.split(text):
            term = self.normalize(raw)
            if term is not None:
                tokens.append(Token(term=term, position=position, raw=raw))
            position += 1
        return tokens

    def tokenize_query(self, query: str) -> list[str]:
        return [t.term for t in self.tokenize(query)]

    def explain(self, text: str) -> dict[str, list[str]]:
        """Intermediate stages, used by the How It Works screen."""
        raw = self.split(text)
        normalized = [self.normalize(t) for t in raw]
        return {
            "raw": raw,
            "kept": [t for t in normalized if t is not None],
            "removed": [r for r, n in zip(raw, normalized) if n is None],
        }
