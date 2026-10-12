"""Editorial and grounding validation for generated articles."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

from framework_stage.models import GeneratedArticle, ValidationResult

_BANNED = Path(__file__).resolve().parent / "config" / "banned_phrases.json"

_DASH_RE = re.compile("—|–|--")
# Markdown structure, not prose: horizontal rules (---, ***, ___, "- - -") and
# table separator rows (|---|:---:|). These are never dash punctuation.
_HR_LINE_RE = re.compile(r"^\s*([-*_])(?:[ \t]*\1){2,}[ \t]*$")
_TABLE_SEP_RE = re.compile(r"^[ \t]*(?=[^\n]*\|)(?=[^\n]*-)[|:\- \t]+$")


def is_markdown_rule_line(line: str) -> bool:
    """True for a Markdown horizontal rule or table separator row."""
    return bool(_HR_LINE_RE.match(line) or _TABLE_SEP_RE.match(line))


def strip_markdown_rules(text: str) -> str:
    """Drop horizontal-rule and table-separator lines; keep everything else."""
    return "\n".join(ln for ln in text.split("\n") if not is_markdown_rule_line(ln))
_NUMBER_RE = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’]+")
_SKIP_CHARS = " \t\r\n*_#>-\"'([“‘`"

_STOPWORDS = frozenset(
    w.lower()
    for w in (
        "The A An This That These Those However Meanwhile Also He She It They We You I "
        "In On At As By For From With After Before During While When But And Or So If "
        "According Despite Although Because Since Still Then Now Today Yesterday Here "
        "There What Who How Why Both Many Some Most Several Officials Its His Her Their "
        "Our Of To Not No Yes Is Was Are Were Has Have Had Will Would Can Could Should "
        "Even Just Only Once Soon Later Earlier Instead Overall Another Each Every Other"
    ).split()
)


def _banned_phrases() -> list[str]:
    return json.loads(_BANNED.read_text(encoding="utf-8"))


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _strip_commas(text: str) -> str:
    return re.sub(r"(?<=\d),(?=\d{3})", "", text)


def _number_in(num: str, hay: str) -> bool:
    return re.search(rf"(?<![\d.]){re.escape(num)}(?!\d|\.\d)", hay) is not None


def _at_sentence_start(text: str, pos: int) -> bool:
    i = pos
    while i > 0 and text[i - 1] in _SKIP_CHARS:
        i -= 1
    if i == 0:
        return True
    if "\n" in text[i:pos]:
        return True
    return text[i - 1] in ".!?:;"


def ungrounded_facts(body: str, source: str) -> list[str]:
    src = _strip_commas(_norm(source))
    text = _strip_commas(body)
    out: list[str] = []
    for m in _NUMBER_RE.finditer(text):
        num = m.group(0)
        if not _number_in(num, src):
            out.append(f"UNGROUNDED_NUMBER:{num}")
    for m in _WORD_RE.finditer(text):
        word = re.sub(r"['\u2019]s?$", "", m.group(0))
        if not word[0].isupper():
            continue
        if word.lower() in _STOPWORDS and _at_sentence_start(text, m.start()):
            continue
        if re.search(rf"\b{re.escape(word.lower())}\b", src) is None:
            out.append(f"UNGROUNDED_ENTITY:{word}")
    return list(dict.fromkeys(out))


def _string_fields(g: GeneratedArticle) -> list[str]:
    return [
        g.title,
        g.summary,
        strip_markdown_rules(g.body_md),
        g.seo_title,
        g.seo_description,
        *g.tags,
        *g.keywords,
        *(c.text for c in g.claims),
    ]


def validate_article(
    generated: GeneratedArticle, source_text: str, tldr: list[str]
) -> ValidationResult:
    flags: list[str] = []
    hard_fail = False

    if any(_DASH_RE.search(s) for s in _string_fields(generated)):
        flags.append("EM_DASH")
        hard_fail = True

    prose = _norm(f"{generated.title} {generated.summary} {generated.body_md}")
    for phrase in _banned_phrases():
        p = _norm(phrase)
        if p and re.search(rf"(?<!\w){re.escape(p)}(?!\w)", prose):
            flags.append(f"BANNED_PHRASE:{phrase}")
            hard_fail = True

    if len(tldr) != 3:
        flags.append(f"TLDR_COUNT:{len(tldr)}")
        hard_fail = True

    ungrounded = ungrounded_facts(generated.body_md, source_text)
    flags.extend(ungrounded)

    src = _norm(source_text)
    missing_quote = False
    for claim in generated.claims:
        if _norm(claim.source_quote) not in src:
            missing_quote = True
            flags.append(f"CLAIM_QUOTE_MISSING:{claim.source_quote[:40]}")

    risk: Literal["LOW", "MEDIUM", "HIGH"]
    if len(ungrounded) >= 3 or missing_quote:
        risk = "HIGH"
    elif ungrounded:
        risk = "MEDIUM"
    else:
        risk = "LOW"

    return ValidationResult(
        passed=not hard_fail,
        hard_fail=hard_fail,
        confidence=max(0.0, 1 - 0.15 * len(flags)),
        fact_risk=risk,
        flags=flags,
    )
