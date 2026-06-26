/**
 * Deterministic PII redaction.
 *
 * Used to scrub free-form/observability payloads (e.g. analytics event
 * properties) before they leave the trusted boundary, so secrets and personal
 * data never land in telemetry (Rule #30; AnalyticsEvent properties "must not
 * contain secrets/PII"). Pure, synchronous, dependency free.
 *
 * Conservative by design: it targets high-precision patterns (email, phone,
 * SSN) to avoid corrupting legitimate non-PII values like scores or reason codes.
 */
const REDACTIONS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: "[redacted:email]" },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[redacted:ssn]" },
  {
    // North-American / international phone numbers with >= 10 digits.
    pattern: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g,
    replacement: "[redacted:phone]",
  },
];

/** Redact PII patterns from a string. Returns the input unchanged if clean. */
export function redactPII(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Recursively redact every string within a value; non-strings pass through. */
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactPII(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    return redactProperties(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Redact every string value AND key in a property bag. Keys are redacted too
 * because a caller may use a contact identifier (email/phone) as a dynamic
 * property name; a sanitized value behind a PII key would still leak telemetry.
 */
export function redactProperties(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    out[redactPII(key)] = redactValue(value);
  }
  return out;
}
