import type { Contact } from "@repo/shared-schemas";
import { inMemoryRepository, type RuntimeRepository } from "../runtime-repository";

/** Read contacts for a set of accounts. Read-only. */
export async function readContacts(
  accountIds: string[],
  repo: RuntimeRepository = inMemoryRepository,
): Promise<Contact[]> {
  const lists = await Promise.all(accountIds.map((id) => repo.listContactsByAccount(id)));
  return lists.flat();
}
