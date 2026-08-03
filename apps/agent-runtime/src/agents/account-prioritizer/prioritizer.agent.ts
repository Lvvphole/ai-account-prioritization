import {
  CrmSourceCapabilitiesSchema,
  CrmSourceCapabilitySnapshotSchema,
  type CrmSourceCapabilities,
  type CrmSourceCapabilitySnapshot,
  type Recommendation,
} from "@repo/shared-schemas";
import { RUNTIME_CONFIG } from "../../config/runtime";
import { resolveFeatureModes } from "../../ingestion/source-capabilities";
import type { AccountContext } from "./prioritizer.policy";
import { scoreAccounts } from "./tools/score-accounts";
import { rankAccounts, type RankedAccount } from "./tools/rank-accounts";
import { discoverAccountSignals } from "./tools/discover-account-signals";
import { generateReasonCodes } from "./tools/generate-reason-codes";
import { selectNextBestAction } from "./tools/select-next-best-action";
import { REASON_CODE_PHRASES } from "./prioritizer.prompt";

function buildNarrative(ranked: RankedAccount, reasonCodes: string[]): string {
  const phrases = reasonCodes
    .map((c) => REASON_CODE_PHRASES[c])
    .filter((p): p is string => Boolean(p));
  const name = ranked.context.account.name;
  const lead =
    phrases.length > 0
      ? `${name} ${phrases.join(", ")}.`
      : `${name} is a current priority.`;
  return `Priority #${ranked.rank} (score ${ranked.score}). ${lead}`;
}

export interface PrioritizeArgs {
  runId: string;
  contexts: AccountContext[];
  createdAt: string;
  /** Connector capability declarations keyed by canonical account ID. */
  sourceCapabilitiesByAccountId?: Readonly<Record<string, CrmSourceCapabilities>>;
  /** Provenance-bearing capability snapshots keyed by canonical account ID. */
  sourceCapabilitySnapshotsByAccountId?: Readonly<
    Record<string, CrmSourceCapabilitySnapshot>
  >;
}

interface ResolvedAccountSourceAuthority {
  capabilities?: CrmSourceCapabilities;
  snapshot?: CrmSourceCapabilitySnapshot;
}

const CAPABILITY_KEYS = [
  "accounts",
  "contacts",
  "opportunities",
  "activities",
  "accountTier",
  "lifecycleStage",
  "emailEvents",
  "renewals",
  "healthScore",
  "intentSignals",
] as const satisfies readonly (keyof CrmSourceCapabilities)[];

function capabilitiesFromSnapshot(
  snapshot: CrmSourceCapabilitySnapshot,
): CrmSourceCapabilities {
  return CrmSourceCapabilitiesSchema.parse(
    Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, snapshot[key]])),
  );
}

function capabilitiesEqual(
  left: CrmSourceCapabilities,
  right: CrmSourceCapabilities,
): boolean {
  return CAPABILITY_KEYS.every((key) => left[key] === right[key]);
}

function parseCapabilityDeclaration(
  value: CrmSourceCapabilities | undefined,
): ResolvedAccountSourceAuthority {
  if (!value) return {};

  const snapshot = CrmSourceCapabilitySnapshotSchema.safeParse(value);
  if (snapshot.success) {
    return {
      capabilities: capabilitiesFromSnapshot(snapshot.data),
      snapshot: snapshot.data,
    };
  }

  return { capabilities: CrmSourceCapabilitiesSchema.parse(value) };
}

/**
 * Resolve one capability authority object for both scoring and durable evidence.
 * Duplicate declarations are accepted only when their capability content agrees.
 */
function resolveAccountSourceAuthority(
  args: PrioritizeArgs,
  accountId: string,
): ResolvedAccountSourceAuthority {
  const declaration = parseCapabilityDeclaration(
    args.sourceCapabilitiesByAccountId?.[accountId],
  );
  const explicitSnapshotValue = args.sourceCapabilitySnapshotsByAccountId?.[accountId];
  if (!explicitSnapshotValue) return declaration;

  const explicitSnapshot = CrmSourceCapabilitySnapshotSchema.parse(explicitSnapshotValue);
  const snapshotCapabilities = capabilitiesFromSnapshot(explicitSnapshot);
  if (
    declaration.capabilities &&
    !capabilitiesEqual(declaration.capabilities, snapshotCapabilities)
  ) {
    throw new Error(
      `Conflicting CRM source authority for account ${accountId}: scoring capabilities do not match the provenance snapshot.`,
    );
  }

  return {
    capabilities: snapshotCapabilities,
    snapshot: explicitSnapshot,
  };
}

export function prioritizeAccounts(args: PrioritizeArgs): Recommendation[] {
  const authorityByAccountId = new Map(
    args.contexts.map((context) => [
      context.account.id,
      resolveAccountSourceAuthority(args, context.account.id),
    ]),
  );

  const contexts = args.contexts.map((context) => {
    const capabilities = authorityByAccountId.get(context.account.id)?.capabilities;
    return capabilities
      ? {
          ...context,
          sourceCapabilities: capabilities,
          featureModes: resolveFeatureModes(capabilities),
        }
      : context;
  });
  const scored = scoreAccounts(contexts);
  const ranked = rankAccounts(scored);

  return ranked.map((r) => {
    const reasonCodes = generateReasonCodes(r.context, r.features);
    const sourceSignals = discoverAccountSignals(r.context, r.features, reasonCodes);
    const nextBestAction = selectNextBestAction(
      r.context,
      reasonCodes,
      r.confidence,
      RUNTIME_CONFIG.minPublishableConfidence,
    );
    const sourceCapabilitySnapshot = authorityByAccountId.get(r.accountId)?.snapshot;

    const rec: Recommendation = {
      id: `rec_${args.runId}_${r.accountId}`,
      runId: args.runId,
      accountId: r.accountId,
      ownerId: r.ownerId,
      score: r.score,
      rank: r.rank,
      confidence: r.confidence,
      reasonCodes,
      reasonNarrative: buildNarrative(r, reasonCodes),
      sourceSignals,
      ...(sourceCapabilitySnapshot ? { sourceCapabilitySnapshot } : {}),
      nextBestAction,
      verification: {
        status: "pending",
        schemaValid: false,
        guardrailsPassed: false,
        sourceSignalsVerified: false,
        permissionGranted: false,
        failedGates: [],
        checkedAt: args.createdAt,
      },
      approvalStatus:
        nextBestAction.customerFacing || nextBestAction.crmWriteBack
          ? "pending_approval"
          : "not_required",
      published: false,
      createdAt: args.createdAt,
    };
    return rec;
  });
}
