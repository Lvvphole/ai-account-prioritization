import { z } from "zod";
import { CanonicalObjectType } from "./source";

/**
 * Domain events and event triggers (secure-ingestion spec, section 12).
 *
 * A trigger is a closed, typed rule: an administrator picks an event, operators
 * from a fixed list, and actions from a fixed list. There is no expression
 * language and no user-authored code, so a trigger cannot become an execution
 * primitive.
 *
 * The prohibited actions in section 12.4 are absent from `TriggerActionType`
 * rather than filtered later. A trigger that sends a customer message or writes
 * to the CRM cannot be represented by these contracts at all.
 */

/* ---------------------------------------------------------------- events -- */

/** Section 12.2. The complete set of events a trigger may listen for. */
export const DomainEventType = z.enum([
  "account.created",
  "account.updated",
  "account.owner_changed",
  "contact.created",
  "contact.updated",
  "contact.opted_out",
  "opportunity.created",
  "opportunity.updated",
  "opportunity.stage_changed",
  "opportunity.amount_changed",
  "opportunity.stalled",
  "activity.created",
  "intent.detected",
  "account_health.updated",
  "account_health.threshold_crossed",
  "renewal.window_entered",
  "sync.completed",
  "manual_import.committed",
  "manual_import.rolled_back",
]);
export type DomainEventType = z.infer<typeof DomainEventType>;

export const DomainEventState = z.enum([
  "pending",
  "processing",
  "processed",
  "failed",
  "dead_lettered",
  "skipped",
]);
export type DomainEventState = z.infer<typeof DomainEventState>;

/**
 * An event emitted in the same transaction as the operational mutation that
 * caused it (section 15.3), so the product cannot end up with a committed change
 * that no trigger ever saw.
 */
export const DomainEventSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    /** Null for events the product raises itself rather than ingesting. */
    sourceId: z.string().uuid().nullable(),
    eventType: DomainEventType,
    objectType: CanonicalObjectType,
    /** The operational row the event concerns. */
    objectId: z.string().uuid(),
    /** The account this event rolls up to, used for debounce and cooldown. */
    accountId: z.string().uuid().nullable(),
    /** Supplied by the source. Unique per source when present (section 15.3). */
    externalEventId: z.string().min(1).max(255).nullable(),
    batchId: z.string().uuid().nullable(),
    commitId: z.string().uuid().nullable(),
    occurredAt: z.string().datetime(),
    recordedAt: z.string().datetime(),
    /**
     * Normalized, trust-filtered fields only. Raw source payloads stay in
     * staging; nothing here is free-form source text.
     */
    payload: z.record(z.unknown()),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    state: DomainEventState,
    attemptCount: z.number().int().nonnegative(),
    processedAt: z.string().datetime().nullable(),
  })
  .strict();
export type DomainEvent = z.infer<typeof DomainEventSchema>;

/* ------------------------------------------------------------ conditions -- */

/** Section 12.3. */
export const ConditionOperator = z.enum([
  "equals",
  "not_equals",
  "in",
  "not_in",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "changed",
  "changed_from",
  "changed_to",
  "exists",
  "not_exists",
  "within_days",
]);
export type ConditionOperator = z.infer<typeof ConditionOperator>;

/** Operators that take no operand. Supplying one is a contract error. */
export const VALUELESS_OPERATORS: readonly ConditionOperator[] = [
  "changed",
  "exists",
  "not_exists",
];

/** Operators that take a list rather than a scalar. */
export const LIST_OPERATORS: readonly ConditionOperator[] = ["in", "not_in"];

const ConditionValue = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(500), z.number()])).max(50),
]);

/**
 * One condition on one schema-declared field.
 *
 * `field` is validated against the canonical schema for `objectType` at publish
 * time. The refinements here close the shape: an operator that takes no operand
 * cannot carry one, and a list operator cannot carry a scalar.
 */
