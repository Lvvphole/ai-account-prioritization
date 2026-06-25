"""Generated-schema loader.

Reads the JSON Schema artifacts produced by `pnpm generate:schemas` from
TypeScript/Zod (the source of truth). Python NEVER imports TypeScript; it only
consumes these generated JSON files (Execution Rule #4).
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

# .../src/schemas/generated
GENERATED_DIR = Path(__file__).resolve().parent / "generated"


class SchemaError(RuntimeError):
    """Raised when a generated schema is missing or malformed."""


def _resolve_definition(name: str, raw: dict[str, Any]) -> dict[str, Any]:
    """zod-to-json-schema wraps the schema under definitions[name]."""
    definitions = raw.get("definitions", {})
    if name in definitions:
        return definitions[name]
    # Fallback: some emitters inline the schema at the top level.
    return raw


@lru_cache(maxsize=None)
def list_schemas() -> tuple[str, ...]:
    """Names of all generated schemas (from the index manifest)."""
    index_path = GENERATED_DIR / "index.json"
    if not index_path.exists():
        raise SchemaError(
            f"Schema index not found at {index_path}. Run `pnpm generate:schemas`."
        )
    index = json.loads(index_path.read_text(encoding="utf-8"))
    return tuple(index.get("schemas", []))


@lru_cache(maxsize=None)
def load_schema(name: str) -> dict[str, Any]:
    """Load a single generated schema definition by name."""
    path = GENERATED_DIR / f"{name}.json"
    if not path.exists():
        raise SchemaError(
            f"Schema '{name}' not found at {path}. Run `pnpm generate:schemas`."
        )
    raw = json.loads(path.read_text(encoding="utf-8"))
    return _resolve_definition(name, raw)


def required_fields(name: str) -> list[str]:
    """Required property names for a schema (used by lightweight validation)."""
    schema = load_schema(name)
    return list(schema.get("required", []))


def property_names(name: str) -> list[str]:
    schema = load_schema(name)
    return list(schema.get("properties", {}).keys())
