"""Langfuse tracing for the support service.

Gated behind LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY and a guarded import, so
the service runs without the `langfuse` package installed. Trace emission is
best-effort and never raises into the request path. Only non-PII metadata
(counts, flags) should be passed.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from .config import ObservabilitySettings

logger = logging.getLogger(__name__)

_client: Optional[Any] = None


def init_langfuse(settings: ObservabilitySettings) -> Optional[Any]:
    """Initialize (and cache) the Langfuse client when configured, else None."""
    global _client
    if not settings.langfuse_enabled:
        return None
    if _client is not None:
        return _client

    try:
        from langfuse import Langfuse
    except ImportError:
        logger.warning(
            "Langfuse keys are set but the langfuse package is not installed; skipping."
        )
        return None

    _client = Langfuse(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        host=settings.langfuse_host,
    )
    return _client


def record_event(name: str, metadata: dict[str, Any] | None = None) -> None:
    """Emit a best-effort Langfuse trace. No-op when disabled; never raises."""
    client = _client
    if client is None:
        return
    try:
        trace = getattr(client, "trace", None)
        if callable(trace):
            trace(name=name, metadata=metadata or {})
            flush = getattr(client, "flush", None)
            if callable(flush):
                flush()
    except Exception:  # noqa: BLE001 — observability must never break a request.
        logger.exception("Langfuse trace emission failed (non-fatal).")


def reset_langfuse() -> None:
    """Test seam: drop the cached client."""
    global _client
    _client = None
