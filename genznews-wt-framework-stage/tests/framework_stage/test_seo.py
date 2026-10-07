from framework_stage.models import GeneratedArticle
from framework_stage.seo import build_seo, slugify, truncate_at_word, unique_slug


def _article(**kw: object) -> GeneratedArticle:
    data: dict[str, object] = dict(
        title="A Title",
        slug="a-title",
        summary="s",
        body_md="b",
        framework="f",
        content_type="GENERAL_NEWS",
        category="tech",
        seo_title="T",
        seo_description="D",
    )
    data.update(kw)
    return GeneratedArticle(**data)  # type: ignore[arg-type]


def test_slugify_lowercases_and_hyphenates():
    assert slugify("Hello World, Again!") == "hello-world-again"


def test_slugify_strips_em_dashes_and_accents():
    assert slugify("Café — Résumé – x -- y") == "cafe-resume-x-y"


def test_unique_slug_appends_suffix_on_collision():
    taken = {"base", "base-2"}
    assert unique_slug("base", lambda s: s in taken) == "base-3"
    assert unique_slug("base", lambda s: False) == "base"
    assert unique_slug("base", lambda s: s == "base") == "base-2"


def test_truncate_at_word_never_exceeds_limit_or_cuts_a_word():
    text = "alpha beta gamma delta epsilon"
    for limit in range(0, 40):
        out = truncate_at_word(text, limit)
        assert len(out) <= limit
        assert out == "" or text.startswith(out)
        assert out == "" or text == out or text[len(out)] == " "
    assert truncate_at_word("short", 10) == "short"
    assert truncate_at_word("supercalifragilistic", 5) == ""


def test_description_is_at_most_155_chars():
    desc = "word " * 60 + "— end"
    out = build_seo(_article(seo_description=desc), lambda s: False)
    assert len(out.seo_description) <= 155
    assert "—" not in out.seo_description
    assert not out.seo_description.endswith(" ")


def test_seo_title_limit_and_no_dashes():
    out = build_seo(_article(seo_title="Big — news – today -- " + "x " * 50), lambda s: False)
    assert len(out.seo_title) <= 60
    for d in ("—", "–", "--"):
        assert d not in out.seo_title


def test_build_seo_unique_slug_and_empty_slug_fallback():
    out = build_seo(_article(slug="a-title"), lambda s: s == "a-title")
    assert out.slug == "a-title-2"
    out = build_seo(_article(slug="", title="Fresh Title"), lambda s: False)
    assert out.slug == "fresh-title"


def test_slug_never_empty():
    out = build_seo(_article(slug="", title="!!! ???"), lambda s: False)
    assert out.slug == "article"
    assert slugify("***") == "article"
