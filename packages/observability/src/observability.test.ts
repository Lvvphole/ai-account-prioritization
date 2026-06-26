import { describe, it, expect } from "vitest";
import {
  createObservability,
  createMemorySink,
  observabilityConfigFromEnv,
  ObservabilityEventSchema,
} from "./index";

const NOW = "2026-06-25T00:00:00Z";

describe("observability emitter", () => {
  it("redacts PII from attributes before they reach the sink", () => {
    const sink = createMemorySink();
    const obs = createObservability({ sink });

    obs.emit({
      source: "agent-runtime",
      name: "run_completed",
      attributes: { owner: "dana.ito@helios-mfg.com", published: 3 },
      occurredAt: NOW,
    });

    expect(sink.events).toHaveLength(1);
    const event = sink.events[0]!;
    expect(JSON.stringify(event)).not.toContain("dana.ito@helios-mfg.com");
    expect(event.attributes.owner).toBe("[redacted:email]");
    expect(event.attributes.published).toBe(3);
  });

  it("produces schema-valid events with defaulted level + empty attributes", () => {
    const sink = createMemorySink();
    const obs = createObservability({ sink });
    const event = obs.emit({ source: "web", name: "page_view", occurredAt: NOW });

    expect(ObservabilityEventSchema.safeParse(event).success).toBe(true);
    expect(event.level).toBe("info");
    expect(event.attributes).toEqual({});
  });

  it("default emitter (no sink) is a no-op and never throws", () => {
    const obs = createObservability();
    expect(() => obs.emit({ source: "x", name: "y", occurredAt: NOW })).not.toThrow();
  });

  it("a throwing sink never propagates to the caller", () => {
    const obs = createObservability({
      sink: {
        emit() {
          throw new Error("sink down");
        },
      },
    });
    expect(() => obs.emit({ source: "x", name: "y", occurredAt: NOW })).not.toThrow();
  });

  it("redaction can be disabled explicitly", () => {
    const sink = createMemorySink();
    const obs = createObservability({ sink, redact: false });
    obs.emit({ source: "x", name: "y", attributes: { email: "a@b.com" }, occurredAt: NOW });
    expect(sink.events[0]!.attributes.email).toBe("a@b.com");
  });
});

describe("observabilityConfigFromEnv", () => {
  it("reports backends as enabled only when their env is present", () => {
    expect(observabilityConfigFromEnv({})).toEqual({
      sentryEnabled: false,
      langfuseEnabled: false,
    });
    expect(
      observabilityConfigFromEnv({
        SENTRY_DSN: "https://x@e/1",
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
      }),
    ).toEqual({ sentryEnabled: true, langfuseEnabled: true });
  });
});
