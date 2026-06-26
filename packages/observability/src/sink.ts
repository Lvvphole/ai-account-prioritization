import type { ObservabilityEvent } from "./event";

/**
 * An observability sink receives validated, PII-redacted events. Sinks must be
 * non-critical: the emitter never lets a sink failure reach the caller. A real
 * deployment can back this with the Supabase `observability_events` table,
 * Langfuse, or a log pipeline.
 */
export interface ObservabilitySink {
  emit(event: ObservabilityEvent): void | Promise<void>;
}

/** Discards everything — the safe default; observability is never required. */
export const noopSink: ObservabilitySink = {
  emit() {
    /* no-op */
  },
};

/** Records events in memory for tests / in-process inspection. */
export interface MemorySink extends ObservabilitySink {
  readonly events: ObservabilityEvent[];
  clear(): void;
}

export function createMemorySink(): MemorySink {
  const events: ObservabilityEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
    clear() {
      events.length = 0;
    },
  };
}

/** Writes a single structured JSON line per event (dev / local). */
export const consoleSink: ObservabilitySink = {
  emit(event) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ obs: event }));
  },
};
