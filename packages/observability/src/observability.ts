import { redactProperties } from "@repo/security";
import { ObservabilityEventSchema, type ObservabilityEvent } from "./event";
import { noopSink, type ObservabilitySink } from "./sink";

export interface ObservabilityOptions {
  /** Where events go. Defaults to the no-op sink. */
  sink?: ObservabilitySink;
  /** Redact PII from attributes before emit (default true). */
  redact?: boolean;
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
 */
export function createObservability(options: ObservabilityOptions = {}): Observability {
  const sink = options.sink ?? noopSink;
  const redact = options.redact ?? true;

  return {
    emit(input) {
      const rawAttributes = input.attributes ?? {};
      const attributes = redact ? redactProperties(rawAttributes) : rawAttributes;

      const event = ObservabilityEventSchema.parse({
        source: input.source,
        name: input.name,
        level: input.level ?? "info",
        traceId: input.traceId,
        attributes,
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
