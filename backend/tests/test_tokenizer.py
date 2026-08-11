from app.bsbi.tokenizer import PorterStemmer, Tokenizer


def test_split_strips_punctuation_and_preserves_case():
    """Case is folded in normalize(), not split(), so case_sensitive works."""
    tokenizer = Tokenizer(use_stop_words=False, use_stemming=False)
    assert tokenizer.split("Machine learning, is POWERFUL!") == [
        "Machine", "learning", "is", "POWERFUL",
    ]


def test_case_insensitive_is_the_default():
    tokenizer = Tokenizer(use_stop_words=False, use_stemming=False)
    assert [t.term for t in tokenizer.tokenize("Machine machine MACHINE")] == [
        "machine", "machine", "machine",
    ]


def test_case_sensitive_keeps_distinct_terms():
    tokenizer = Tokenizer(use_stop_words=False, use_stemming=False, case_sensitive=True)
    terms = [t.term for t in tokenizer.tokenize("Machine machine")]
    assert terms == ["Machine", "machine"]
    assert len(set(terms)) == 2


def test_case_sensitive_still_stems_and_drops_stop_words():
    tokenizer = Tokenizer(use_stop_words=True, use_stemming=True, case_sensitive=True)
    terms = [t.term for t in tokenizer.tokenize("The Learning learns")]
    assert "The" not in terms
    assert terms == ["Learn", "learn"]


def test_stop_words_are_removed():
    tokenizer = Tokenizer(use_stop_words=True, use_stemming=False)
    terms = [t.term for t in tokenizer.tokenize("machine learning is a powerful tool")]
    assert "is" not in terms and "a" not in terms
    assert terms == ["machine", "learning", "powerful", "tool"]


def test_positions_account_for_removed_stop_words():
    """Positions index the raw token stream, so phrase search stays correct."""
    tokenizer = Tokenizer(use_stop_words=True, use_stemming=False)
    tokens = tokenizer.tokenize("the machine learning model")
    assert [(t.term, t.position) for t in tokens] == [
        ("machine", 1), ("learning", 2), ("model", 3),
    ]


def test_stemming_collapses_related_words():
    stemmer = PorterStemmer()
    assert stemmer.stem("learning") == stemmer.stem("learned") == "learn"
    assert stemmer.stem("indexes") == stemmer.stem("index")
    assert stemmer.stem("running") == "run"


def test_stemmer_leaves_short_words_alone():
    stemmer = PorterStemmer()
    assert stemmer.stem("is") == "is"
    assert stemmer.stem("bm25") == "bm25"


def test_explain_reports_dropped_tokens():
    tokenizer = Tokenizer(use_stop_words=True, use_stemming=False)
    result = tokenizer.explain("Machine learning is powerful.")
    assert result["raw"] == ["Machine", "learning", "is", "powerful"]
    assert result["kept"] == ["machine", "learning", "powerful"]
    assert result["removed"] == ["is"]


def test_query_tokenization_matches_document_tokenization():
    tokenizer = Tokenizer()
    doc_terms = {t.term for t in tokenizer.tokenize("Learning algorithms are useful")}
    assert set(tokenizer.tokenize_query("learning algorithm")) <= doc_terms
