import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSessionContext } from "../../lib/auth";
import { FEEDBACK_REASONS } from "../../lib/account-context";

/**
 * Rep feedback on a recommendation.
 *
 * The panel promises real consequences — holding the recommendation, opening a
 * data-quality review, suppressing the account — so the submission has to be
 * recorded before the UI confirms anything. This demo persists to a cookie and
 * logs an audit-shaped event; in production the same handler writes audit
 * evidence and enqueues the review item. Either way the confirmation only
 * appears after the write.
 */
export async function POST(request: NextRequest) {
  const ctx = await getSessionContext();
  const url = request.nextUrl.clone();
  url.search = "";

  if (!ctx) {
    url.pathname = "/login";
    return NextResponse.redirect(url, { status: 303 });
  }

  const form = await request.formData();
  const accountId = String(form.get("accountId") ?? "");
  const reason = String(form.get("reason") ?? "");

  const known = FEEDBACK_REASONS.some((r) => r.reason === reason);
  url.pathname = accountId ? `/accounts/${accountId}` : "/dashboard";

  if (!accountId || !known) {
    // Fail closed rather than confirming something that was not recorded.
    url.searchParams.set("feedback", "error");
    return NextResponse.redirect(url, { status: 303 });
  }

  (await cookies()).set(`fb_${accountId}`, reason, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });

  console.info(
    JSON.stringify({
      action: "record_recommendation_feedback",
      actor: ctx.userId,
      role: ctx.role,
      accountId,
      reason,
      at: new Date().toISOString(),
    }),
  );

  return NextResponse.redirect(url, { status: 303 });
}
