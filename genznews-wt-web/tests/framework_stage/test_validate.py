from framework_stage.models import Claim, GeneratedArticle
from framework_stage.validate import ungrounded_facts, validate_article

SOURCE = "Mumbai police arrested 12 people on Monday. The city saw 3.5 lakh visitors in 2024."
TLDR = ["one", "two", "three"]


def make(**kw: object) -> GeneratedArticle:
    base: dict[str, object] = dict(
        title="Mumbai arrests",
        slug="mumbai-arrests",
        summary="Police made arrests.",
        body_md="Police arrested 12 people in Mumbai.",
        framework="PAS",
        content_type="GENERAL_NEWS",
        category="news",
        tags=["mumbai"],
        seo_title="Mumbai arrests",
        seo_description="Police made arrests.",
        keywords=["mumbai"],
        claims=[],
    )
    base.update(kw)
    return GeneratedArticle(**base)  # type: ignore[arg-type]


def test_em_dash_in_body_is_hard_fail() -> None:
    r = validate_article(make(body_md="Police — arrested 12 people."), SOURCE, TLDR)
    assert r.hard_fail and not r.passed and "EM_DASH" in r.flags


def test_em_dash_in_tag_is_hard_fail() -> None:
    r = validate_article(make(tags=["a–b"]), SOURCE, TLDR)
    assert r.hard_fail and "EM_DASH" in r.flags


def test_double_hyphen_is_hard_fail() -> None:
    r = validate_article(make(summary="wait -- what"), SOURCE, TLDR)
    assert "EM_DASH" in r.flags


def test_em_dash_in_claim_source_quote_is_not_hard_fail() -> None:
    src = SOURCE + " He said — quietly — no."
    c = Claim(text="He spoke", source_quote="He said — quietly")
    r = validate_article(make(claims=[c]), src, TLDR)
    assert not r.hard_fail and not any(f.startswith("CLAIM_QUOTE") for f in r.flags)


def test_em_dash_in_claim_text_is_hard_fail() -> None:
    c = Claim(text="He — spoke", source_quote="Mumbai police")
    assert "EM_DASH" in validate_article(make(claims=[c]), SOURCE, TLDR).flags


def test_banned_phrase_is_hard_fail() -> None:
    r = validate_article(make(body_md="Let us delve into it in Mumbai."), SOURCE, TLDR)
    assert r.hard_fail and any(f.startswith("BANNED_PHRASE:") for f in r.flags)


def test_tldr_not_three_is_hard_fail() -> None:
    r = validate_article(make(), SOURCE, ["a", "b"])
    assert r.hard_fail and "TLDR_COUNT:2" in r.flags


def test_number_not_in_source_is_flagged_medium_risk() -> None:
    r = validate_article(make(body_md="Police arrested 45% of people in Mumbai."), SOURCE, TLDR)
    assert "UNGROUNDED_NUMBER:45" in r.flags and r.fact_risk == "MEDIUM" and r.passed


def test_unknown_capitalized_entity_is_flagged() -> None:
    out = ungrounded_facts("Police met Zorblax in Mumbai today.", SOURCE)
    assert "UNGROUNDED_ENTITY:Zorblax" in out
    assert "UNGROUNDED_ENTITY:Mumbai" not in out


def test_entity_at_sentence_start_is_not_flagged_when_common_word() -> None:
    out = ungrounded_facts("The police left. However, Mumbai stayed calm. This is it.", SOURCE)
    assert out == []


def test_claim_quote_missing_from_source_is_high_risk() -> None:
    c = Claim(text="x", source_quote="this quote is not in the source at all, really")
    r = validate_article(make(claims=[c]), SOURCE, TLDR)
    assert r.fact_risk == "HIGH" and any(f.startswith("CLAIM_QUOTE_MISSING:") for f in r.flags)


def test_three_or_more_ungrounded_items_is_high_risk() -> None:
    body = "Police arrested 99 people, 88 men and 77 women in Mumbai."
    assert validate_article(make(body_md=body), SOURCE, TLDR).fact_risk == "HIGH"


def test_clean_grounded_article_passes_low_risk_high_confidence() -> None:
    c = Claim(text="12 arrested", source_quote="arrested 12 people")
    r = validate_article(make(claims=[c]), SOURCE, TLDR)
    assert r.passed and r.fact_risk == "LOW" and r.confidence == 1.0 and r.flags == []


def test_confidence_drops_per_flag_and_never_below_zero() -> None:
    r = validate_article(make(body_md="Zorblax 11 22 33 44 55 66 77 Quxlen."), SOURCE, ["a"])
    assert r.confidence == 0.0
    r1 = validate_article(make(), SOURCE, ["a"])
    assert abs(r1.confidence - 0.85) < 1e-9


def test_ungrounded_numbers_normalise_separators_and_dedupe() -> None:
    out = ungrounded_facts("Sales hit 1,200 and 1,200 and 45.5 in 2031.", "sales 1200 units")
    assert out == ["UNGROUNDED_NUMBER:45.5", "UNGROUNDED_NUMBER:2031"]


def test_possessive_entity_matches_source_base_word() -> None:
    assert ungrounded_facts("We saw Mumbai's streets.", SOURCE) == []


S2 = (
    "Mumbai police arrested 12 people on Monday. Rs 5,000 crore was spent. "
    "Chief Minister Fadnavis said 45 percent agreed. See https://x.com/a/2024/05. "
    "The 3rd match began at 9:30."
)


def test_sentence_initial_fabricated_entity_is_flagged() -> None:
    assert ungrounded_facts("Zorblax said the plan failed.", S2) == ["UNGROUNDED_ENTITY:Zorblax"]


def test_sentence_initial_ungrounded_place_flagged_grounded_word_not() -> None:
    assert ungrounded_facts("Delhi Police said so.", S2) == ["UNGROUNDED_ENTITY:Delhi"]


def test_stopword_openers_and_grounded_names_not_flagged() -> None:
    assert ungrounded_facts("The plan failed. However, Mumbai police disagreed.", S2) == []


def test_markdown_rules_and_table_separators_are_not_em_dashes() -> None:
    body = "Police arrested 12 people in Mumbai.\n\n---\n\n|---|---|\n| :--- | ---: |\n***\n"
    r = validate_article(make(body_md=body), SOURCE, TLDR)
    assert "EM_DASH" not in r.flags and not r.hard_fail


def test_real_dashes_in_prose_still_hard_fail_next_to_rules() -> None:
    for bad in ("word -- word", "word—word", "word–word", "--"):
        body = f"Police arrested 12 people in Mumbai.\n\n---\n\n{bad}\n"
        r = validate_article(make(body_md=body), SOURCE, TLDR)
        assert "EM_DASH" in r.flags and r.hard_fail, bad
