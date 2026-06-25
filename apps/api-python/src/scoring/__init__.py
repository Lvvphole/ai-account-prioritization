"""Scoring support service (non-authoritative analytics)."""

from .service import summarize_run, validate_against_schema

__all__ = ["summarize_run", "validate_against_schema"]
