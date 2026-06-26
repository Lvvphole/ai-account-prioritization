"""FastAPI support service entrypoint.

Isolated from the agent runtime (Epic 6). Exposes read-only schema access plus
data-quality and analytics helpers. It cannot rank accounts, publish
recommendations, or write to the CRM — those live in the TypeScript runtime.

Run locally:
    pip install -e .
    uvicorn main:app --app-dir src --reload
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from schemas.loader import SchemaError, list_schemas, load_schema
from data_quality.service import assess_account, assess_batch
from scoring.service import summarize_run, validate_against_schema
from observability import init_observability, record_event

app = FastAPI(
    title="AI Account Prioritization — Python Support Service",
    version="1.0.0",
    description=(
        "Isolated support service. Consumes generated JSON Schemas. "
        "Does NOT control the agent runtime or rank accounts."
    ),
)

# Initialize observability (Sentry errors + Langfuse tracing). Env-gated: a no-op
# when unconfigured or when the optional SDKs are not installed.
OBSERVABILITY_STATUS = init_observability()


class AccountPayload(BaseModel):
    account: dict[str, Any]


class AccountsPayload(BaseModel):
    accounts: list[dict[str, Any]]


class RecommendationsPayload(BaseModel):
    recommendations: list[dict[str, Any]]


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "api-python",
        "schemas": len(list_schemas()),
        "observability": OBSERVABILITY_STATUS,
    }


@app.get("/schemas")
def get_schemas() -> dict[str, Any]:
    return {"schemas": list(list_schemas())}


@app.get("/schemas/{name}")
def get_schema(name: str) -> dict[str, Any]:
    try:
        return load_schema(name)
    except SchemaError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/data-quality/account")
def data_quality_account(payload: AccountPayload) -> dict[str, Any]:
    flags = assess_account(payload.account)
    return {"flags": flags, "ok": len(flags) == 0}


@app.post("/data-quality/batch")
def data_quality_batch(payload: AccountsPayload) -> dict[str, Any]:
    return {"results": assess_batch(payload.accounts)}


@app.post("/scoring/summary")
def scoring_summary(payload: RecommendationsPayload) -> dict[str, Any]:
    # Non-PII trace (count only); no-op unless Langfuse is configured.
    record_event("scoring.summary", {"count": len(payload.recommendations)})
    return summarize_run(payload.recommendations)


@app.post("/scoring/validate")
def scoring_validate(payload: RecommendationsPayload) -> dict[str, Any]:
    results = [
        {"index": i, "missing": validate_against_schema(rec, "Recommendation")}
        for i, rec in enumerate(payload.recommendations)
    ]
    return {"results": results}
