import { z } from "zod";

/** Whether a decision feature came from a source, a deterministic derivation, or is absent. */
export const FeatureStatusSchema = z.enum(["observed", "derived", "unavailable"]);
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

/**
 * Facts one CRM connection can supply. Connectors declare capabilities instead
 * of pretending that vendor-specific enrichment is universally available.
 */
export const CrmSourceCapabilitiesSchema = z
  .object({
    accounts: z.literal(true),
    contacts: z.boolean(),
    opportunities: z.boolean(),
    activities: z.boolean(),
    accountTier: z.boolean(),
    lifecycleStage: z.boolean(),
    emailEvents: z.boolean(),
    renewals: z.boolean(),
    healthScore: z.boolean(),
    intentSignals: z.boolean(),
  })
  .strict();
export type CrmSourceCapabilities = z.infer<typeof CrmSourceCapabilitiesSchema>;

/**
 * Durable evidence for the capability declaration that authorized one decision.
 * This extends the capability declaration so it can flow through existing
 * connector-aware policy while retaining its source and version provenance.
 */
export const CrmSourceCapabilitySnapshotSchema = CrmSourceCapabilitiesSchema.extend({
  source: z.string().min(1),
  mappingVersion: z.string().min(1),
  observedAt: z.string().datetime(),
}).strict();
export type CrmSourceCapabilitySnapshot = z.infer<typeof CrmSourceCapabilitySnapshotSchema>;
