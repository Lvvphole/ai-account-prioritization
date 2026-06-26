"""Offline tests for the observability wiring.

These run without the optional SDKs and without any backend: the defining
property is that everything degrades to a safe no-op when unconfigured.
"""

from __future__ import annotations

import pytest

from observability import (
    ObservabilitySettings,
    init_observability,
    init_langfuse,
    init_sentry,
    record_event,
    reset_langfuse,
)

_ENV_KEYS = [
    "SENTRY_DSN",
    "SENTRY_ENVIRONMENT",
    "SENTRY_TRACES_SAMPLE_RATE",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "LANGFUSE_BASEURL",
    "NODE_ENV",
]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for key in _ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    reset_langfuse()
    yield
    reset_langfuse()


def test_disabled_by_default():
    settings = ObservabilitySettings.from_env()
    assert settings.sentry_enabled is False
    assert settings.langfuse_enabled is False
    assert init_sentry(settings) is False
    assert init_langfuse(settings) is None
    assert init_observability() == {"sentry": False, "langfuse": False}


def test_record_event_is_noop_when_disabled():
    # Must not raise even though no client is configured.
    record_event("scoring.summary", {"count": 3})


def test_settings_parse_and_enable_flags(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.com/1")
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")
    monkeypatch.setenv("LANGFUSE_BASEURL", "https://cloud.langfuse.com")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.25")

    settings = ObservabilitySettings.from_env()
    assert settings.sentry_enabled is True
    assert settings.langfuse_enabled is True
    assert settings.traces_sample_rate == 0.25
    assert settings.langfuse_host == "https://cloud.langfuse.com"


def test_sample_rate_is_clamped_and_safe(monkeypatch):
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "not-a-number")
    assert ObservabilitySettings.from_env().traces_sample_rate == 0.0
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "5")
    assert ObservabilitySettings.from_env().traces_sample_rate == 1.0
