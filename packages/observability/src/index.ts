/**
 * @repo/observability — a small, deterministic in-product observability layer.
 *
 * Defines the `ObservabilityEvent` shape (mirroring the Supabase
 * `observability_events` table), a pluggable sink, and an emitter that
 * PII-redacts (via @repo/security) and schema-validates every event before
 * fire-and-forget delivery. Backends (Supabase/Langfuse/log pipeline) plug in as
 * sinks; the default is a no-op so observability is never required.
 */
export {
  ObservabilityEventSchema,
  ObservabilityLevel,
  type ObservabilityEvent,
} from "./event";

export {
  noopSink,
  consoleSink,
  createMemorySink,
  type ObservabilitySink,
  type MemorySink,
} from "./sink";

export {
  createObservability,
  type Observability,
  type ObservabilityOptions,
  type EmitInput,
} from "./observability";

export {
  observabilityConfigFromEnv,
  type ObservabilityConfig,
} from "./config";
