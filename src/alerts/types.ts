/**
 * Personal alert rules wire contract — client mirror of server/alertRules.ts.
 *
 * KEEP IN SYNC with server/alertRules.ts — the server tree cannot import
 * from src/ (server/tsconfig.json pins rootDir to server/), so these types
 * and constants are deliberate duplicates. src/alerts/alertRules.test.ts
 * pins the literals as a drift guard, the same pattern as
 * src/dayOutlook/types.ts <-> server/dayQuality.ts.
 */

export const ALERT_RULE_KINDS = [
  "wind_below",
  "golden_hour_within",
  "hazard_clear",
] as const;
export type AlertRuleKind = (typeof ALERT_RULE_KINDS)[number];

export const ALERT_RULE_PRIORITIES = ["low", "normal", "high"] as const;
export type AlertRulePriority = (typeof ALERT_RULE_PRIORITIES)[number];

/** Higher = more urgent; the banner floor uses this ordering. */
export const PRIORITY_ORDER: Record<AlertRulePriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
};

/** Notification/alert_dispatch kind shared by every personal rule alert. */
export const PERSONAL_RULE_NOTIFICATION_KIND = "personal-rule-alert";

export type AlertRule = {
  id: number;
  beachSlug: string;
  beachName: string;
  kind: AlertRuleKind;
  config: Record<string, unknown>;
  priority: AlertRulePriority;
  enabled: boolean;
  lastMatchedAt: string | null;
  createdAt: string;
};

/** A saved beach the user can point a rule at (from the rules GET payload). */
export type SavedBeach = {
  slug: string;
  name: string;
};

export type AlertRulesPayload = {
  rules: AlertRule[];
  savedBeaches: SavedBeach[];
};

export type CreateAlertRuleInput =
  | {
      slug: string;
      kind: "wind_below";
      config: { thresholdKmh: number };
      priority?: AlertRulePriority;
    }
  | {
      slug: string;
      kind: "golden_hour_within";
      config: { offsetMinutes: number };
      priority?: AlertRulePriority;
    }
  | {
      slug: string;
      kind: "hazard_clear";
      config: Record<string, never>;
      priority?: AlertRulePriority;
    };

/** A personal-rule notification projected for the banner. */
export type PersonalAlert = {
  id: string;
  title: string;
  body: string | null;
  priority: AlertRulePriority;
  beachSlug: string | null;
  createdAt: string;
};

/**
 * Coerce an untrusted payload priority into the wire vocabulary — an
 * unknown or missing value renders as "normal", never crashes the banner.
 */
export function alertPriority(value: unknown): AlertRulePriority {
  return (ALERT_RULE_PRIORITIES as readonly unknown[]).includes(value)
    ? (value as AlertRulePriority)
    : "normal";
}

/**
 * Banner filter: only alerts at or above the configured minimum priority
 * are shown. Pure so tests pin the floor semantics directly.
 */
export function filterAlerts(
  alerts: PersonalAlert[],
  minPriority: AlertRulePriority = "normal",
): PersonalAlert[] {
  const floor = PRIORITY_ORDER[minPriority];
  return alerts.filter((alert) => PRIORITY_ORDER[alert.priority] >= floor);
}

/** Human label for a rule row in the editor. */
export function describeRule(rule: AlertRule): string {
  if (rule.kind === "wind_below") {
    return `Wind below ${Number(rule.config?.thresholdKmh ?? 0)} km/h`;
  }
  if (rule.kind === "golden_hour_within") {
    return `Golden hour within ${Number(rule.config?.offsetMinutes ?? 0)} min`;
  }
  return "Hazard clears";
}
