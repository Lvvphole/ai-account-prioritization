import { z } from "zod";
import { NextBestActionType } from "./recommendation";

export const GENERATED_DRAFT_SCHEMA_VERSION = "1.0" as const;

export const GeneratedDraftSentenceSchema = z.object({
  text: z.string().min(1).max(500),
  sourceSignalIds: z.array(z.string().min(1)).min(1).max(4),
}).strict();

export const GeneratedDraftSchema = z.object({
  schemaVersion: z.literal(GENERATED_DRAFT_SCHEMA_VERSION),
  actionType: NextBestActionType,
  sentences: z.array(GeneratedDraftSentenceSchema).min(1).max(8),
}).strict();

export type GeneratedDraftSentence = z.infer<typeof GeneratedDraftSentenceSchema>;
export type GeneratedDraft = z.infer<typeof GeneratedDraftSchema>;
