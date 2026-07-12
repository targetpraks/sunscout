/**
 * Error-tracking adapter boundary. When SENTRY_DSN is set, exceptions are sent
 * to Sentry's envelope endpoint. Otherwise errors are only logged, so the app
 * degrades honestly without an external account (PRD principle 6). Swap for
 * the official `@sentry/node` SDK once a Sentry project is provisioned.
 */
const sentryDsn = process.env.SENTRY_DSN;
const release = process.env.SUNSCOUT_RELEASE ?? "dev";

let cached: { dsn: URL; key: string; projectId: string } | null | undefined;
function config() {
  if (cached !== undefined) return cached;
  if (!sentryDsn) {
    cached = null;
    return null;
  }
  try {
    const dsn = new URL(sentryDsn);
    const key = dsn.username;
    const projectId = dsn.pathname.replace("/", "");
    cached = { dsn, key, projectId };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function errorTrackingConfigured(): boolean {
  return Boolean(config());
}

type Captureable = {
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
};

export async function captureException(
  error: unknown,
  extra?: Record<string, unknown>,
): Promise<void> {
  const cfg = config();
  const payload: Captureable = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    extra,
  };
  if (!cfg) {
    console.error("[sunscout] untracked error:", payload.message, extra ?? "");
    return;
  }
  try {
    const envelope =
      JSON.stringify({
        event_id: Math.random().toString(16).slice(2),
        sent_at: new Date().toISOString(),
      }) +
      "\n" +
      JSON.stringify({
        type: "event",
        level: "error",
        message: payload.message,
        stacktrace: payload.stack
          ? { frames: [{ filename: "server", function: "captureException" }] }
          : undefined,
        release,
        extra: payload.extra,
      });
    const url = new URL(
      `https://${cfg.dsn.host}/api/${cfg.projectId}/envelope/`,
    );
    url.searchParams.set("sentry_key", cfg.key);
    url.searchParams.set("sentry_version", "7");
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: envelope,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    /* never let error tracking itself throw */
  }
}
