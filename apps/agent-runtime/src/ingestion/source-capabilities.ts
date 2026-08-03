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

export const CAPABILITY_SNAPSHOT_FRESHNESS_POLICY_VERSION =
  "crm-source-capability-max-age-7d-v1";
export const CAPABILITY_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
 * Reject capability authority that is too old or is observed after the injected
 * decision clock. The policy version changes when the maximum age changes.
 */
export function assertCapabilitySnapshotFresh(observedAt: string, nowIso: string): void {
  const observedMs = Date.parse(observedAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) {
    throw new Error("Capability snapshot freshness requires valid ISO timestamps.");
  }

  const ageMs = nowMs - observedMs;
  if (ageMs < 0) {
    throw new Error(
      `Capability snapshot is newer than the injected decision clock under ${CAPABILITY_SNAPSHOT_FRESHNESS_POLICY_VERSION}.`,
    );
  }
  if (ageMs > CAPABILITY_SNAPSHOT_MAX_AGE_MS) {
    throw new Error(
      `Capability snapshot is stale under ${CAPABILITY_SNAPSHOT_FRESHNESS_POLICY_VERSION}.`,
    );
  }
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
    // Activity/email availability alone does not define an authoritative
    // account-level last-contact aggregate. Keep staleness unavailable until a
    // versioned deterministic derivation produces that value.
    staleness: "unavailable",
    tier: capabilities.accountTier ? "observed" : "unavailable",
    // A renewal-to-lifecycle derivation is not implemented or versioned yet.
    lifecycle: capabilities.lifecycleStage ? "observed" : "unavailable",
    // A derived health formula is not implemented or versioned yet.
    healthRisk: capabilities.healthScore ? "observed" : "unavailable",
  };
}
