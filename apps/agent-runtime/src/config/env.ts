import { z } from "zod";

/**
 * Runtime environment configuration.
 *
 * Parsed once, fail-fast, with safety-first defaults. The deterministic runtime
 * path requires NONE of the optional integrations; absent values degrade to
 * in-memory/no-op behavior so the core loop is always runnable and testable.
 */
const boolFromEnv = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === "boolean" ? v : v.toLowerCase() === "true"))
    .pipe(z.boolean())
    .default(def);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Hard safety default: human approval is required and cannot be silently off. */
  REQUIRE_HUMAN_APPROVAL: boolFromEnv(true),

  /** Async judge controls — never consulted by the runtime path. */
  EVAL_JUDGE_ENABLED: boolFromEnv(false),
  EVAL_JUDGE_MODEL: z.string().default("claude-opus-4-8"),
  ANTHROPIC_API_KEY: z.string().optional(),

  /** Optional CRM integration. Absent -> in-memory repository. */
  CRM_BASE_URL: z.string().url().optional(),
  CRM_API_KEY: z.string().optional(),

  /** Optional database. Absent -> in-memory store. */
  DATABASE_URL: z.string().optional(),

  /**
   * Optional Supabase wiring. When SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
   * present AND a run supplies an RLS context, the runtime reads source signals
   * from Supabase and writes audit evidence to `audit_evidence`. Absent values
   * keep the runtime on the deterministic, offline in-memory store (evals/CI).
   */
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  cached = EnvSchema.parse(process.env);
  return cached;
}

/** Test/seam helper: override env (used by deterministic evals). */
export function __setEnvForTesting(partial: Partial<Env>): void {
  cached = { ...getEnv(), ...partial };
}
