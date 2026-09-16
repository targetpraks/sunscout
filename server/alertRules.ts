/**
 * Personal condition alert rules — "tell me before I go".
 *
 * A beachgoer picks a saved beach and a predicate (wind dropping below a
 * threshold, golden hour approaching within an offset, or a hazard clearing)
 * and SunScout watches that beach for them. This module is the matcher: it
 * runs on condition refresh, evaluates every enabled rule against the live
 * condition/hazard rows the existing engines already consume, and turns
 * matches into notifications.
 *
 * Boundary decisions (see AGENTS.md route-module notes):
 *  - The merged alert engine lives in server/push.ts (trunk, consumed, not
 *    edited). This module is a sibling evaluator, not a patch: it reuses the
 *    engine's exact delivery rails — the alert_dispatch dedupe ledger
 *    (idempotency boundary), the notification table, the push adapter and
 *    the alert_preference mute window — keyed by one new kind
 *    (personal-rule-alert) so per-kind toggles govern system and personal
 *    alerts independently.
 *  - The refresh route (POST /api/conditions/refresh in
 *    server/routes/conditions.ts) is the only trigger; it calls
 *    evaluateAlertRules right after refreshConditions, failure-isolated the
 *    same way the refresh script isolates evaluateAlerts. No new writer.
 *  - Integrity rule: rules only READ live condition data. They never alter
 *    the Day Score, the Beach Pulse ranking or the condition tables.
 *
 * Dedupe keys (stable across re-runs, distinct when the story changes):
 *  - wind_below:         rule:<id>:wind:<UTC day> — one low-wind story per
 *                        day, not one per condition row.
 *  - golden_hour_within: rule:<id>:golden:<golden hour start ISO> — a
 *                        reminder fires exactly once per occurrence.
 *  - hazard_clear:       rule:<id>:hazard:<hazard id> — once per clearance.
 */

import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { dispatchPush, isMuted, type PushAdapter } from "./push";

type Queryable = Pick<Pool | PoolClient, "query">;

// ---------------------------------------------------------------------------
// Wire contract (mirrored in src/alerts/types.ts — the server tree cannot
// import from src/, so the duplicates are deliberate and guarded by tests)
// ---------------------------------------------------------------------------

export const ALERT_RULE_KINDS = [
  "wind_below",
  "golden_hour_within",
  "hazard_clear",
] as const;
export type AlertRuleKind = (typeof ALERT_RULE_KINDS)[number];

export const ALERT_RULE_PRIORITIES = ["low", "normal", "high"] as const;
export type AlertRulePriority = (typeof ALERT_RULE_PRIORITIES)[number];

export const PRIORITY_ORDER: Record<AlertRulePriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
};

/** The notification/alert_dispatch kind all personal rule alerts share. */
export const PERSONAL_RULE_NOTIFICATION_KIND = "personal-rule-alert";

/** Heavy overcast makes the golden hour a non-event (mirrors push.ts). */
const GOLDEN_HOUR_MAX_CLOUD_PERCENT = 60;
/** A hazard counts as "cleared" for this long after it expires. */
const HAZARD_CLEAR_WINDOW_MINUTES = 60;
/**
 * A wind rule only fires on a reading this fresh — the same staleness
 * horizon the Beach Pulse uses for conditions. Without it, a rule would
 * fire for days on a single old low-wind row.
 */
const WIND_STALE_HOURS = 6;
const WIND_STALE_MS = WIND_STALE_HOURS * 3_600_000;

export const windConfigSchema = z.object({
  thresholdKmh: z.number().min(0).max(200),
});
export const goldenHourConfigSchema = z.object({
  offsetMinutes: z.number().int().min(5).max(240),
});
export const hazardClearConfigSchema = z.object({});

const prioritySchema = z.enum(ALERT_RULE_PRIORITIES);
const slugSchema = z.string().trim().min(1).max(100);

