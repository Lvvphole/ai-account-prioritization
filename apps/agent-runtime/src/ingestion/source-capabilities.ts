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
    // Activity and email data do not become intent automatically. The current
    // scorer requires authoritative intent signal codes that map to verified
    // observations. Keep intent unavailable until a versioned derivation exists.
    intent: capabilities.intentSignals ? "observed" : "unavailable",
    staleness: capabilities.activities || capabilities.emailEvents ? "derived" : "unavailable",
    tier: capabilities.accountTier ? "observed" : "unavailable",
    // A renewal-to-lifecycle derivation is not implemented or versioned yet.
    lifecycle: capabilities.lifecycleStage ? "observed" : "unavailable",
    // A derived health formula is not implemented or versioned yet.
    healthRisk: capabilities.healthScore ? "observed" : "unavailable",
  };
}
