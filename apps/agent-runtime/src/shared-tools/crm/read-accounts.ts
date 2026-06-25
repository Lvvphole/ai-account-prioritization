import type { Account } from "@repo/shared-schemas";
import { repository } from "../database/repository";

/** Read accounts owned by a rep. Read-only; no side effects, no approval needed. */
export async function readAccounts(ownerId: string): Promise<Account[]> {
  return repository.listAccountsByOwner(ownerId);
}
