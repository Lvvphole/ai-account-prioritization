import { z } from "zod";

/** EvalResult — output of a deterministic eval or an async LLM judge. */
export const EvalKind = z.enum(["deterministic", "llm_judge", "security", "guardrail"]);
export type EvalKind = z.infer<typeof EvalKind>;

export const EvalCaseResultSchema = z.object({
  caseId: z.string().min(1),
  passed: z.boolean(),
  score: z.number().min(0).max(1).optional(),
  threshold: z.number().min(0).max(1).optional(),
  details: z.string().optional(),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResultSchema>;

export const EvalResultSchema = z.object({
  suite: z.string().min(1),
  kind: EvalKind,
  passed: z.boolean(),
  passRate: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  cases: z.array(EvalCaseResultSchema),
  /** Whether this eval is allowed to block deployment. */
  deploymentBlocking: z.boolean().default(false),
  ranAt: z.string().datetime(),
});
export type EvalResult = z.infer<typeof EvalResultSchema>;

/** Verdict returned by the LLM-as-a-judge (async, never in runtime). */
export const JudgeVerdictSchema = z.object({
  caseId: z.string().min(1),
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  rationale: z.string().min(1),
  /** Source of the verdict: real model call vs deterministic heuristic fallback. */
  source: z.enum(["model", "heuristic"]),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;
