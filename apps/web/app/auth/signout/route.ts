import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "../../lib/supabase/server";
import { isSupabaseConfigured } from "../../lib/supabase/config";

/** Sign out and return to the login page. */
export async function POST(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.search = "";
  url.pathname = "/login";

  if (!isSupabaseConfigured()) {
    // Demo mode: the "session" is the role cookie, so clearing it is the sign
    // out. Previously this returned to /dashboard without clearing anything,
    // which left no way back to the role picker.
    (await cookies()).delete("demo_role");
    return NextResponse.redirect(url, { status: 303 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(url, { status: 303 });
}
