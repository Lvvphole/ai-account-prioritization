import type { IngestionState } from "./ingestion";

/**
 * The ingestion state machine (secure-ingestion spec, section 8.1).
 *
 * "Invalid state transitions fail closed and create audit evidence." That is a
 * rule about behaviour, so it is expressed as a table the pipeline calls rather
 * than as prose a reviewer has to remember. Every mover through the pipeline
 * asks this module first; a transition absent from the table is refused and the
 * refusal is auditable.
 */

/**
 * Allowed successors for each state.
 *
 * `failed` and `cancelled` are reachable from every non-terminal state, so they
 * are added programmatically below rather than repeated fifteen times where a
 * missing entry would read as a deliberate exclusion.
 */
const HAPPY_PATH: Record<IngestionState, readonly IngestionState[]> = {
  draft: ["awaiting_upload", "awaiting_auth"],
  awaiting_upload: ["received"],
  awaiting_auth: ["received"],
  received: ["security_scanning"],
  security_scanning: ["parsing", "rejected", "quarantined"],
  parsing: ["mapping", "rejected", "quarantined"],
  mapping: ["validating", "rejected"],
  validating: ["ready_for_review", "rejected", "quarantined"],
  ready_for_review: ["awaiting_approval", "rejected"],
  awaiting_approval: ["committing", "rejected"],
  committing: ["committed"],
  committed: ["processing_events"],
  processing_events: ["completed"],
  completed: ["rolled_back", "partially_rolled_back"],

  // Terminal. Nothing proceeds from here; a rollback of a rollback would be a
  // new batch, not a transition on this one.
  rejected: [],
  quarantined: [],
  failed: [],
  cancelled: [],
  rolled_back: [],
  partially_rolled_back: [],
};

/** States from which no transition is permitted. */
export const TERMINAL_STATES: readonly IngestionState[] = [
  "rejected",
  "quarantined",
  "failed",
  "cancelled",
  "rolled_back",
  "partially_rolled_back",
];

export function isTerminalState(state: IngestionState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Escape hatches available from any state still in flight. */
const ALWAYS_AVAILABLE: readonly IngestionState[] = ["failed", "cancelled"];

function buildTransitions(): Record<IngestionState, ReadonlySet<IngestionState>> {
  const table = {} as Record<IngestionState, ReadonlySet<IngestionState>>;
  for (const state of Object.keys(HAPPY_PATH) as IngestionState[]) {
    table[state] = new Set<IngestionState>(
      isTerminalState(state)
        ? HAPPY_PATH[state]
        : [...HAPPY_PATH[state], ...ALWAYS_AVAILABLE],
    );
  }
  return Object.freeze(table);
}

const TRANSITIONS = buildTransitions();

/** States a batch may legally move to next. */
export function allowedTransitions(from: IngestionState): readonly IngestionState[] {
  return [...(TRANSITIONS[from] ?? new Set())];
}

/**
 * True only for a transition the table declares. A state equal to itself is not
 * a transition and is refused, so a repeated write cannot masquerade as progress.
 */
export function canTransition(from: IngestionState, to: IngestionState): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * Thrown on a refused transition. Carries the pair so audit evidence records
 * what was attempted, and no batch payload so the error is safe to log.
 */
export class InvalidIngestionTransitionError extends Error {
  readonly code = "INGEST_INVALID_STATE_TRANSITION";
  constructor(
    readonly from: IngestionState,
    readonly to: IngestionState,
  ) {
    super(`Ingestion transition ${from} -> ${to} is not permitted`);
    this.name = "InvalidIngestionTransitionError";
  }
}

/**
 * Fail-closed guard. Callers use this instead of assigning `state` directly, so
 * an invalid move throws before any row is written.
 */
export function assertTransition(from: IngestionState, to: IngestionState): void {
  if (!canTransition(from, to)) {
    throw new InvalidIngestionTransitionError(from, to);
  }
}

/** The state a batch enters when a hard block is found. Section 13.4. */
export const HARD_BLOCK_TERMINAL: IngestionState = "rejected";
