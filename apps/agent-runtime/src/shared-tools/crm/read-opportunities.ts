import type { Opportunity } from "@repo/shared-schemas";
import { repository } from "../database/repository";

/** Read opportunities for a set of accounts. Read-only. */
export async function readOpportunities(accountIds: string[]): Promise<Opportunity[]> {
  return accountIds.flatMap((id) => repository.listOpportunitiesByAccount(id));
}
