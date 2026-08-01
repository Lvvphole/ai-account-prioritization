import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./app/lib/supabase/middleware";
import { isSupabaseConfigured } from "./app/lib/supabase/config";

/** Public paths reachable without a session. */
const PUBLIC_PREFIXES = ["/login", "/auth"];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function redirectToLogin(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  // Carry the query string too: on pages that keep their state in the URL (the
  // import wizard's ?kind=, for one) dropping it silently resumes somewhere
  // other than where the visitor was headed. setSearchParams encodes it.
  url.searchParams.set("redirectTo", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // No Supabase configured -> demo mode. Don't run the Supabase session check
  // (it would throw, surfacing as a site-wide MIDDLEWARE_INVOCATION_FAILED);
  // gate on the demo role cookie instead so the role picker is a real door
  // rather than decoration.
  if (!isSupabaseConfigured()) {
    const picked = request.cookies.get("demo_role")?.value;
    if (!picked && !isPublic(pathname)) return redirectToLogin(request);
    return NextResponse.next();
  }

  const { response, user } = await updateSession(request);

  if (!user && !isPublic(pathname)) return redirectToLogin(request);

  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
