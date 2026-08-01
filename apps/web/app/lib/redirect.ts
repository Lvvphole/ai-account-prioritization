/** A post-login destination that has been proven to stay inside this app. */
export interface InternalDestination {
  pathname: string;
  search: string;
}

/**
 * Resolve a caller-supplied return destination against the app's own origin.
 * Returns null when the value is absent or points off-site.
 *
 * Parsing rather than string-matching is what keeps the query string intact:
 * assigning "/a?b=c" straight to `URL.pathname` percent-encodes the "?" into
 * "%3F", so the destination has to be split into pathname and search first.
 *
 * Parsing also moves where the off-site check has to happen. `new URL()`
 * resolves a protocol-relative value against the base, so "//evil.example.com"
 * becomes "https://evil.example.com" — a prefix check on the raw string is not
 * enough once the value is parsed. The resolved origin is the thing to compare.
 */
export function safeInternalDestination(
  value: string | null | undefined,
  origin: string,
): InternalDestination | null {
  // Must be an absolute path. Rejects "", relative values, and full URLs.
  if (!value || !value.startsWith("/")) return null;

  let resolved: URL;
  try {
    resolved = new URL(value, origin);
  } catch {
    return null;
  }

  // Catches "//host" and "/\host", which parse away to another origin.
  if (resolved.origin !== origin) return null;

  return { pathname: resolved.pathname, search: resolved.search };
}

/** Render a destination back into the `redirectTo` round-trip form. */
export function destinationToParam(destination: InternalDestination): string {
  return `${destination.pathname}${destination.search}`;
}
