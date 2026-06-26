"""Observability for the Python support service: Sentry (errors) + Langfuse
(tracing). Both are env-gated and degrade to no-ops when unconfigured or when
the optional SDKs are not installed, keeping the service runnable offline.
"""

from __future__ import annotations

from .config import ObservabilitySettings
from .sentry import init_sentry
from .langfuse_client import init_langfuse, record_event, reset_langfuse


def init_observability() -> dict[str, bool]:
    """Initialize all backends from the environment; report what is enabled."""
    settings = ObservabilitySettings.from_env()
    return {
        "sentry": init_sentry(settings),
        "langfuse": init_langfuse(settings) is not None,
    }


__all__ = [
    "ObservabilitySettings",
    "init_observability",
    "init_sentry",
    "init_langfuse",
    "record_event",
    "reset_langfuse",
]
