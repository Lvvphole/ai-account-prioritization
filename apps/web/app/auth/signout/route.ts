import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../lib/supabase/server";

/** Sign out and return to the login page. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url, { status: 303 });
}
