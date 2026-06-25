import type { Activity } from "@repo/shared-schemas";
import { repository } from "../database/repository";

/** Read activities for a set of accounts. Read-only. */
export async function readActivities(accountIds: string[]): Promise<Activity[]> {
  return accountIds.flatMap((id) => repository.listActivitiesByAccount(id));
}
