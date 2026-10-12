"""Keeps the JSON config, prompt files, doc and Supabase migration in sync."""

import json
import re
from pathlib import Path

from framework_stage.models import ContentType
from framework_stage.strategy import FRAMEWORKS, load_content_type_guide

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "framework_stage" / "config" / "frameworks.json").read_text())


def test_every_content_type_maps_to_a_valid_framework():
    assert set(CONFIG["content_types"]) == {t.value for t in ContentType}
    assert set(CONFIG["content_types"].values()) <= set(FRAMEWORKS)


def test_every_framework_is_used_by_exactly_one_content_type():
    used = sorted(CONFIG["content_types"].values())
    assert used == sorted(FRAMEWORKS)


def test_every_content_type_has_a_guide_line():
    assert set(load_content_type_guide()) == {t.value for t in ContentType}


def test_keyword_rules_only_use_known_content_types():
    assert set(CONFIG["keyword_rules"]) <= {t.value for t in ContentType}


def test_doc_lists_every_framework_and_content_type():
    doc = (ROOT / "docs" / "COPYWRITING_FRAMEWORKS.md").read_text()
    for fw in FRAMEWORKS:
        assert f"`{fw}`" in doc, fw
    for ct, fw in CONFIG["content_types"].items():
        assert re.search(rf"`{ct}`.*`{fw}`", doc), ct


def test_migration_keys_match_frameworks_and_content_types():
    sql = (ROOT / "web" / "supabase" / "migrations" / "0002_copywriting_frameworks.sql").read_text()
    keys = set(re.findall(r"^\s*\('([A-Z0-9_]+)',\s+'", sql, re.M))
    assert keys == set(FRAMEWORKS)
    for ct in ContentType:
        assert f"'{ct.value}'" in sql, ct
