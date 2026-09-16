/**
 * Client API for personal condition alert rules. Mirrors the apiRequest
 * pattern in src/api.ts (same user header, same error envelope) because
 * that helper is module-private — this file owns its own copy rather than
 * editing the shared module, which this workstream does not own.
 */

import { fetchNotifications } from "../api";
import {
  PERSONAL_RULE_NOTIFICATION_KIND,
  alertPriority,
  type AlertRule,
  type AlertRulesPayload,
  type CreateAlertRuleInput,
  type PersonalAlert,
} from "./types";

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-sunscout-user-id": "00000000-0000-7000-8000-000000000001",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `api_${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/** The user's rules plus the saved beaches a rule can point at. */
export async function fetchAlertRules(): Promise<AlertRulesPayload> {
  const result = await apiRequest<AlertRulesPayload>("/conditions/alert-rules");
  return {
    rules: result.rules ?? [],
    savedBeaches: result.savedBeaches ?? [],
  };
}

/** Create a rule; throws Error("rule_exists") on a duplicate predicate. */
export async function createAlertRule(
  input: CreateAlertRuleInput,
): Promise<AlertRule> {
  const result = await apiRequest<{ data: AlertRule }>(
    "/conditions/alert-rules",
    {
      method: "POST",
      body: JSON.stringify({
        slug: input.slug,
        kind: input.kind,
        config: input.config,
        priority: input.priority ?? "normal",
      }),
    },
  );
  return result.data;
}

export async function deleteAlertRule(ruleId: number): Promise<void> {
  await apiRequest(`/conditions/alert-rules/${ruleId}`, {
    method: "DELETE",
  });
}

/**
 * The user's personal-rule notifications, projected for the banner.
 * Reuses the existing /api/me/notifications feed (src/api.ts) and filters
 * to the personal-rule kind — the banner never shows system alert kinds.
 */
export async function fetchPersonalAlerts(): Promise<PersonalAlert[]> {
  const notifications = await fetchNotifications();
  return notifications
    .filter(
      (notification) => notification.kind === PERSONAL_RULE_NOTIFICATION_KIND,
    )
    .map((notification) => ({
      id: notification.public_id,
      title: notification.title,
      body: notification.body,
      priority: alertPriority(notification.payload?.priority),
      beachSlug:
        typeof notification.payload?.beachSlug === "string"
          ? notification.payload.beachSlug
          : null,
      createdAt: notification.created_at,
    }));
}