export const createAlertRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    slug: slugSchema,
    kind: z.literal("wind_below"),
    config: windConfigSchema,
    priority: prioritySchema.default("normal"),
  }),
  z.object({
    slug: slugSchema,
    kind: z.literal("golden_hour_within"),
    config: goldenHourConfigSchema,
    priority: prioritySchema.default("normal"),
  }),
  z.object({
    slug: slugSchema,
    kind: z.literal("hazard_clear"),
    config: hazardClearConfigSchema.default({}),
    priority: prioritySchema.default("normal"),
  }),
]);
export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;

export type AlertRuleWire = {
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

type AlertRuleRow = {
  id: number;
  slug: string;
  beach_name: string;
  kind: AlertRuleKind;
  config: Record<string, unknown>;
  priority: AlertRulePriority;
  enabled: boolean;
  last_matched_at: Date | null;
  created_at: Date;
};

export function serializeAlertRule(row: AlertRuleRow): AlertRuleWire {
  return {
    id: row.id,
    beachSlug: row.slug,
    beachName: row.beach_name,
    kind: row.kind,
    config: row.config ?? {},
    priority: row.priority,
    enabled: row.enabled,
    lastMatchedAt: row.last_matched_at
      ? new Date(row.last_matched_at).toISOString()
      : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Pure matching logic — no I/O, deterministic under an injected clock
// ---------------------------------------------------------------------------

export type RuleSnapshot = {
  windKmh: number | null;
  cloudPercent: number | null;
  goldenHourStart: Date | null;
  /** Id of the beach's most recently expired hazard, null when none. */
  clearedHazardId: number | null;
  /** Observed-at of the condition row behind windKmh (staleness guard). */
  conditionObservedAt: Date | null;
};

const minutes = (n: number) => n * 60_000;

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Does one rule match the live snapshot at `now`? Pure and total: corrupt
 * configs, missing condition fields and absent hazards all produce a safe
 * `false` — a rule never fires on data it cannot honestly verify.
 */
export function matchesRule(
  rule: { kind: AlertRuleKind; config: unknown },
  snapshot: RuleSnapshot,
  now: Date,
): boolean {
  if (rule.kind === "wind_below") {
    const config = windConfigSchema.safeParse(rule.config);
    if (!config.success) return false;
    if (snapshot.windKmh == null) return false;
    // Honesty guard: never fire on a stale reading — the wind must have
    // been observed within the pulse staleness horizon.
    if (
      snapshot.conditionObservedAt == null ||
      now.getTime() - snapshot.conditionObservedAt.getTime() > WIND_STALE_MS
    ) {
      return false;
    }
    return snapshot.windKmh < config.data.thresholdKmh;
  }

  if (rule.kind === "golden_hour_within") {
    const config = goldenHourConfigSchema.safeParse(rule.config);
    if (!config.success) return false;
    if (!snapshot.goldenHourStart) return false;
    const startMs = new Date(snapshot.goldenHourStart).getTime();
    const nowMs = now.getTime();
    const upcoming =
      startMs > nowMs && startMs <= nowMs + minutes(config.data.offsetMinutes);
    const skyClear =
      snapshot.cloudPercent == null ||
      snapshot.cloudPercent <= GOLDEN_HOUR_MAX_CLOUD_PERCENT;
    return upcoming && skyClear;
  }

  const config = hazardClearConfigSchema.safeParse(rule.config);
  if (!config.success) return false;
  return snapshot.clearedHazardId != null;
}

// ---------------------------------------------------------------------------
// Evaluation + delivery — mirrors push.ts dispatch semantics
// ---------------------------------------------------------------------------

type RuleCandidateRow = {
  rule_id: number;
  user_id: number;
  kind: AlertRuleKind;
  config: Record<string, unknown>;
  priority: AlertRulePriority;
  slug: string;
  beach_name: string;
  wind_speed_kmh: string | null;
  cloud_cover_percent: string | null;
  golden_hour_start: Date | null;
  observed_at: Date | null;
  hazard_id: number | null;
};

export type RuleEvaluationResult = {
  candidates: number;
  dispatched: number;
  duplicates: number;
  suppressed: number;
  errors: Array<{ source: string; error: string }>;
};

type DispatchOutcome = "dispatched" | "duplicates" | "suppressed";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "rule_evaluator_error";
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One candidate per matched rule: preference gate, mute window, dedupe
 * ledger, in-app notification, push fan-out and last_matched_at stamp. The
 * alert_dispatch insert is the idempotency boundary — a conflict means the
 * alert already went out and nothing is written or pushed (the same
 * contract as push.ts dispatchAlert).
 */
async function dispatchRuleAlert(
  db: Queryable,
  adapter: PushAdapter,
  candidate: {
    ruleId: number;
    userId: number;
    dedupeKey: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
  },
  now: Date,
  errors: RuleEvaluationResult["errors"],
): Promise<DispatchOutcome> {
  const preferences = await db.query<{
    timezone: string;
    enabled: boolean | null;
    mute_start_minute: number | null;
    mute_end_minute: number | null;
  }>(
    `select u.timezone, p.enabled, p.mute_start_minute, p.mute_end_minute
     from app_user u
     left join alert_preference p
       on p.user_id = u.id and p.kind = $2
     where u.id = $1`,
    [candidate.userId, PERSONAL_RULE_NOTIFICATION_KIND],
  );
  const preference = preferences.rows[0];
  if (!preference) return "suppressed"; // user gone; nowhere to deliver
  if (preference.enabled === false) return "suppressed";
  if (
    isMuted(
      {
        startMinute: preference.mute_start_minute,
        endMinute: preference.mute_end_minute,
      },
      now,
      preference.timezone || "UTC",
    )
  ) {
    return "suppressed";
  }

  const dedupe = await db.query(
    `insert into alert_dispatch(user_id, kind, dedupe_key, payload)
     values ($1, $2, $3, $4)
     on conflict (user_id, kind, dedupe_key) do nothing
     returning user_id`,
    [
      candidate.userId,
      PERSONAL_RULE_NOTIFICATION_KIND,
      candidate.dedupeKey,
      candidate.payload,
    ],
  );
  if (!dedupe.rowCount) return "duplicates";

  await db.query(
    `insert into notification(user_id, kind, title, body, payload)
     values ($1, $2, $3, $4, $5)`,
    [
      candidate.userId,
      PERSONAL_RULE_NOTIFICATION_KIND,
      candidate.title,
      candidate.body,
      { ...candidate.payload, dedupeKey: candidate.dedupeKey },
    ],
  );

  await db.query(
    `update alert_rule set last_matched_at = $1, updated_at = $1
     where id = $2`,
    [now, candidate.ruleId],
  );

  const subscriptions = await db.query<{
    endpoint: string;
    p256dh_key: string | null;
    auth_secret: string | null;
  }>(
    `select endpoint, p256dh_key, auth_secret from push_subscription
     where user_id = $1`,
    [candidate.userId],
  );
  const payload = {
    kind: PERSONAL_RULE_NOTIFICATION_KIND,
    title: candidate.title,
    body: candidate.body,
    ...candidate.payload,
  };
  for (const subscription of subscriptions.rows) {
    try {
      await adapter({
        endpoint: subscription.endpoint,
        p256dhKey: subscription.p256dh_key,
        authSecret: subscription.auth_secret,
        payload,
      });
    } catch (error) {
      errors.push({
        source: `push:${PERSONAL_RULE_NOTIFICATION_KIND}`,
        error: errorMessage(error),
      });
    }
  }
  return "dispatched";
}

/**
 * Evaluate every enabled personal rule against live conditions and deliver
 * the matches. Same failure-isolation contract as evaluateAlerts: one rule
 * or user failing never aborts the rest, and errors land in the result.
 */
export async function evaluateAlertRules(
  db: Queryable,
  options: { now?: Date; adapter?: PushAdapter } = {},
): Promise<RuleEvaluationResult> {
  const now = options.now ?? new Date();
  const adapter = options.adapter ?? dispatchPush;
  const result: RuleEvaluationResult = {
    candidates: 0,
    dispatched: 0,
    duplicates: 0,
    suppressed: 0,
    errors: [],
  };
  const hazardWindowStart = new Date(
    now.getTime() - minutes(HAZARD_CLEAR_WINDOW_MINUTES),
  );

  let rows: RuleCandidateRow[];
  try {
    const query = await db.query<RuleCandidateRow>(
      `select r.id as rule_id, r.user_id, r.kind, r.config,
         r.priority, b.slug, b.name as beach_name,
         c.wind_speed_kmh, c.cloud_cover_percent, c.golden_hour_start,
         c.observed_at, h.hazard_id
       from alert_rule r
       join beach b on b.id = r.beach_id
       left join lateral (
         select id, wind_speed_kmh, cloud_cover_percent, golden_hour_start,
           observed_at
         from beach_condition
         where beach_id = r.beach_id
         order by observed_at desc, id desc
         limit 1
       ) c on true
       left join lateral (
         select id as hazard_id
         from hazard_alert
         where beach_id = r.beach_id
           and expires_at is not null
           and expires_at <= $1
           and expires_at > $2
           -- Only hazards that cleared AFTER the rule was created: the
           -- predicate is a transition ("a hazard that was active has now
           -- cleared"), never a replay of old clearances.
           and expires_at >= r.created_at
         order by expires_at desc
         limit 1
       ) h on true
       where r.enabled
       order by r.id asc`,
      [now, hazardWindowStart],
    );
    rows = query.rows;
  } catch (error) {
    result.errors.push({ source: "rules", error: errorMessage(error) });
    return result;
  }

  for (const row of rows) {
    try {
      const snapshot: RuleSnapshot = {
        windKmh: toNumberOrNull(row.wind_speed_kmh),
        cloudPercent: toNumberOrNull(row.cloud_cover_percent),
        goldenHourStart: row.golden_hour_start
          ? new Date(row.golden_hour_start)
          : null,
        clearedHazardId: row.hazard_id,
        conditionObservedAt: row.observed_at ? new Date(row.observed_at) : null,
      };
      if (!matchesRule({ kind: row.kind, config: row.config }, snapshot, now)) {
        continue;
      }

      result.candidates += 1;
      let dedupeKey: string;
      let title: string;
      let body: string;
      const payload: Record<string, unknown> = {
        ruleId: row.rule_id,
        ruleKind: row.kind,
        beachSlug: row.slug,
        priority: row.priority,
      };

      if (row.kind === "wind_below") {
        const threshold = Number(row.config?.thresholdKmh);
        dedupeKey = `rule:${row.rule_id}:wind:${dayStamp(now)}`;
        title = `Wind dropped at ${row.beach_name}`;
        body = `Wind is ${snapshot.windKmh?.toFixed(1)} km/h — below your ${threshold} km/h rule. Good window to head out.`;
        payload.windKmh = snapshot.windKmh;
        payload.thresholdKmh = threshold;
      } else if (row.kind === "golden_hour_within") {
        const goldenStart = snapshot.goldenHourStart as Date;
        const startsIn = Math.max(
          1,
          Math.round((goldenStart.getTime() - now.getTime()) / 60_000),
        );
        // Day-keyed (UTC day of the golden hour itself): a reminder fires
        // at most once per golden-hour day, even if the provider recomputes
        // and shifts the start timestamp between refresh runs.
        dedupeKey = `rule:${row.rule_id}:golden:${dayStamp(goldenStart)}`;
        title = `Golden hour near at ${row.beach_name}`;
        body = `Golden hour starts in about ${startsIn} minutes at ${row.beach_name}.`;
        payload.goldenHourStart = goldenStart.toISOString();
        payload.startsInMinutes = startsIn;
      } else {
        dedupeKey = `rule:${row.rule_id}:hazard:${row.hazard_id}`;
        title = `Hazard cleared at ${row.beach_name}`;
        body = `The hazard at ${row.beach_name} has cleared — the beach is open again.`;
        payload.hazardId = row.hazard_id;
      }

      const outcome = await dispatchRuleAlert(
        db,
        adapter,
        {
          ruleId: row.rule_id,
          userId: row.user_id,
          dedupeKey,
          title,
          body,
          payload,
        },
        now,
        result.errors,
      );
      result[outcome] += 1;
    } catch (error) {
      result.errors.push({
        source: `rule:${row.rule_id}`,
        error: errorMessage(error),
      });
    }
  }
  return result;
}
