import pytest

from framework_stage.settings import get_settings

_VARS = [
    "DAILY_GENERATION_CAP", "AUTO_PUBLISH_ENABLED", "IMAGE_POLICY",
]


def _clean(monkeypatch):
    for v in _VARS:
        monkeypatch.delenv(v, raising=False)


def test_defaults(monkeypatch):
    _clean(monkeypatch)
    s = get_settings()
    assert s.daily_generation_cap == 50
    assert s.auto_publish_enabled is False
    assert s.image_policy == "hotlink"


def test_invalid_cap_raises(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("DAILY_GENERATION_CAP", "0")
    with pytest.raises(ValueError):
        get_settings()


_ROOT = __import__("pathlib").Path(__file__).resolve().parents[2]


def _env_names_read_by_settings() -> set[str]:
    import re

    src = (_ROOT / "framework_stage" / "settings.py").read_text(encoding="utf-8")
    return set(re.findall(r'(?:os\.getenv|_int|_float|_bool)\(\s*"([A-Z0-9_]+)"', src))


def test_every_settings_env_var_is_documented_in_env_example():
    names = _env_names_read_by_settings()
    assert {"STAGE_DB_PATH", "STAGE_LOCK_PATH", "DAILY_GENERATION_CAP"} <= names
    example = (_ROOT / ".env.example").read_text(encoding="utf-8")
    documented = {
        line.split("=", 1)[0].strip()
        for line in example.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }
    assert sorted(names - documented) == []


def test_repr_never_shows_service_key(monkeypatch):
    _clean(monkeypatch)
    secret = "sb-secret-service-key-value-123"
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", secret)
    s = get_settings()
    assert s.supabase_service_key == secret
    assert secret not in repr(s)
