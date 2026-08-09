import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AccountSchema,
  DEFAULT_IMPORT_LIMITS,
  OpportunitySchema,
  SourceFieldMappingSchema,
  type Account,
  type FieldTransform,
  type Opportunity,
  type ParsedRow,
  type SourceFieldMapping,
} from "@repo/shared-schemas";
import {
  assessApproval,
  assertCommitPlanSafe,
  buildChangeSet,
  normalizeRow,
  parseCsvStream,
  planCommit,
  validateBatch,
  type CommitPlan,
  type DataStore,
  type NormalizedRow,
  type OperationalSnapshot,
  type ValidatedRow,
} from "agent-runtime";

export const ACCEPTANCE_A_NOW = "2026-08-03T07:00:00.000Z";
export const ACCEPTANCE_A_WORKSPACE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
export const ACCEPTANCE_A_DURABLE_OWNER_ID = "33333333-3333-3333-3333-333333333333";

const APPROVED_SOURCE_SHA256 = "34e7acfbf58740f057cc5b10da49ad6d03f1aae8376d1b8101b6ef9944b29692";
const FIXTURE_ID = "acceptance-a-crm-derived-synthetic-v2";
const FIXTURE_MANIFEST = "acceptance-a-crm-derived-synthetic.manifest.json";
const CSV_CHUNK_BYTES = 64 * 1024;

const EXPECTED_HEADERS = [
  "objectType", "externalId", "accountExternalId", "name", "ownerId", "tier",
  "lifecycleStage", "industry", "employeeCount", "openPipelineUsd", "renewalDate",
  "notes", "stage", "amountUsd", "closeDate", "nextStep", "measuredAt",
  "healthScore", "supportTicketsOpen", "usageTrend",
] as const;

type FixtureObjectType = "account" | "account_health" | "opportunity";
type Stage = "discovery" | "qualification" | "closed_won" | "closed_lost";

type FixtureManifest = {
  version: number;
  fixtureId: string;
  purpose: string;
  source: { originalFile: string; sha256: string; rows: number };
  sourceShape: {
    ownerCount: number;
    resolvedAccountReferenceRows: number;
    uniqueResolvedAccounts: number;
    unresolvedMissingAccountRows: number;
    resolvedStageCounts: Record<Stage, number>;
    unresolvedStageCounts: Partial<Record<Stage, number>>;
    resolvedLifecycleCounts: { open_opportunity: number; customer: number; dormant: number };
    unresolvedOwnerCounts: number[];
  };
  generated: {
    csvSha256: string;
    csvBytes: number;
    rows: number;
    accounts: number;
    accountHealth: number;
    opportunities: number;
    owners: number;
    totalOpenPipelineUsd: number;
  };
  durableRepresentative: { ownerId: string; sourceUnresolvedOpportunityCount: number };
  safety: {
    productionUse: boolean;
    syntheticFixture: boolean;
    humanApprovedFabrication: boolean;
    approvalInvariantBypassed: boolean;
    verifiedInteractionEvidenceFabricated: boolean;
  };
};

export interface AcceptanceAIngestionBatchEvidence {
  objectType: FixtureObjectType;
  rows: number;
  ready: number;
  warnings: number;
  quarantined: number;
  rejected: number;
  duplicates: number;
  commitEntries: number;
  secondApprovalRequired: boolean;
  approvalReasons: string[];
  batchFindingRuleIds: string[];
}

export interface AcceptanceACrmFixture {
  store: DataStore;
  manifest: FixtureManifest;
  workspaceMemberIds: string[];
  ingestion: AcceptanceAIngestionBatchEvidence[];
}

interface PlannedFixtureBatch {
  plan: CommitPlan;
  evidence: AcceptanceAIngestionBatchEvidence;
}

interface MappingRule {
  canonicalField: string;
  transform: FieldTransform;
  required: boolean;
}

interface GeneratedOpportunity {
  accountExternalId: string;
  stage: Stage;
  amountUsd: number;
}

