"""Sentry error/reliability reporting for the support service.

Gated behind SENTRY_DSN and a guarded import, so the service runs without the
`sentry-sdk` package installed. PII is never sent (Rule #30):
``send_default_pii=False``. sentry-sdk auto-enables its FastAPI/Starlette
integration when those frameworks are importable.
"""

from __future__ import annotations

import logging

from .config import ObservabilitySettings

logger = logging.getLogger(__name__)


def init_sentry(settings: ObservabilitySettings) -> bool:
    """Initialize Sentry when configured. Returns True iff it was enabled."""
    if not settings.sentry_enabled:
        return False

    try:
        import sentry_sdk
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed; skipping.")
        return False

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        traces_sample_rate=settings.traces_sample_rate,
        # Never ship personal data / request bodies to telemetry.
        send_default_pii=False,
    )
    return True
