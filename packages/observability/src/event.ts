import { z } from "zod";

/** Severity for an observability event. */
export const ObservabilityLevel = z.enum(["debug", "info", "warn", "error"]);
export type ObservabilityLevel = z.infer<typeof ObservabilityLevel>;

/**
 * ObservabilityEvent — an in-product observability/telemetry event.
 *
 * Mirrors the Supabase `observability_events` table (supabase/migrations/
 * 0006_observability_events.sql). The database assigns the row id; this is the
 * application-level event shape. Distinct from Sentry/Langfuse, which own
 * reliability and LLM telemetry respectively.
 */
export const ObservabilityEventSchema = z.object({
  source: z.string().min(1).describe("Emitting component, e.g. 'agent-runtime'."),
  name: z.string().min(1),
  level: ObservabilityLevel.default("info"),
  traceId: z.string().optional(),
  /** JSON-serializable; must not contain secrets/PII (redacted before emit). */
  attributes: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().datetime(),
});

export type ObservabilityEvent = z.infer<typeof ObservabilityEventSchema>;
