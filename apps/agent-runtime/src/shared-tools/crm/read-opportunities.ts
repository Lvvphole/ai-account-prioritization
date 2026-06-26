import type { Opportunity } from "@repo/shared-schemas";
import { inMemoryRepository, type RuntimeRepository } from "../runtime-repository";

/** Read opportunities for a set of accounts. Read-only. */
export async function readOpportunities(
  accountIds: string[],
  repo: RuntimeRepository = inMemoryRepository,
): Promise<Opportunity[]> {
  const lists = await Promise.all(
    accountIds.map((id) => repo.listOpportunitiesByAccount(id)),
  );
  return lists.flat();
}
