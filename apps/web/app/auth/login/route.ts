import { NextResponse, type NextRequest } from "next/server";
import { getAppRole } from "@repo/supabase-client";
import { createClient } from "../../lib/supabase/server";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { roleHome } from "../../lib/auth";
import { destinationToParam, safeInternalDestination } from "../../lib/redirect";

/** Email + password sign-in. Sets the session cookies, then redirects. */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    // Demo mode has no password to check and this route sets no role cookie, so
    // sending the visitor to /dashboard would only bounce them back. Return them
    // to the role picker, which is the only way to establish a demo session.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url, { status: 303 });
  }

  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const destination = safeInternalDestination(
    String(formData.get("redirectTo") ?? ""),
    request.nextUrl.origin,
  );
  // The form defaults this field to /dashboard, so a bare /dashboard carries no
  // intent of its own and defers to the role's home below.
  const requested =
    destination && destinationToParam(destination) !== "/dashboard" ? destination : null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  const url = request.nextUrl.clone();
  url.search = "";
  if (error || !data.user) {
    url.pathname = "/login";
    url.searchParams.set("error", "Invalid email or password.");
    url.searchParams.set(
      "redirectTo",
      destination ? destinationToParam(destination) : "/dashboard",
    );
  } else {
    // Honor an explicit destination (e.g. a protected page) else go to the
    // role's home so Reps and Managers land on the right view. Pathname and
    // search are assigned apart to keep any query string on the destination.
    const role = (await getAppRole(supabase, data.user.id)) ?? "rep";
    url.pathname = requested?.pathname ?? roleHome(role);
    url.search = requested?.search ?? "";
  }
  return NextResponse.redirect(url, { status: 303 });
}
