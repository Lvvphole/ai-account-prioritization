"""Observability configuration, read once from the environment.

Pure stdlib — no third-party imports — so it is always importable and testable
offline. Both integrations are OFF unless their credentials are present, so the
support service stays fully runnable with no observability backend.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str) -> str | None:
    value = os.environ.get(name)
    return value if value else None


@dataclass(frozen=True)
class ObservabilitySettings:
    sentry_dsn: str | None
    environment: str
    traces_sample_rate: float
    langfuse_public_key: str | None
    langfuse_secret_key: str | None
    langfuse_host: str | None

    @property
    def sentry_enabled(self) -> bool:
        return self.sentry_dsn is not None

    @property
    def langfuse_enabled(self) -> bool:
        return (
            self.langfuse_public_key is not None
            and self.langfuse_secret_key is not None
        )

    @classmethod
    def from_env(cls) -> "ObservabilitySettings":
        raw_rate = os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.0")
        try:
            rate = float(raw_rate)
        except ValueError:
            rate = 0.0
        rate = min(1.0, max(0.0, rate))

        return cls(
            sentry_dsn=_env("SENTRY_DSN"),
            environment=(
                os.environ.get("SENTRY_ENVIRONMENT")
                or os.environ.get("NODE_ENV")
                or "development"
            ),
            traces_sample_rate=rate,
            langfuse_public_key=_env("LANGFUSE_PUBLIC_KEY"),
            langfuse_secret_key=_env("LANGFUSE_SECRET_KEY"),
            langfuse_host=_env("LANGFUSE_BASEURL"),
        )
