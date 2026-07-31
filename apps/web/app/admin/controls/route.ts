import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { can } from "@repo/security";
import { getSessionContext } from "../../lib/auth";

/**
 * Emergency operational controls.
 *
 * These are the switches an operator reaches for during an incident, so they
 * have to actually do something and the change has to be visible immediately.
 * The pause state is held in a cookie here because the demo has no control-plane
 * service; in production the same handler calls the runtime's pause endpoint.
 * Either way the flow is identical: authorise, mutate, record, reflect.
 *
 * Recommendation generation and customer-facing sends pause independently, so
 * outbound activity can be stopped without stopping analysis.
 */
const ACTIONS = {
  pause_recommendations: "ops_pause_recs",
  pause_sends: "ops_pause_sends",
} as const;

type Action = keyof typeof ACTIONS;

export async function POST(request: NextRequest) {
  // Fail closed: only a role holding edit_scoring_config may operate these.
  const ctx = await getSessionContext();
  if (!ctx || !can(ctx.role, "edit_scoring_config")) {
    const denied = request.nextUrl.clone();
    denied.pathname = "/dashboard";
    denied.search = "?denied=1";
    return NextResponse.redirect(denied, { status: 303 });
  }

  const form = await request.formData();
  const action = String(form.get("action") ?? "") as Action;
  const back = String(form.get("returnTo") ?? "/admin");

  const url = request.nextUrl.clone();
  url.search = "";
  url.pathname = back.startsWith("/admin") ? back : "/admin";

  const cookieName = ACTIONS[action];
  if (!cookieName) return NextResponse.redirect(url, { status: 303 });

  const jar = await cookies();
  const paused = jar.get(cookieName)?.value === "1";

  if (paused) {
    jar.delete(cookieName);
  } else {
    jar.set(cookieName, "1", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 12 });
  }

  // Every operational change is an audit event. In production this is the
  // immutable audit_evidence insert; here it is the same shape, logged.
  console.info(
    JSON.stringify({
      action: paused ? `resume_${action}` : action,
      actor: ctx.userId,
      role: ctx.role,
      at: new Date().toISOString(),
      reason: "operator_console",
    }),
  );

  return NextResponse.redirect(url, { status: 303 });
}
