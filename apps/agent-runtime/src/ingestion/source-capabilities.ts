import type {
  CrmSourceCapabilities,
  CrmSourceCapabilitySnapshot,
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

const OFFSET_BEARING_ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export type CapabilityTemporalStatus = "fresh" | "stale" | "future";

export interface CapabilityTemporalAssessment {
  status: CapabilityTemporalStatus;
  failedGate: "CAPABILITY_SNAPSHOT_STALE" | "CAPABILITY_SNAPSHOT_FUTURE" | null;
  ageMs: number;
}

export interface CapabilityAuthorityHold {
  accountId: string;
  snapshot?: CrmSourceCapabilitySnapshot;
  failedGate:
    | "CAPABILITY_SNAPSHOT_MISSING"
    | "CAPABILITY_SNAPSHOT_STALE"
    | "CAPABILITY_SNAPSHOT_FUTURE";
}

export interface CapabilityAuthorityPartition {
  eligibleAccountIds: string[];
  holds: CapabilityAuthorityHold[];
}

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

function parseAuthorityInstant(value: string, label: string): number {
  if (!OFFSET_BEARING_ISO_INSTANT.test(value)) {
    throw new Error(`${label} must be an offset-bearing ISO timestamp.`);
  }

  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  return milliseconds;
}

/**
 * Classify capability evidence against the injected decision clock.
 * Ordinary stale or future evidence is a per-account business state, not an
 * infrastructure exception. Invalid timestamp syntax remains a contract error.
 */
export function assessCapabilitySnapshotTemporalAuthority(
  observedAt: string,
  nowIso: string,
): CapabilityTemporalAssessment {
  const observedMs = parseAuthorityInstant(observedAt, "Capability snapshot observedAt");
  const nowMs = parseAuthorityInstant(nowIso, "Decision clock");
  const ageMs = nowMs - observedMs;

  if (ageMs < 0) {
    return {
      status: "future",
      failedGate: "CAPABILITY_SNAPSHOT_FUTURE",
      ageMs,
    };
  }
  if (ageMs > CAPABILITY_SNAPSHOT_MAX_AGE_MS) {
    return {
      status: "stale",
      failedGate: "CAPABILITY_SNAPSHOT_STALE",
      ageMs,
    };
  }
  return { status: "fresh", failedGate: null, ageMs };
}

/**
 * Partition durable account authority before scoring. One invalid account does
 * not abort unrelated work. Returned order is explicit ordinal account-ID order.
 */
export function partitionCapabilityAuthority(
  accountIds: readonly string[],
  snapshots: Readonly<Record<string, CrmSourceCapabilitySnapshot>>,
  nowIso: string,
): CapabilityAuthorityPartition {
  // Validate the decision clock even when there are no snapshots.
  parseAuthorityInstant(nowIso, "Decision clock");

  const eligibleAccountIds: string[] = [];
  const holds: CapabilityAuthorityHold[] = [];
  const orderedAccountIds = [...accountIds].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  for (const accountId of orderedAccountIds) {
    const snapshot = snapshots[accountId];
    if (!snapshot) {
      holds.push({ accountId, failedGate: "CAPABILITY_SNAPSHOT_MISSING" });
      continue;
    }

    const assessment = assessCapabilitySnapshotTemporalAuthority(snapshot.observedAt, nowIso);
    if (assessment.status === "fresh") {
      eligibleAccountIds.push(accountId);
      continue;
    }

    holds.push({
      accountId,
      snapshot,
      failedGate:
        assessment.failedGate ??
        (assessment.status === "future"
          ? "CAPABILITY_SNAPSHOT_FUTURE"
          : "CAPABILITY_SNAPSHOT_STALE"),
    });
  }

  return { eligibleAccountIds, holds };
}

/**
 * Strict assertion for callers that explicitly require fresh authority.
 * Production reconciliation should classify per account instead of using this
 * assertion as a batch-read gate.
 */
export function assertCapabilitySnapshotFresh(observedAt: string, nowIso: string): void {
  const assessment = assessCapabilitySnapshotTemporalAuthority(observedAt, nowIso);
  if (assessment.status === "future") {
    throw new Error(
      `Capability snapshot is newer than the injected decision clock under ${CAPABILITY_SNAPSHOT_FRESHNESS_POLICY_VERSION}.`,
    );
  }
  if (assessment.status === "stale") {
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
