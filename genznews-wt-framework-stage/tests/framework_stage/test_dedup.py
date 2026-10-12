import pytest

from framework_stage.dedup import find_duplicate, fingerprint, hamming, simhash64
from framework_stage.models import KnownArticle, SourceArticle
from framework_stage.normalize import normalize_title

KW = {"title_jaccard_min": 0.5, "simhash_max_distance": 6}

EV_BODY = (
    "The central government on Monday announced a new subsidy scheme for electric "
    "vehicles aimed at cutting prices for first time buyers across the country."
)
CRICKET_BODY = (
    "India beat Australia by five wickets in the final at Ahmedabad after a late "
    "partnership between the middle order batters sealed the trophy for the hosts."
)


def art(url_hash: str, title: str | None, content: str) -> SourceArticle:
    return SourceArticle(
        url_hash=url_hash,
        source_url=f"https://example.com/{url_hash}",
        domain="example.com",
        original_title=title,
        original_content=content,
    )


def known(a: SourceArticle, cluster_id: str | None = None) -> KnownArticle:
    return KnownArticle(
        url_hash=a.url_hash,
        cluster_id=cluster_id or a.url_hash,
        fingerprint=fingerprint(a),
    )


def test_same_url_hash_is_exact():
    a = art("u1", "Govt launches new EV subsidy scheme", EV_BODY)
    b = art("u1", "Something else", CRICKET_BODY)
    r = find_duplicate(b, [known(a, "c1")], **KW)
    assert (r.kind, r.cluster_id, r.primary_url_hash) == ("EXACT", "c1", "u1")


def test_same_content_different_url_is_exact():
    a = art("u1", "Title one", EV_BODY)
    b = art("u2", "Totally different words", "  " + EV_BODY.upper() + "\n")
    r = find_duplicate(b, [known(a, "c1")], **KW)
    assert (r.kind, r.cluster_id, r.primary_url_hash) == ("EXACT", "c1", "u1")


def test_same_event_different_headlines_is_possible_same_story():
    # Title-only match (bodies differ): flagged for review, never archived.
    a = art("u1", "Govt launches new EV subsidy scheme", EV_BODY)
    b = art("u2", "New EV subsidy scheme launched by govt", CRICKET_BODY)
    r = find_duplicate(b, [known(a, "c1")], **KW)
    assert r.kind == "POSSIBLE_SAME_STORY"


def test_unrelated_articles_are_unique():
    a = art("u1", "Govt launches new EV subsidy scheme", EV_BODY)
    b = art("u2", "India win final in Ahmedabad", CRICKET_BODY)
    r = find_duplicate(b, [known(a, "c1")], **KW)
    assert r.kind == "UNIQUE"


def test_possible_same_story_returns_existing_cluster_id():
    a = art("u1", "Govt launches new EV subsidy scheme", EV_BODY)
    b = art("u2", "New EV subsidy scheme launched by govt", CRICKET_BODY)
    r = find_duplicate(b, [known(a, "cluster-x")], **KW)
    assert r.kind == "POSSIBLE_SAME_STORY"
    assert r.cluster_id == "cluster-x"
    assert r.primary_url_hash == "u1"


def test_unique_gets_new_cluster_id_equal_to_its_url_hash():
    b = art("u2", "India win final in Ahmedabad", CRICKET_BODY)
    r = find_duplicate(b, [], **KW)
    assert r.kind == "UNIQUE"
    assert r.cluster_id == "u2"
    assert r.primary_url_hash is None


def test_simhash_identical_text_distance_zero():
    assert hamming(simhash64(EV_BODY), simhash64(EV_BODY)) == 0
    assert hamming(simhash64(EV_BODY), simhash64(CRICKET_BODY)) > 6


def test_normalize_title_ignores_case_and_punctuation():
    assert normalize_title("Govt: Launches NEW EV Scheme!") == normalize_title(
        "govt launches new ev scheme"
    )


def test_short_titles_never_merge_by_jaccard_alone():
    a = art("u1", "Breaking", EV_BODY)
    b = art("u2", "Breaking!", CRICKET_BODY)
    assert find_duplicate(b, [known(a)], **KW).kind == "UNIQUE"
    c = art("u3", "The", CRICKET_BODY + " x")
    d = art("u4", "A", EV_BODY + " y")
    assert find_duplicate(d, [known(c)], **KW).kind == "UNIQUE"


def test_empty_content_not_merged():
    a = art("u1", "Alpha beta gamma", "")
    b = art("u2", "Delta epsilon zeta", "")
    assert find_duplicate(b, [known(a)], **KW).kind == "UNIQUE"


RAIN_BODY = (
    "Heavy rain lashed the city on Tuesday, waterlogging low lying roads and slowing "
    "suburban trains while the weather office warned of more showers through the week."
)
OTHER_BODY = (
    "A local school opened a new science lab funded by alumni donations, giving students "
    "access to microscopes, a small telescope and updated chemistry kits."
)


@pytest.mark.parametrize(
    "t1,t2",
    [
        ("Heavy rain lashes Mumbai, IMD issues orange alert",
         "Heavy rain lashes Chennai, IMD issues orange alert"),
        ("Gold price today in Delhi", "Gold price today in Mumbai"),
        ("India beat Australia in final", "India beat Pakistan in final"),
        ("Govt launches new EV subsidy scheme", "New EV subsidy scheme launched by govt"),
    ],
)
def test_title_only_matches_are_possible_same_story(t1, t2):
    # Different stories: the bodies share no content, only the headline shape.
    a = art("u1", t1, RAIN_BODY)
    b = art("u2", t2, OTHER_BODY)
    assert hamming(simhash64(RAIN_BODY), simhash64(OTHER_BODY)) > KW["simhash_max_distance"]
    r = find_duplicate(b, [known(a, "cl-a")], **KW)
    assert r.kind == "POSSIBLE_SAME_STORY"
    assert (r.cluster_id, r.primary_url_hash) == ("cl-a", "u1")


def test_simhash_close_pair_with_different_titles_is_same_story():
    a = art("u1", "Govt launches new EV subsidy scheme", EV_BODY)
    b = art("u2", "Cricket heroes celebrate in Ahmedabad", "Reports: " + EV_BODY)
    r = find_duplicate(b, [known(a, "cl-a")], **KW)
    assert (r.kind, r.cluster_id, r.primary_url_hash) == ("SAME_STORY", "cl-a", "u1")


def test_precedence_exact_over_same_story_over_possible():
    target = art("t", "Govt launches new EV subsidy scheme", EV_BODY)
    title_only = art("p1", "New EV subsidy scheme launched by govt", OTHER_BODY)
    near = art("p2", "Unrelated words entirely here", "Reports: " + EV_BODY)
    exact = art("p3", "Something else again", EV_BODY)
    r = find_duplicate(target, [known(title_only), known(near), known(exact)], **KW)
    assert (r.kind, r.primary_url_hash) == ("EXACT", "p3")
    r = find_duplicate(target, [known(title_only), known(near)], **KW)
    assert (r.kind, r.primary_url_hash) == ("SAME_STORY", "p2")
    r = find_duplicate(target, [known(title_only)], **KW)
    assert (r.kind, r.primary_url_hash) == ("POSSIBLE_SAME_STORY", "p1")
