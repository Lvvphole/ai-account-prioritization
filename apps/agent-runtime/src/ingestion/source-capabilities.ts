import { z } from "zod";
import type { AccountFeatureName } from "../agents/account-prioritizer/prioritizer.policy";

export const FeatureStatusSchema = z.enum(["observed", "derived", "unavailable"]);
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

/** A decision feature together with its source and derivation evidence. */
export interface FeatureValue<T> {
  value: T | null;
  status: FeatureStatus;
  sourceIds: string[];
  observedAt: string | null;
  confidence: number | null;
  derivationVersion: string | null;
}

export function unavailableFeature<T>(): FeatureValue<T> {
  return {
    value: null,
    status: "unavailable",
    sourceIds: [],
    observedAt: null,
    confidence: null,
    derivationVersion: null,
  };
}

/**
 * Capabilities describe facts a connector can supply. They prevent the mapper
 * from requesting vendor-specific enrichment fields as universal CRM inputs.
 */
export const CrmSourceCapabilitiesSchema = z.object({
  accounts: z.literal(true),
  contacts: z.boolean().default(false),
  opportunities: z.boolean().default(false),
  activities: z.boolean().default(false),
  accountTier: z.boolean().default(false),
  lifecycleStage: z.boolean().default(false),
  emailEvents: z.boolean().default(false),
  renewals: z.boolean().default(false),
  healthScore: z.boolean().default(false),
  intentSignals: z.boolean().default(false),
});
export type CrmSourceCapabilities = z.infer<typeof CrmSourceCapabilitiesSchema>;

/**
 * Resolve how each prioritization feature can be obtained for one connection.
 * A derived value still requires a versioned deterministic derivation.
 */
export function resolveFeatureModes(
  capabilities: CrmSourceCapabilities,
): Record<AccountFeatureName, FeatureStatus> {
  return {
    pipeline: capabilities.opportunities ? "derived" : "unavailable",
    intent: capabilities.intentSignals
      ? "observed"
      : capabilities.activities || capabilities.emailEvents
        ? "derived"
        : "unavailable",
    staleness: capabilities.activities || capabilities.emailEvents ? "derived" : "unavailable",
    tier: capabilities.accountTier ? "observed" : "unavailable",
    lifecycle: capabilities.lifecycleStage || capabilities.renewals
      ? capabilities.lifecycleStage
        ? "observed"
        : "derived"
      : "unavailable",
    healthRisk: capabilities.healthScore
      ? "observed"
      : capabilities.activities && capabilities.opportunities
        ? "derived"
        : "unavailable",
  };
}