export const TriggerConditionSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    triggerVersionId: z.string().uuid(),
    objectType: CanonicalObjectType,
    /** Canonical field path. Source field names are never accepted here. */
    canonicalField: z.string().min(1).max(255),
    operator: ConditionOperator,
    value: ConditionValue.nullable(),
    /** Position in the AND chain. V1 supports conjunction only. */
    ordinal: z.number().int().nonnegative(),
  })
  .strict()
  .refine((c) => !VALUELESS_OPERATORS.includes(c.operator) || c.value === null, {
    message: "changed, exists and not_exists take no value",
  })
  .refine((c) => VALUELESS_OPERATORS.includes(c.operator) || c.value !== null, {
    message: "this operator requires a value",
  })
  .refine((c) => !LIST_OPERATORS.includes(c.operator) || Array.isArray(c.value), {
    message: "in and not_in require an array value",
  })
  .refine((c) => LIST_OPERATORS.includes(c.operator) || !Array.isArray(c.value), {
    message: "only in and not_in accept an array value",
  });
export type TriggerCondition = z.infer<typeof TriggerConditionSchema>;

/* --------------------------------------------------------------- actions -- */

/** Section 12.4. Permitted v1 actions. All are internal. */
export const TriggerActionType = z.enum([
  "recompute_affected_account",
  "recompute_owner_book",
  "create_manager_attention_item",
  "hold_recommendation",
  "notify_admin",
  "notify_manager",
  "notify_account_owner",
  "start_delta_reconciliation",
]);
export type TriggerActionType = z.infer<typeof TriggerActionType>;

/**
 * Section 12.4. Named so the prohibition is testable rather than documentary.
 * None of these is a member of `TriggerActionType`; this list exists to assert
 * that fact in evals and to reject a stored row that predates the constraint.
 */
export const PROHIBITED_TRIGGER_ACTIONS: readonly string[] = [
  "send_customer_message",
  "write_to_crm",
  "change_scoring_policy",
  "approve_recommendation",
  "delete_record",
  "invoke_arbitrary_tool",
  "execute_code",
];

export function isProhibitedTriggerAction(action: string): boolean {
  return PROHIBITED_TRIGGER_ACTIONS.includes(action);
}

/** True only for an action name the closed v1 set allows. */
export function isPermittedTriggerAction(action: string): action is TriggerActionType {
  return TriggerActionType.safeParse(action).success;
}

export const TriggerActionSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    triggerVersionId: z.string().uuid(),
    actionType: TriggerActionType,
    ordinal: z.number().int().nonnegative(),
    /**
     * Closed parameter set. Recipients are roles, never addresses, so a trigger
     * cannot be edited into a channel for reaching a customer.
     */
    params: z
      .object({
        notifyRole: z.enum(["admin", "manager", "account_owner"]).optional(),
        attentionReason: z.string().max(200).optional(),
        holdReason: z.string().max(200).optional(),
      })
      .strict(),
  })
  .strict();
export type TriggerAction = z.infer<typeof TriggerActionSchema>;

/* -------------------------------------------------------------- triggers -- */

export const TriggerState = z.enum(["draft", "published", "paused", "archived"]);
export type TriggerState = z.infer<typeof TriggerState>;

/**
 * The stable identity of a rule. Its behaviour lives in versions, so an
 * execution can always name the exact logic that ran.
 */
