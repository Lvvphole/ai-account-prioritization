import { describe, it, expect } from "vitest";
import {
  createObservability,
  createMemorySink,
  ObservabilityEventSchema,
} from "@repo/observability";

/**
 * Deterministic observability eval (Sprint 8 gate).
 *
 * Asserts the product-level invariants of the in-product observability layer:
 * telemetry is PII-safe (Rule #30), every emitted event is schema-valid, and
 * emission is non-blocking — a failing sink can never affect the runtime.
 */
const ISO = "2026-06-25T07:00:00Z";

describe("observability (deterministic)", () => {
  it("never emits PII into event attributes (Rule #30)", () => {
    const sink = createMemorySink();
    const obs = createObservability({ sink });

    obs.emit({
      source: "agent-runtime",
      name: "recommendation_published",
      attributes: {
        contact: "robin.vasquez@cobalt.example",
        phone: "415-555-0199",
        rank: 1,
      },
      occurredAt: ISO,
    });

    const blob = JSON.stringify(sink.events);
    expect(blob).not.toMatch(/@cobalt\.example|415-555-0199/);
    expect(sink.events[0]!.attributes.rank).toBe(1);
  });

  it("emitted events conform to the ObservabilityEvent schema", () => {
    const sink = createMemorySink();
    const obs = createObservability({ sink });
    obs.emit({ source: "web", name: "run_started", occurredAt: ISO });
    for (const event of sink.events) {
      expect(ObservabilityEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("is non-blocking: a failing sink never breaks emission", () => {
    const obs = createObservability({
      sink: {
        emit() {
          throw new Error("sink down");
        },
      },
    });
    expect(() => obs.emit({ source: "x", name: "y", occurredAt: ISO })).not.toThrow();
  });
});
