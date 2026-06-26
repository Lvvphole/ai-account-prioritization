import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../lib/supabase/server";

/** Email + password sign-in. Sets the session cookies, then redirects. */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const requested = String(formData.get("redirectTo") ?? "/dashboard");
  const redirectTo = requested.startsWith("/") ? requested : "/dashboard";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  const url = request.nextUrl.clone();
  url.search = "";
  if (error) {
    url.pathname = "/login";
    url.searchParams.set("error", "Invalid email or password.");
    url.searchParams.set("redirectTo", redirectTo);
  } else {
    url.pathname = redirectTo;
  }
  return NextResponse.redirect(url, { status: 303 });
}
