import { redactPII, redactProperties } from "@repo/security";
import { ObservabilityEventSchema, type ObservabilityEvent } from "./event";
import { noopSink, type ObservabilitySink } from "./sink";

export interface ObservabilityOptions {
  /** Where events go. Defaults to the no-op sink. */
  sink?: ObservabilitySink;
}

export interface EmitInput {
  source: string;
  name: string;
  level?: ObservabilityEvent["level"];
  traceId?: string;
  attributes?: Record<string, unknown>;
  occurredAt: string;
}

export interface Observability {
  emit(input: EmitInput): ObservabilityEvent;
}

/**
 * Create an observability emitter. Every event is PII-redacted (via
 * @repo/security) and schema-validated before it reaches the sink, and emission
 * is fire-and-forget — a sink failure never propagates to the caller, keeping
 * observability strictly out of the runtime decision path.
 *
 * Redaction is UNCONDITIONAL: both `attributes` and a free-form `traceId` are
 * scrubbed, so a single caller misconfiguration cannot leak CRM/contact data
 * (Rule #30). There is no bypass.
 */
export function createObservability(options: ObservabilityOptions = {}): Observability {
  const sink = options.sink ?? noopSink;

  return {
    emit(input) {
      const event = ObservabilityEventSchema.parse({
        source: input.source,
        name: input.name,
        level: input.level ?? "info",
        traceId: input.traceId ? redactPII(input.traceId) : undefined,
        attributes: redactProperties(input.attributes ?? {}),
        occurredAt: input.occurredAt,
      } satisfies ObservabilityEvent);

      try {
        const result = sink.emit(event);
        if (result instanceof Promise) result.catch(() => undefined);
      } catch {
        // Swallow — observability is non-critical and outside the decision path.
      }

      return event;
    },
  };
}
