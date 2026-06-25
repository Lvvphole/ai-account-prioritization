import type { Contact } from "@repo/shared-schemas";
import { repository } from "../database/repository";

/** Read contacts for a set of accounts. Read-only. */
export async function readContacts(accountIds: string[]): Promise<Contact[]> {
  const set = new Set(accountIds);
  return accountIds.flatMap((id) => repository.listContactsByAccount(id)).filter((c) =>
    set.has(c.accountId),
  );
}