const RULES: Record<FixtureObjectType, Readonly<Record<string, MappingRule>>> = {
  account: {
    externalId: { canonicalField: "externalId", transform: "trim", required: true },
    name: { canonicalField: "name", transform: "trim", required: true },
    ownerId: { canonicalField: "ownerId", transform: "trim", required: true },
    tier: { canonicalField: "tier", transform: "lowercase", required: true },
    lifecycleStage: { canonicalField: "lifecycleStage", transform: "lowercase", required: true },
    industry: { canonicalField: "industry", transform: "trim", required: false },
    employeeCount: { canonicalField: "employeeCount", transform: "parse_integer", required: false },
    openPipelineUsd: { canonicalField: "openPipelineUsd", transform: "normalize_currency_usd", required: false },
    renewalDate: { canonicalField: "renewalDate", transform: "parse_iso_date", required: false },
    notes: { canonicalField: "notes", transform: "none", required: false },
  },
  account_health: {
    externalId: { canonicalField: "externalId", transform: "trim", required: true },
    accountExternalId: { canonicalField: "accountExternalId", transform: "trim", required: true },
    measuredAt: { canonicalField: "measuredAt", transform: "parse_iso_date", required: true },
    healthScore: { canonicalField: "healthScore", transform: "parse_decimal", required: false },
    supportTicketsOpen: { canonicalField: "supportTicketsOpen", transform: "parse_integer", required: false },
    usageTrend: { canonicalField: "usageTrend", transform: "lowercase", required: false },
  },
  opportunity: {
    externalId: { canonicalField: "externalId", transform: "trim", required: true },
    accountExternalId: { canonicalField: "accountExternalId", transform: "trim", required: true },
    name: { canonicalField: "name", transform: "trim", required: true },
    stage: { canonicalField: "stage", transform: "lowercase", required: true },
    amountUsd: { canonicalField: "amountUsd", transform: "normalize_currency_usd", required: false },
    closeDate: { canonicalField: "closeDate", transform: "parse_iso_date", required: false },
    ownerId: { canonicalField: "ownerId", transform: "trim", required: false },
    nextStep: { canonicalField: "nextStep", transform: "none", required: false },
  },
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ACCEPTANCE_A_FIXTURE_INVALID:${message}`);
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function deterministicFixtureUuid(scope: string, value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(`${scope}:${value}`, "utf8").digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fixturePath(filename: string): string {
  return resolve(__dirname, "fixtures", "acceptance-a", filename);
}

function readManifest(): FixtureManifest {
  const parsed = JSON.parse(readFileSync(fixturePath(FIXTURE_MANIFEST), "utf8")) as FixtureManifest;
  invariant(parsed.version === 2, "manifest_version");
  invariant(parsed.fixtureId === FIXTURE_ID, "fixture_id");
  invariant(parsed.source.sha256 === APPROVED_SOURCE_SHA256, "source_sha256");
  invariant(parsed.source.rows === 11_000, "source_row_count");
  invariant(parsed.sourceShape.ownerCount === 30, "source_owner_count");
  invariant(parsed.sourceShape.resolvedAccountReferenceRows === 9_200, "source_resolved_rows");
  invariant(parsed.sourceShape.uniqueResolvedAccounts === 125, "source_resolved_accounts");
  invariant(parsed.sourceShape.unresolvedMissingAccountRows === 1_800, "source_unresolved_rows");
  invariant(parsed.sourceShape.unresolvedOwnerCounts.length === 30, "source_owner_distribution_count");
  invariant(parsed.sourceShape.unresolvedOwnerCounts.reduce((sum, count) => sum + count, 0) === 1_800, "source_owner_distribution_total");
  invariant(parsed.generated.rows === 14_850, "generated_rows");
  invariant(parsed.generated.accounts === 1_925, "generated_accounts");
  invariant(parsed.generated.accountHealth === 1_925, "generated_account_health");
  invariant(parsed.generated.opportunities === 11_000, "generated_opportunities");
  invariant(parsed.generated.owners === 30, "generated_owners");
  invariant(parsed.durableRepresentative.ownerId === ACCEPTANCE_A_DURABLE_OWNER_ID, "durable_owner_id");
  invariant(parsed.safety.productionUse === false, "production_use_must_be_false");
  invariant(parsed.safety.syntheticFixture === true, "synthetic_fixture_marker");
  invariant(parsed.safety.humanApprovedFabrication === true, "fabrication_approval_marker");
  invariant(parsed.safety.approvalInvariantBypassed === false, "approval_bypass_marker");
  invariant(parsed.safety.verifiedInteractionEvidenceFabricated === false, "fabricated_interaction_evidence_marker");
  return parsed;
}

function generateOwnerIds(manifest: FixtureManifest): string[] {
  return [
    ACCEPTANCE_A_DURABLE_OWNER_ID,
    ...Array.from({ length: manifest.sourceShape.ownerCount - 1 }, (_, offset) =>
      deterministicFixtureUuid(
        "acceptance-a-owner",
        `${manifest.source.sha256}:${String(offset + 1).padStart(2, "0")}`,
      ),
    ),
  ];
}

function amountFor(stage: Stage, index: number): number {
  if (stage === "discovery") return 10_000 + ((index * 7_919) % 900) * 100;
  if (stage === "qualification") return 25_000 + ((index * 7_919) % 1_750) * 100;
  return 5_000 + ((index * 3_571) % 4_950) * 100;
}

function generateFixtureCsv(manifest: FixtureManifest): { csv: string; workspaceMemberIds: string[] } {
  const owners = generateOwnerIds(manifest);
  const ownerSlots = manifest.sourceShape.unresolvedOwnerCounts.flatMap((count, slot) =>
    Array.from({ length: count }, () => slot),
  );
  invariant(ownerSlots.length === 1_800, "generated_owner_slots");

  const opportunities: GeneratedOpportunity[] = [];
  let opportunityIndex = 1;
  const appendResolved = (stage: Stage, count: number, accountCount: number): void => {
    for (let offset = 0; offset < count; offset += 1) {
      opportunities.push({
        accountExternalId: `acct_src_${String((offset % accountCount) + 1).padStart(4, "0")}`,
        stage,
        amountUsd: amountFor(stage, opportunityIndex),
      });
      opportunityIndex += 1;
    }
  };
  appendResolved("qualification", manifest.sourceShape.resolvedStageCounts.qualification, 98);
  appendResolved("discovery", manifest.sourceShape.resolvedStageCounts.discovery, 98);
  appendResolved("closed_won", manifest.sourceShape.resolvedStageCounts.closed_won, 124);
  appendResolved("closed_lost", manifest.sourceShape.resolvedStageCounts.closed_lost, 125);
  invariant(opportunities.length === 9_200, "generated_resolved_opportunities");

  for (let offset = 0; offset < 1_800; offset += 1) {
    const stage: Stage = offset < (manifest.sourceShape.unresolvedStageCounts.qualification ?? 0)
      ? "qualification"
      : "discovery";
    opportunities.push({
      accountExternalId: `acct_syn_${String(offset + 1).padStart(4, "0")}`,
      stage,
      amountUsd: amountFor(stage, opportunityIndex),
    });
    opportunityIndex += 1;
  }
  invariant(opportunities.length === 11_000, "generated_opportunity_count");

  const accountExternalIds = [
    ...Array.from({ length: 125 }, (_, offset) => `acct_src_${String(offset + 1).padStart(4, "0")}`),
    ...Array.from({ length: 1_800 }, (_, offset) => `acct_syn_${String(offset + 1).padStart(4, "0")}`),
  ];
  const accountOwner = new Map<string, string>();
  for (let index = 0; index < 125; index += 1) {
    accountOwner.set(accountExternalIds[index] as string, owners[index % owners.length] as string);
  }
  for (let index = 0; index < 1_800; index += 1) {
    accountOwner.set(
      `acct_syn_${String(index + 1).padStart(4, "0")}`,
      owners[ownerSlots[index] as number] as string,
    );
  }

  const openPipeline = new Map(accountExternalIds.map((id) => [id, 0]));
  const stagesByAccount = new Map(accountExternalIds.map((id) => [id, new Set<Stage>()]));
  for (const opportunity of opportunities) {
    stagesByAccount.get(opportunity.accountExternalId)?.add(opportunity.stage);
    if (opportunity.stage !== "closed_won" && opportunity.stage !== "closed_lost") {
      openPipeline.set(
        opportunity.accountExternalId,
        (openPipeline.get(opportunity.accountExternalId) ?? 0) + opportunity.amountUsd,
      );
    }
  }

  const rows: Record<string, string>[] = [];
  const addRow = (values: Record<string, string>): void => {
    const row = Object.fromEntries(EXPECTED_HEADERS.map((header) => [header, values[header] ?? ""]));
    for (const value of Object.values(row)) invariant(!/[",\r\n]/.test(value), "generated_csv_escaping");
    rows.push(row);
  };
  const lifecycleFor = (accountExternalId: string): string => {
    const stages = stagesByAccount.get(accountExternalId) ?? new Set<Stage>();
    if (stages.has("discovery") || stages.has("qualification")) return "open_opportunity";
    if (stages.has("closed_won")) return "customer";
    return "dormant";
  };

  for (let index = 0; index < accountExternalIds.length; index += 1) {
    const externalId = accountExternalIds[index] as string;
    const sourceResolved = index < 125;
    addRow({
      objectType: "account",
      externalId,
      name: sourceResolved
        ? `Source-Derived Test Account ${String(index + 1).padStart(4, "0")}`
        : `Synthetic Missing-Parent Test Account ${String(index - 124).padStart(4, "0")}`,
      ownerId: accountOwner.get(externalId) as string,
      tier: "mid_market",
      lifecycleStage: lifecycleFor(externalId),
      industry: "synthetic_test_fixture",
      employeeCount: "1000",
      openPipelineUsd: (openPipeline.get(externalId) ?? 0).toFixed(2),
      notes: `SYNTHETIC_ACCEPTANCE_A_FIXTURE source_sha256=${manifest.source.sha256}`,
    });
  }

  for (let index = 0; index < accountExternalIds.length; index += 1) {
    addRow({
      objectType: "account_health",
      externalId: `health_test_${String(index + 1).padStart(4, "0")}`,
      accountExternalId: accountExternalIds[index] as string,
      measuredAt: "2026-08-02",
      healthScore: "50",
      supportTicketsOpen: "0",
      usageTrend: "flat",
    });
  }

  for (let index = 0; index < opportunities.length; index += 1) {
    const opportunity = opportunities[index] as GeneratedOpportunity;
    addRow({
      objectType: "opportunity",
      externalId: `opp_test_${String(index + 1).padStart(5, "0")}`,
      accountExternalId: opportunity.accountExternalId,
      name: `Test Opportunity ${String(index + 1).padStart(5, "0")}`,
      ownerId: accountOwner.get(opportunity.accountExternalId) as string,
      stage: opportunity.stage,
      amountUsd: opportunity.amountUsd.toFixed(2),
      closeDate:
        opportunity.stage === "closed_won" || opportunity.stage === "closed_lost"
          ? "2026-08-02"
          : "",
    });
  }

  invariant(rows.length === manifest.generated.rows, "generated_combined_rows");
  const csv = `${EXPECTED_HEADERS.join(",")}\n${rows
    .map((row) => EXPECTED_HEADERS.map((header) => row[header]).join(","))
    .join("\n")}\n`;
  invariant(Buffer.byteLength(csv, "utf8") === manifest.generated.csvBytes, "generated_csv_bytes");
  invariant(sha256(csv) === manifest.generated.csvSha256, "generated_csv_hash");
  return { csv, workspaceMemberIds: owners };
}

async function parseFixtureCsv(csv: string, manifest: FixtureManifest): Promise<ParsedRow[]> {
  const bytes = Buffer.from(csv, "utf8");
  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < bytes.byteLength; offset += CSV_CHUNK_BYTES) {
      yield bytes.subarray(offset, Math.min(offset + CSV_CHUNK_BYTES, bytes.byteLength));
    }
  }
  const rows: ParsedRow[] = [];
  const outcome = await parseCsvStream(chunks(), (row) => rows.push(row), {
    limits: DEFAULT_IMPORT_LIMITS,
    now: () => 0,
  });
  invariant(outcome.fatal === null, `parser_fatal_${outcome.fatal ?? "unknown"}`);
  invariant(outcome.rowErrors.length === 0, "parser_row_errors");
  invariant(outcome.truncated === false, "parser_truncated");
  invariant(outcome.rowsParsed === manifest.generated.rows, "parser_row_count");
  invariant(JSON.stringify(outcome.headers) === JSON.stringify(EXPECTED_HEADERS), "headers");
  return rows;
}

function mappingsFor(objectType: FixtureObjectType): SourceFieldMapping[] {
  const mappingVersionId = deterministicFixtureUuid("acceptance-a-mapping", objectType);
  return EXPECTED_HEADERS.map((sourceField) => {
    const rule = RULES[objectType][sourceField];
    return SourceFieldMappingSchema.parse({
      id: deterministicFixtureUuid(`acceptance-a-mapping-${objectType}`, sourceField),
      workspaceId: ACCEPTANCE_A_WORKSPACE_ID,
      mappingVersionId,
      objectType,
      sourceField,
      canonicalField: rule?.canonicalField ?? null,
      disposition: rule ? "mapped" : "explicitly_ignored",
      transform: rule?.transform ?? "none",
      required: rule?.required ?? false,
      suggestionConfidence: null,
      warning: null,
    });
  });
}

function partitionRows(
  rows: readonly ParsedRow[],
  manifest: FixtureManifest,
): Record<FixtureObjectType, ParsedRow[]> {
  const partitioned: Record<FixtureObjectType, ParsedRow[]> = {
    account: [],
    account_health: [],
    opportunity: [],
  };
  for (const row of rows) {
    const objectType = row.values.objectType;
    invariant(
      objectType === "account" || objectType === "account_health" || objectType === "opportunity",
      `unsupported_object_type_row_${row.rowNumber}`,
    );
    partitioned[objectType].push(row);
  }
  invariant(partitioned.account.length === manifest.generated.accounts, "partition_accounts");
  invariant(partitioned.account_health.length === manifest.generated.accountHealth, "partition_account_health");
  invariant(partitioned.opportunity.length === manifest.generated.opportunities, "partition_opportunities");
  return partitioned;
}

function normalizeFixtureRows(rows: readonly ParsedRow[], objectType: FixtureObjectType): NormalizedRow[] {
  const mappings = mappingsFor(objectType);
  return rows.map((row) => normalizeRow(row, objectType, mappings));
}

function planFixtureBatch(input: {
  objectType: FixtureObjectType;
  normalized: NormalizedRow[];
  knownAccountExternalIds: ReadonlySet<string>;
  workspaceMemberIds: ReadonlySet<string>;
  totalAccounts: number;
  totalOpenPipelineUsd: number;
}): PlannedFixtureBatch {
  const validatedResult = validateBatch(input.normalized, {
    workspaceId: ACCEPTANCE_A_WORKSPACE_ID,
    knownExternalIds: new Set<string>(),
    knownAccountExternalIds: input.knownAccountExternalIds,
    workspaceMemberIds: input.workspaceMemberIds,
    baseline: {
      accountCount: input.totalAccounts,
      totalOpenPipelineUsd: input.totalOpenPipelineUsd,
    },
    now: new Date(ACCEPTANCE_A_NOW),
  });
  invariant(validatedResult.counts.ready === input.normalized.length, `${input.objectType}_ready_count`);
  invariant(validatedResult.counts.warning === 0, `${input.objectType}_warning_count`);
  invariant(validatedResult.counts.quarantined === 0, `${input.objectType}_quarantined_count`);
  invariant(validatedResult.counts.rejected === 0, `${input.objectType}_rejected_count`);
  invariant(validatedResult.counts.duplicate === 0, `${input.objectType}_duplicate_count`);

  const snapshot: OperationalSnapshot = {
    existingByExternalId: new Map(),
    totalAccounts: input.totalAccounts,
    totalOpenPipelineUsd: input.totalOpenPipelineUsd,
    currentTopN: [],
  };
  const preview = buildChangeSet(validatedResult.rows, snapshot);
  invariant(preview.excluded.length === 0, `${input.objectType}_preview_exclusions`);
  invariant(preview.referentialFailures === 0, `${input.objectType}_referential_failures`);
  const approval = assessApproval(preview, validatedResult.rows, snapshot);
  invariant(approval.blockers.length === 0, `${input.objectType}_approval_blockers`);
  invariant(approval.secondApprovalRequired, `${input.objectType}_second_approval_required`);

  const batchId = `acceptance-a-fixture-${input.objectType}`;
  const plan = planCommit({
    batchId,
    workspaceId: ACCEPTANCE_A_WORKSPACE_ID,
    changeSetId: `acceptance-a-fixture-change-set-${input.objectType}`,
    authorization: {
      workspaceId: ACCEPTANCE_A_WORKSPACE_ID,
      batchId,
      approvalId: `acceptance-a-fixture-approval-${input.objectType}`,
      approvedBy: deterministicFixtureUuid("acceptance-a-fixture-import-approver", "one"),
      secondApprovalRequired: approval.secondApprovalRequired,
      secondApprovedBy: deterministicFixtureUuid("acceptance-a-fixture-import-approver", "two"),
    },
    preview,
    validated: validatedResult.rows,
    snapshot,
  });
  assertCommitPlanSafe(plan, validatedResult.rows);
  invariant(plan.entries.length === input.normalized.length, `${input.objectType}_commit_entry_count`);
  invariant(plan.skipped.length === 0, `${input.objectType}_commit_skipped_count`);
  return {
    plan,
    evidence: {
      objectType: input.objectType,
      rows: input.normalized.length,
      ready: validatedResult.counts.ready,
      warnings: validatedResult.counts.warning,
      quarantined: validatedResult.counts.quarantined,
      rejected: validatedResult.counts.rejected,
      duplicates: validatedResult.counts.duplicate,
      commitEntries: plan.entries.length,
      secondApprovalRequired: approval.secondApprovalRequired,
      approvalReasons: [...approval.reasons],
      batchFindingRuleIds: validatedResult.batchFindings.map((finding) => finding.ruleId).sort(),
    },
  };
}

function requiredString(values: Record<string, unknown>, field: string, context: string): string {
  const value = values[field];
  invariant(typeof value === "string" && value.length > 0, `${context}_${field}`);
  return value;
}

function optionalString(values: Record<string, unknown>, field: string): string | undefined {
  const value = values[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(values: Record<string, unknown>, field: string): number | undefined {
  const value = values[field];
  return typeof value === "number" ? value : undefined;
}

function materializeStore(
  accountsBatch: PlannedFixtureBatch,
  healthBatch: PlannedFixtureBatch,
  opportunitiesBatch: PlannedFixtureBatch,
): DataStore {
  const healthByAccountExternalId = new Map<string, number>();
  for (const entry of healthBatch.plan.entries) {
    const parent = requiredString(entry.values, "accountExternalId", `health_row_${entry.sourceRowNumber}`);
    const healthScore = optionalNumber(entry.values, "healthScore");
    if (healthScore !== undefined) healthByAccountExternalId.set(parent, healthScore);
  }

  const internalAccountIdByExternalId = new Map<string, string>();
  const accounts: Account[] = accountsBatch.plan.entries
    .map((entry) => {
      const externalId = entry.externalId;
      const id = deterministicFixtureUuid("acceptance-a-account", externalId);
      internalAccountIdByExternalId.set(externalId, id);
      return AccountSchema.parse({
        id,
        name: requiredString(entry.values, "name", `account_row_${entry.sourceRowNumber}`),
        ownerId: requiredString(entry.values, "ownerId", `account_row_${entry.sourceRowNumber}`),
        tier: requiredString(entry.values, "tier", `account_row_${entry.sourceRowNumber}`),
        lifecycleStage: requiredString(
          entry.values,
          "lifecycleStage",
          `account_row_${entry.sourceRowNumber}`,
        ),
        industry: optionalString(entry.values, "industry"),
        employeeCount: optionalNumber(entry.values, "employeeCount"),
        openPipelineUsd: optionalNumber(entry.values, "openPipelineUsd") ?? 0,
        healthScore: healthByAccountExternalId.get(externalId),
        intentSignals: [],
        dataQualityFlags: [],
        createdAt: ACCEPTANCE_A_NOW,
        updatedAt: ACCEPTANCE_A_NOW,
      });
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const opportunities: Opportunity[] = opportunitiesBatch.plan.entries
    .map((entry) => {
      const accountExternalId = requiredString(
        entry.values,
        "accountExternalId",
        `opportunity_row_${entry.sourceRowNumber}`,
      );
      const accountId = internalAccountIdByExternalId.get(accountExternalId);
      invariant(accountId !== undefined, `opportunity_parent_${entry.sourceRowNumber}`);
      const stage = requiredString(entry.values, "stage", `opportunity_row_${entry.sourceRowNumber}`);
      const closeDate = optionalString(entry.values, "closeDate");
      const nextStep = optionalString(entry.values, "nextStep");
      return OpportunitySchema.parse({
        id: deterministicFixtureUuid("acceptance-a-opportunity", entry.externalId),
        accountId,
        name: requiredString(entry.values, "name", `opportunity_row_${entry.sourceRowNumber}`),
        stage,
        amountUsd: optionalNumber(entry.values, "amountUsd") ?? 0,
        isClosed: stage === "closed_won" || stage === "closed_lost",
        isWon: stage === "closed_won",
        ...(closeDate ? { closeDate } : {}),
        ...(nextStep ? { nextStep } : {}),
        createdAt: ACCEPTANCE_A_NOW,
        updatedAt: ACCEPTANCE_A_NOW,
      });
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const openPipelineByAccount = new Map<string, number>();
  for (const opportunity of opportunities) {
    if (!opportunity.isClosed) {
      openPipelineByAccount.set(
        opportunity.accountId,
        (openPipelineByAccount.get(opportunity.accountId) ?? 0) + opportunity.amountUsd,
      );
    }
  }
  for (const account of accounts) {
    const expected = Math.round((openPipelineByAccount.get(account.id) ?? 0) * 100) / 100;
    invariant(
      Math.abs(account.openPipelineUsd - expected) < 0.005,
      `account_pipeline_reconciliation_${account.id}`,
    );
  }
  return { accounts, contacts: [], opportunities, activities: [], auditLog: [], analytics: [] };
}

export async function buildAcceptanceACrmFixture(): Promise<AcceptanceACrmFixture> {
  const manifest = readManifest();
  const generated = generateFixtureCsv(manifest);
  const rows = partitionRows(await parseFixtureCsv(generated.csv, manifest), manifest);
  const workspaceMemberIds = new Set(generated.workspaceMemberIds);

  const accountsBatch = planFixtureBatch({
    objectType: "account",
    normalized: normalizeFixtureRows(rows.account, "account"),
    knownAccountExternalIds: new Set(),
    workspaceMemberIds,
    totalAccounts: 0,
    totalOpenPipelineUsd: 0,
  });
  const knownAccountExternalIds = new Set(accountsBatch.plan.entries.map((entry) => entry.externalId));
  const totalOpenPipelineUsd = accountsBatch.plan.entries.reduce(
    (sum, entry) =>
      sum + (typeof entry.values.openPipelineUsd === "number" ? entry.values.openPipelineUsd : 0),
    0,
  );
  invariant(totalOpenPipelineUsd === manifest.generated.totalOpenPipelineUsd, "generated_pipeline_total");

  const healthBatch = planFixtureBatch({
    objectType: "account_health",
    normalized: normalizeFixtureRows(rows.account_health, "account_health"),
    knownAccountExternalIds,
    workspaceMemberIds,
    totalAccounts: knownAccountExternalIds.size,
    totalOpenPipelineUsd,
  });
  const opportunitiesBatch = planFixtureBatch({
    objectType: "opportunity",
    normalized: normalizeFixtureRows(rows.opportunity, "opportunity"),
    knownAccountExternalIds,
    workspaceMemberIds,
    totalAccounts: knownAccountExternalIds.size,
    totalOpenPipelineUsd,
  });

  const store = materializeStore(accountsBatch, healthBatch, opportunitiesBatch);
  invariant(store.accounts.length === manifest.generated.accounts, "materialized_accounts");
  invariant(store.opportunities.length === manifest.generated.opportunities, "materialized_opportunities");
  invariant(
    new Set(store.accounts.map((account) => account.ownerId)).size === manifest.generated.owners,
    "materialized_owner_count",
  );
  invariant(
    store.accounts.some((account) => account.ownerId === ACCEPTANCE_A_DURABLE_OWNER_ID),
    "materialized_durable_owner",
  );
  return {
    store,
    manifest,
    workspaceMemberIds: generated.workspaceMemberIds,
    ingestion: [accountsBatch.evidence, healthBatch.evidence, opportunitiesBatch.evidence],
  };
}
