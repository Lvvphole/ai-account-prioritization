import type { Account, Contact } from "@repo/shared-schemas";

/**
 * generate-email-draft — deterministic, customer-facing email draft.
 *
 * Customer-facing => this draft is approval-gated before any send. The template
 * deliberately avoids prior-conversation references, discounts, approvals,
 * guarantees, and availability claims so it can never assert unsupported facts.
 */
export function generateEmailDraft(input: {
  account: Account;
  primaryContact?: Contact;
  repId: string;
}): string {
  const greeting = input.primaryContact
    ? `Hi ${input.primaryContact.firstName},`
    : "Hello,";
  return [
    `Subject: Reaching out from your account team — ${input.account.name}`,
    "",
    greeting,
    "",
    `I lead the account relationship for ${input.account.name} and wanted to reach out to make sure you have what you need from us right now.`,
    "",
    "Would you be open to a brief conversation to talk through your current priorities?",
    "",
    "Best regards,",
    input.repId,
  ].join("\n");
}
