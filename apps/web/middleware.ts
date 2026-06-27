import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./app/lib/supabase/middleware";
import { isSupabaseConfigured } from "./app/lib/supabase/config";

/** Public paths reachable without a session. */
const PUBLIC_PREFIXES = ["/login", "/auth"];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  // No Supabase configured -> no-auth demo mode: skip the session check rather
  // than throw (which would surface as a site-wide MIDDLEWARE_INVOCATION_FAILED).
  if (!isSupabaseConfigured()) return NextResponse.next();

  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
