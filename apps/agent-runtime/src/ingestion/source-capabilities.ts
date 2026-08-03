import type {
  CrmSourceCapabilities,
  FeatureStatus,
} from "@repo/shared-schemas";
import type { AccountFeatureName } from "../agents/account-prioritizer/prioritizer.policy";

export {
  CrmSourceCapabilitiesSchema,
  FeatureStatusSchema,
  type CrmSourceCapabilities,
  type FeatureStatus,
} from "@repo/shared-schemas";

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
