import { AccountSchema, type Account } from "@repo/shared-schemas";

/**
 * Field mapping — normalizes raw CRM payloads into the canonical schema.
 *
 * Real CRMs expose messy, vendor-specific field names. This layer is the only
 * place that knows about those names; everything downstream consumes the
 * validated canonical `Account`. Unknown/garbage input fails closed via Zod.
 */
export type RawCrmAccount = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Compute staleness (days since last contact) deterministically from a ref date. */
export function deriveDaysSinceLastContact(
  lastContactedAt: string | undefined,
  referenceIso: string,
): number | undefined {
  if (!lastContactedAt) return undefined;
  const last = Date.parse(lastContactedAt);
  const ref = Date.parse(referenceIso);
  if (Number.isNaN(last) || Number.isNaN(ref)) return undefined;
  return Math.max(0, Math.floor((ref - last) / 86_400_000));
}

export function mapRawAccount(raw: RawCrmAccount, referenceIso: string): Account {
  const lastContactedAt = str(raw["LastActivityDate"]) ?? str(raw["lastContactedAt"]);
  const candidate = {
    id: str(raw["Id"]) ?? str(raw["id"]) ?? "",
    name: str(raw["Name"]) ?? str(raw["name"]) ?? "",
    domain: str(raw["Website"]) ?? str(raw["domain"]),
    ownerId: str(raw["OwnerId"]) ?? str(raw["ownerId"]) ?? "",
    tier: str(raw["Tier__c"]) ?? str(raw["tier"]) ?? "smb",
    lifecycleStage: str(raw["Stage__c"]) ?? str(raw["lifecycleStage"]) ?? "prospect",
    industry: str(raw["Industry"]) ?? str(raw["industry"]),
    employeeCount: num(raw["NumberOfEmployees"]) ?? num(raw["employeeCount"]),
    annualRevenueUsd: num(raw["AnnualRevenue"]) ?? num(raw["annualRevenueUsd"]),
    openPipelineUsd: num(raw["OpenPipeline__c"]) ?? num(raw["openPipelineUsd"]) ?? 0,
    lastContactedAt,
    daysSinceLastContact: deriveDaysSinceLastContact(lastContactedAt, referenceIso),
    healthScore: num(raw["HealthScore__c"]) ?? num(raw["healthScore"]),
    intentSignals: Array.isArray(raw["intentSignals"])
      ? (raw["intentSignals"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    dataQualityFlags: [],
    createdAt: str(raw["CreatedDate"]) ?? str(raw["createdAt"]) ?? referenceIso,
    updatedAt: str(raw["LastModifiedDate"]) ?? str(raw["updatedAt"]) ?? referenceIso,
  };
  return AccountSchema.parse(candidate);
}
