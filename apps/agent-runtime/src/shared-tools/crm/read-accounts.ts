import type { Account } from "@repo/shared-schemas";
import { inMemoryRepository, type RuntimeRepository } from "../runtime-repository";

/** Read accounts owned by a rep. Read-only; no side effects, no approval needed. */
export async function readAccounts(
  ownerId: string,
  repo: RuntimeRepository = inMemoryRepository,
): Promise<Account[]> {
  return repo.listAccountsByOwner(ownerId);
}
