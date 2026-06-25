"""Data-quality assessment service.

A SUPPORT service (Epic 6): it inspects account records against the generated
Account schema and flags quality issues. It produces advisory flags only and has
NO authority over the agent runtime or ranking.
"""

from __future__ import annotations

from typing import Any

from schemas.loader import required_fields

# Fields that are technically optional in the schema but operationally important
# for a high-confidence recommendation. Missing them yields advisory flags.
IMPORTANT_OPTIONAL_FIELDS = (
    "lastContactedAt",
    "healthScore",
    "annualRevenueUsd",
)


def assess_account(account: dict[str, Any]) -> list[str]:
    """Return a deterministic, sorted list of data-quality flags for an account."""
    flags: set[str] = set()

    # Hard requirements from the generated schema.
    for field in required_fields("Account"):
        value = account.get(field)
        if value is None or value == "":
            flags.add(f"missing_required:{field}")

    # Operationally important optional fields.
    for field in IMPORTANT_OPTIONAL_FIELDS:
        if account.get(field) in (None, ""):
            flags.add(f"missing_optional:{field}")

    # Simple consistency checks.
    pipeline = account.get("openPipelineUsd")
    if isinstance(pipeline, (int, float)) and pipeline < 0:
        flags.add("invalid:openPipelineUsd_negative")

    return sorted(flags)


def assess_batch(accounts: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Assess many accounts; keyed by account id (or index if id missing)."""
    result: dict[str, list[str]] = {}
    for i, account in enumerate(accounts):
        key = str(account.get("id") or f"index_{i}")
        result[key] = assess_account(account)
    return result
