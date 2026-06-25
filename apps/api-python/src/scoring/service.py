"""Scoring SUPPORT service.

IMPORTANT (Execution Rules #1, #2; Epic 6): this service does NOT decide account
rank. The authoritative deterministic scorer lives in the TypeScript agent
runtime. This module only provides non-authoritative analytics over already
-published recommendations (aggregate stats, lightweight schema validation) for
dashboards and monitoring. It never writes back to the runtime.
"""

from __future__ import annotations

from typing import Any

from schemas.loader import required_fields


def validate_against_schema(record: dict[str, Any], schema_name: str) -> list[str]:
    """Lightweight required-key validation against a generated schema.

    Returns a list of missing required fields (empty == structurally valid).
    Demonstrates Python consuming the generated JSON Schema contract.
    """
    missing: list[str] = []
    for field in required_fields(schema_name):
        if field not in record or record.get(field) is None:
            missing.append(field)
    return missing


def summarize_run(recommendations: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate analytics for a set of published recommendations."""
    total = len(recommendations)
    if total == 0:
        return {
            "count": 0,
            "average_score": 0.0,
            "average_confidence": 0.0,
            "customer_facing": 0,
            "schema_invalid": 0,
        }

    scores = [float(r.get("score", 0)) for r in recommendations]
    confidences = [float(r.get("confidence", 0)) for r in recommendations]
    customer_facing = sum(
        1
        for r in recommendations
        if (r.get("nextBestAction") or {}).get("customerFacing") is True
    )
    schema_invalid = sum(
        1 for r in recommendations if validate_against_schema(r, "Recommendation")
    )

    return {
        "count": total,
        "average_score": round(sum(scores) / total, 2),
        "average_confidence": round(sum(confidences) / total, 4),
        "customer_facing": customer_facing,
        "schema_invalid": schema_invalid,
    }