export const TriggerDefinitionSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullable(),
    state: TriggerState,
    /** Null until a version is published. */
    activeVersionId: z.string().uuid().nullable(),
    createdBy: z.string().uuid(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine((t) => t.state !== "published" || t.activeVersionId !== null, {
    message: "a published trigger must name an active version",
  });
export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>;

/** What "the result changed enough to act on" means. Section 12.1. */
export const ResultChangeGateSchema = z
  .object({
    /** Fire when the account enters or leaves the top N. */
    topNMembershipChanged: z.boolean(),
    topN: z.number().int().positive().max(500),
    /** Fire when rank moves by at least this many positions. Null disables it. */
    minRankDelta: z.number().int().positive().max(500).nullable(),
  })
  .strict();
export type ResultChangeGate = z.infer<typeof ResultChangeGateSchema>;

/**
 * An immutable published rule (section 15.3). Conditions and actions reference
 * the version, never the definition, so editing a rule creates a new version and
 * leaves historical executions explainable.
 */
export const TriggerVersionSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    triggerId: z.string().uuid(),
    version: z.number().int().positive(),
    eventType: DomainEventType,
    /** Optional audience filter, for example enterprise accounts only. */
    audienceFilter: z
      .object({
        tier: z.array(z.string().max(50)).max(20).optional(),
        ownerIds: z.array(z.string().uuid()).max(200).optional(),
        segment: z.array(z.string().max(50)).max(20).optional(),
      })
      .strict()
      .nullable(),
    resultChangeGate: ResultChangeGateSchema.nullable(),
    /** Aggregates rapid events for one account before acting. */
    debounceSeconds: z.number().int().nonnegative().max(86_400),
    /** Suppresses repeat action for the same account within the window. */
    cooldownSeconds: z.number().int().nonnegative().max(604_800),
    /** Ceiling per workspace per hour, enforced before any action runs. */
    maxExecutionsPerHour: z.number().int().positive().max(10_000),
    retryBudget: z.number().int().nonnegative().max(10),
    /** Required to publish (section 12.5). */
    publishReason: z.string().max(1000).nullable(),
    publishedBy: z.string().uuid().nullable(),
    publishedAt: z.string().datetime().nullable(),
    createdBy: z.string().uuid(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (v) =>
      (v.publishedAt === null) === (v.publishedBy === null) &&
      (v.publishedAt === null) === (v.publishReason === null),
    { message: "publishing requires a publisher and a reason together" },
  );
export type TriggerVersion = z.infer<typeof TriggerVersionSchema>;

/* ------------------------------------------------------------ executions -- */

export const TriggerExecutionState = z.enum([
  "pending",
  "running",
  "succeeded",
  "skipped_debounced",
  "skipped_cooldown",
  "skipped_condition",
  "skipped_rate_limited",
  "failed",
  "dead_lettered",
]);
export type TriggerExecutionState = z.infer<typeof TriggerExecutionState>;

/**
 * One evaluation of one version against one event. A replay preserves the
 * original event and creates a new execution (section 12.5), so the record of
 * what ran is never rewritten.
 */
export const TriggerExecutionSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    triggerId: z.string().uuid(),
    /** The exact logic that ran. Never the definition. */
    triggerVersionId: z.string().uuid(),
    domainEventId: z.string().uuid(),
    state: TriggerExecutionState,
    /** Null until conditions have been evaluated. */
    conditionsMatched: z.boolean().nullable(),
    actionsRun: z.array(TriggerActionType).max(20),
    /** Set when the action recomputed priority for accounts. */
    affectedAccountIds: z.array(z.string().uuid()).max(1000),
    prioritizationRunId: z.string().uuid().nullable(),
    attemptCount: z.number().int().nonnegative(),
    /** Correlates this execution with audit evidence and adapter calls. */
    correlationId: z.string().uuid(),
    /** Redacted. No source payload or customer text. */
    errorCode: z.string().max(100).nullable(),
    errorMessage: z.string().max(1000).nullable(),
    /** True when this execution came from an operator replay. */
    isReplay: z.boolean(),
    replayOfExecutionId: z.string().uuid().nullable(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict()
  .refine((e) => !e.isReplay || e.replayOfExecutionId !== null, {
    message: "a replay must reference the execution it replays",
  });
export type TriggerExecution = z.infer<typeof TriggerExecutionSchema>;

/* ----------------------------------------------------------- dead letter -- */

/**
 * Where exhausted work goes (section 12.5). Kept so an operator can inspect and
 * replay it, which is why the original event reference is mandatory.
 */
export const DeadLetterEventSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    domainEventId: z.string().uuid(),
    triggerExecutionId: z.string().uuid().nullable(),
    sourceId: z.string().uuid().nullable(),
    reason: z.enum([
      "retry_budget_exhausted",
      "permanent_action_failure",
      "invalid_state_transition",
      "workspace_boundary_violation",
      "rate_limit_exhausted",
      "system_error",
    ]),
    errorCode: z.string().min(1).max(100),
    /** Redacted before storage. */
    errorMessage: z.string().max(1000).nullable(),
    attemptCount: z.number().int().nonnegative(),
    state: z.enum(["open", "replayed", "discarded"]),
    /** Set when an operator replays it. Points at the new execution. */
    replayExecutionId: z.string().uuid().nullable(),
    resolvedBy: z.string().uuid().nullable(),
    resolutionReason: z.string().max(1000).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine((d) => d.state !== "replayed" || d.replayExecutionId !== null, {
    message: "a replayed dead letter must reference the replay execution",
  });
export type DeadLetterEvent = z.infer<typeof DeadLetterEventSchema>;
