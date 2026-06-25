import { z } from "zod";
import {
  AccountSchema,
  ActivitySchema,
  ContactSchema,
  OpportunitySchema,
  RecommendationSchema,
} from "@repo/shared-schemas";

/**
 * Orchestrator state machine.
 *
 * Phases mirror the product loop: DISCOVER -> PLAN -> EXECUTE -> VERIFY ->
 * ITERATE -> PUBLISH (terminal: DONE / BLOCKED). State is validated with Zod on
 * every transition (Runtime checks: "Zod state validation"). Invalid state is a
 * hard, fail-closed error — never a silent recovery.
 */
export const OrchestratorPhase = z.enum([
  "DISCOVER",
  "PLAN",
  "EXECUTE",
  "VERIFY",
  "ITERATE",
  "PUBLISH",
  "DONE",
  "BLOCKED",
]);
export type OrchestratorPhase = z.infer<typeof OrchestratorPhase>;

export const OrchestratorInputsSchema = z.object({
  accounts: z.array(AccountSchema),
  contacts: z.array(ContactSchema),
  opportunities: z.array(OpportunitySchema),
  activities: z.array(ActivitySchema),
});
export type OrchestratorInputs = z.infer<typeof OrchestratorInputsSchema>;

export const OrchestratorStateSchema = z.object({
  runId: z.string().min(1),
  ownerId: z.string().min(1),
  phase: OrchestratorPhase,
  startedAt: z.string().datetime(),
  inputs: OrchestratorInputsSchema,
  /** Candidate recommendations before verification; mutated across phases. */
  candidates: z.array(RecommendationSchema).default([]),
  /** Verified recommendations cleared for publish. */
  published: z.array(RecommendationSchema).default([]),
  /** Recommendations rejected by verification, with the failing gate(s). */
  blocked: z
    .array(
      z.object({
        recommendationId: z.string(),
        accountId: z.string(),
        failedGates: z.array(z.string()),
      }),
    )
    .default([]),
  errors: z.array(z.string()).default([]),
});
export type OrchestratorState = z.infer<typeof OrchestratorStateSchema>;

/** Legal forward transitions. Enforced to keep the loop deterministic. */
const ALLOWED_TRANSITIONS: Record<OrchestratorPhase, OrchestratorPhase[]> = {
  DISCOVER: ["PLAN", "BLOCKED"],
  PLAN: ["EXECUTE", "BLOCKED"],
  EXECUTE: ["VERIFY", "BLOCKED"],
  VERIFY: ["ITERATE", "PUBLISH", "BLOCKED"],
  ITERATE: ["VERIFY", "PUBLISH", "BLOCKED"],
  PUBLISH: ["DONE", "BLOCKED"],
  DONE: [],
  BLOCKED: [],
};

export function createInitialState(args: {
  runId: string;
  ownerId: string;
  startedAt: string;
  inputs: OrchestratorInputs;
}): OrchestratorState {
  return OrchestratorStateSchema.parse({
    runId: args.runId,
    ownerId: args.ownerId,
    phase: "DISCOVER",
    startedAt: args.startedAt,
    inputs: args.inputs,
    candidates: [],
    published: [],
    blocked: [],
    errors: [],
  });
}

/**
 * Validate and apply a phase transition. Re-parses the entire state with Zod so
 * no malformed mutation can propagate. Throws on illegal transitions.
 */
export function transition(
  state: OrchestratorState,
  next: OrchestratorPhase,
  patch: Partial<OrchestratorState> = {},
): OrchestratorState {
  const legal = ALLOWED_TRANSITIONS[state.phase];
  if (!legal.includes(next)) {
    throw new Error(
      `Illegal orchestrator transition: ${state.phase} -> ${next} (run ${state.runId})`,
    );
  }
  return OrchestratorStateSchema.parse({ ...state, ...patch, phase: next });
}

/** Hard validation used as a fail-closed gate before publish. */
export function assertValidState(state: unknown): OrchestratorState {
  return OrchestratorStateSchema.parse(state);
}
