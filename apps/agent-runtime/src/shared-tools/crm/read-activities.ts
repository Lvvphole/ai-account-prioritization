import type { Activity } from "@repo/shared-schemas";
import { inMemoryRepository, type RuntimeRepository } from "../runtime-repository";

/** Read activities for a set of accounts. Read-only. */
export async function readActivities(
  accountIds: string[],
  repo: RuntimeRepository = inMemoryRepository,
): Promise<Activity[]> {
  const lists = await Promise.all(
    accountIds.map((id) => repo.listActivitiesByAccount(id)),
  );
  return lists.flat();
}
