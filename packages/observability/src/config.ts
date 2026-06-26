/**
 * Which observability backends are configured. Pure: the caller passes the env
 * record (e.g. `process.env`), so this package needs no Node typings and stays
 * trivially testable.
 */
export interface ObservabilityConfig {
  sentryEnabled: boolean;
  langfuseEnabled: boolean;
}

export function observabilityConfigFromEnv(
  env: Record<string, string | undefined>,
): ObservabilityConfig {
  return {
    sentryEnabled: Boolean(env.SENTRY_DSN),
    langfuseEnabled: Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
  };
}
