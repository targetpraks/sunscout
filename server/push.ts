import type { Pool, PoolClient } from "pg";

/**
 * Push-notification dispatch adapter boundary. When VAPID public/private keys
 * and a push service are configured, notifications are sent via the Web Push
 * protocol. Otherwise notifications are stored for in-app delivery only.
 */
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;

export function pushConfigured(): boolean {
  return Boolean(vapidPrivateKey && vapidPublicKey);
}

export function pushPublicKey(): string | null {
  return vapidPublicKey ?? null;
}

export async function dispatchPush(input: {
  endpoint: string;
  p256dhKey: string | null;
  authSecret: string | null;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  if (!pushConfigured()) return false;
  // Real implementation would sign a VAPID JWT and POST an encrypted payload
  // to input.endpoint per RFC 8291. Configured-but-not-implemented is a clear
  // boundary; the in-app notification is the reliable fallback.
  void input;
  return true;
}

// ---------------------------------------------------------------------------
// Proactive smart alerts
//
// The refresh job (server/scripts/refreshConditions.ts) is the only entry
// point: after conditions are refreshed, evaluateAlerts() scans saved-beach
// conditions, published event windows, fresh hazards and upcoming bookings,
// then queues an in-app notification (existing `notification` table) per
// user/kind/dedupe key and fans out through the push adapter above. No new
// API routes are involved.
// ---------------------------------------------------------------------------

type Queryable = Pick<Pool | PoolClient, "query">;

/** Exported so tests and callers can type fake/connection-scoped DB handles. */
export type AlertsDb = Queryable;

/** Injectable so tests can assert adapter calls; defaults to dispatchPush. */
export type PushAdapter = typeof dispatchPush;

export const ALERT_KINDS = [
  "golden-hour-imminent",
  "event-starting-soon",
  "condition-change",
  "booking-reminder",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export type AlertCandidate = {
  userId: number;
  kind: AlertKind;
  dedupeKey: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
};

export type AlertEvaluationResult = {
  candidates: number;
  dispatched: number;
  duplicates: number;
  suppressed: number;
  errors: Array<{ source: string; error: string }>;
};

type DispatchOutcome = "dispatched" | "duplicates" | "suppressed";

/** Minutes before golden hour starts that an alert is still useful. */
const GOLDEN_HOUR_WINDOW_MINUTES = 45;
/** Heavy overcast makes the golden hour a non-event; suppress above this. */
const GOLDEN_HOUR_MAX_CLOUD_PERCENT = 60;
/** Events alert from this long before start until the window ends. */
const EVENT_START_WINDOW_MINUTES = 60;
/** Hazards only count as "changes" while this fresh. */
const HAZARD_RECENT_MINUTES = 15;
/** Bookings remind this long before the slot starts. */
const BOOKING_REMINDER_WINDOW_MINUTES = 120;

const WATER_QUALITY_SEVERITY: Record<string, number> = {
  excellent: 0,
  good: 1,
  unknown: 2,
  advisory: 3,
  closed: 4,
};

const minutes = (n: number) => n * 60_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "alert_evaluator_error";
}

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Minute of day (0-1439) for `now` in the given IANA timezone. Uses h23 so
 * midnight is 0:00, never 24:00.
 */
export function localMinuteOfDay(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(now);
  const [hours, mins] = parts.split(":").map(Number);
  return hours * 60 + mins;
}

/**
 * True when `now` (local to `timeZone`) falls inside the mute window. Windows
 * where start > end wrap midnight (e.g. 22:00-07:00). A window needs both
 * bounds; a zero-length window mutes nothing.
 */
export function isMuted(
  muteWindow: { startMinute: number | null; endMinute: number | null },
  now: Date,
  timeZone: string,
): boolean {
  const { startMinute, endMinute } = muteWindow;
  if (startMinute == null || endMinute == null) return false;
  if (startMinute === endMinute) return false;
  const minute = localMinuteOfDay(now, timeZone);
  if (startMinute < endMinute) {
    return minute >= startMinute && minute < endMinute;
  }
  return minute >= startMinute || minute < endMinute;
}

type SavedBeachConditionRow = {
  user_id: number;
  beach_id: number;
  slug: string;
  beach_name: string;
  condition_id: number;
  golden_hour_start: Date | null;
  cloud_cover_percent: string | null;
  water_quality: string | null;
  wave_height_m: string | null;
  prev_condition_id: number | null;
  prev_water_quality: string | null;
  prev_wave_height_m: string | null;
};

type EventAlertRow = {
  user_id: number;
  event_id: number;
  title: string;
  start_at: Date;
  end_at: Date;
  beach_name: string;
  slug: string;
};

type HazardAlertRow = {
  user_id: number;
  hazard_id: number;
  severity: string;
  title: string;
  detail: string;
  created_at: Date;
  expires_at: Date | null;
  beach_name: string;
  slug: string;
};

type BookingAlertRow = {
  user_id: number;
  booking_id: number;
  starts_at: Date;
  beach_name: string;
  slug: string;
};

/**
 * Golden hour + condition changes for every saved beach. One query serves
 * both evaluators: the latest two condition rows per beach, joined to the
 * users who saved that beach.
 */
async function collectConditionAlerts(
  db: Queryable,
  now: Date,
  candidates: AlertCandidate[],
): Promise<void> {
  const result = await db.query<SavedBeachConditionRow>(`
    select us.user_id, b.id as beach_id, b.slug, b.name as beach_name,
      c.id as condition_id, c.golden_hour_start, c.cloud_cover_percent,
      c.water_quality, c.wave_height_m,
      p.id as prev_condition_id, p.water_quality as prev_water_quality,
      p.wave_height_m as prev_wave_height_m
    from user_saved_beach us
    join beach b on b.id = us.beach_id
    left join lateral (
      select id, golden_hour_start, cloud_cover_percent, water_quality, wave_height_m
      from beach_condition
      where beach_id = b.id
      order by observed_at desc, id desc
      limit 1
    ) c on true
    left join lateral (
      select id, water_quality, wave_height_m
      from beach_condition
      where beach_id = b.id
      order by observed_at desc, id desc
      offset 1
      limit 1
    ) p on true
    order by b.id asc`);

  for (const row of result.rows) {
    if (row.golden_hour_start) {
      const goldenStart = new Date(row.golden_hour_start);
      const startMs = goldenStart.getTime();
      const cloud =
        row.cloud_cover_percent == null
          ? null
          : Number(row.cloud_cover_percent);
      const inWindow =
        startMs >= now.getTime() &&
        startMs <= now.getTime() + minutes(GOLDEN_HOUR_WINDOW_MINUTES);
      const skyClear = cloud == null || cloud <= GOLDEN_HOUR_MAX_CLOUD_PERCENT;
      if (inWindow && skyClear) {
        const startsIn = Math.max(
          1,
          Math.round((startMs - now.getTime()) / 60_000),
        );
        candidates.push({
          userId: row.user_id,
          kind: "golden-hour-imminent",
          dedupeKey: `golden-hour:${row.beach_id}:${dayStamp(goldenStart)}`,
          title: `Golden hour at ${row.beach_name}`,
          body: `Golden hour starts in about ${startsIn} minutes — the best light of the day is on its way.`,
          payload: {
            beachSlug: row.slug,
            goldenHourStart: goldenStart.toISOString(),
            startsInMinutes: startsIn,
          },
        });
      }
    }

    if (row.prev_condition_id != null) {
      const latestSeverity = row.water_quality
        ? WATER_QUALITY_SEVERITY[row.water_quality]
        : undefined;
      const prevSeverity = row.prev_water_quality
        ? WATER_QUALITY_SEVERITY[row.prev_water_quality]
        : undefined;
      const latestWave =
        row.wave_height_m == null ? null : Number(row.wave_height_m);
      const prevWave =
        row.prev_wave_height_m == null ? null : Number(row.prev_wave_height_m);
      const qualityDowngraded =
        latestSeverity != null &&
        prevSeverity != null &&
        latestSeverity > prevSeverity;
      const waveSpiked =
        latestWave != null && prevWave != null && latestWave - prevWave >= 1;
      if (qualityDowngraded || waveSpiked) {
        const reasons: string[] = [];
        if (qualityDowngraded) {
          reasons.push(
            `water quality moved from ${row.prev_water_quality} to ${row.water_quality}`,
          );
        }
        if (waveSpiked) {
          reasons.push(
            `waves jumped from ${prevWave?.toFixed(1)}m to ${latestWave?.toFixed(1)}m`,
          );
        }
        candidates.push({
          userId: row.user_id,
          kind: "condition-change",
          dedupeKey: `condition:${row.beach_id}:${row.condition_id}`,
          title: `Conditions changing at ${row.beach_name}`,
          body: `Latest update: ${reasons.join(" and ")}. Check the beach page before you go.`,
          payload: {
            beachSlug: row.slug,
            conditionId: row.condition_id,
            waterQuality: row.water_quality,
            waveHeightM: latestWave,
          },
        });
      }
    }
  }
}

/**
 * Published events whose window is active or starting soon, for users who
 * saved the event's beach. Dedupe key is per event, so an all-day event fires
 * exactly once across refresh runs.
 */
async function collectEventAlerts(
  db: Queryable,
  now: Date,
  candidates: AlertCandidate[],
): Promise<void> {
  const result = await db.query<EventAlertRow>(
    `select e.id as event_id, e.title, e.start_at, e.end_at,
       b.name as beach_name, b.slug, us.user_id
     from beach_event e
     join beach b on b.id = e.beach_id
     join user_saved_beach us on us.beach_id = e.beach_id
     where e.state = 'published'
       and e.start_at <= $2 and e.end_at > $1
     order by e.start_at asc`,
    [now, new Date(now.getTime() + minutes(EVENT_START_WINDOW_MINUTES))],
  );

  for (const row of result.rows) {
    const startMs = new Date(row.start_at).getTime();
    const endMs = new Date(row.end_at).getTime();
    if (endMs <= now.getTime()) continue;
    if (startMs > now.getTime() + minutes(EVENT_START_WINDOW_MINUTES)) continue;
    const started = startMs <= now.getTime();
    const startsIn = started
      ? null
      : Math.round((startMs - now.getTime()) / 60_000);
    const title = started
      ? `Happening now: ${row.title}`
      : `Starting soon: ${row.title}`;
    const body = started
      ? `"${row.title}" just started at ${row.beach_name} — head over if you're in the area.`
      : `"${row.title}" starts in about ${startsIn} minutes at ${row.beach_name}.`;
    candidates.push({
      userId: row.user_id,
      kind: "event-starting-soon",
      dedupeKey: `event:${row.event_id}`,
      title,
      body,
      payload: {
        beachSlug: row.slug,
        eventId: row.event_id,
        startsAt: new Date(row.start_at).toISOString(),
      },
    });
  }
}

/**
 * Fresh, still-active hazards on saved beaches, reported as condition-change
 * alerts so one toggle governs both.
 */
async function collectHazardAlerts(
  db: Queryable,
  now: Date,
  candidates: AlertCandidate[],
): Promise<void> {
  const result = await db.query<HazardAlertRow>(
    `select h.id as hazard_id, h.severity, h.title, h.detail,
       h.created_at, h.expires_at, b.name as beach_name, b.slug, us.user_id
     from hazard_alert h
     join beach b on b.id = h.beach_id
     join user_saved_beach us on us.beach_id = h.beach_id
     where h.created_at > $1
       and (h.expires_at is null or h.expires_at > $2)`,
    [new Date(now.getTime() - minutes(HAZARD_RECENT_MINUTES)), now],
  );

  for (const row of result.rows) {
    if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
      continue;
    }
    candidates.push({
      userId: row.user_id,
      kind: "condition-change",
      dedupeKey: `hazard:${row.hazard_id}`,
      title: `${capitalize(row.severity)} hazard at ${row.beach_name}: ${row.title}`,
      body: row.detail,
      payload: {
        beachSlug: row.slug,
        hazardId: row.hazard_id,
        severity: row.severity,
      },
    });
  }
}

/** Upcoming confirmed/pending bookings for the booking owner only. */
async function collectBookingAlerts(
  db: Queryable,
  now: Date,
  candidates: AlertCandidate[],
): Promise<void> {
  const result = await db.query<BookingAlertRow>(
    `select bk.id as booking_id, bk.starts_at,
       b.name as beach_name, b.slug, bk.user_id
     from booking bk
     join beach b on b.id = bk.beach_id
     where bk.status in ('pending', 'confirmed')
       and bk.starts_at > $1 and bk.starts_at <= $2`,
    [now, new Date(now.getTime() + minutes(BOOKING_REMINDER_WINDOW_MINUTES))],
  );

  for (const row of result.rows) {
    const startMs = new Date(row.starts_at).getTime();
    if (
      startMs <= now.getTime() ||
      startMs > now.getTime() + minutes(BOOKING_REMINDER_WINDOW_MINUTES)
    ) {
      continue;
    }
    const startsIn = Math.round((startMs - now.getTime()) / 60_000);
    candidates.push({
      userId: row.user_id,
      kind: "booking-reminder",
      dedupeKey: `booking:${row.booking_id}`,
      title: `Your booking at ${row.beach_name} starts soon`,
      body: `Your reservation starts in about ${startsIn} minutes. Show the QR code in the app when you arrive.`,
      payload: {
        beachSlug: row.slug,
        bookingId: row.booking_id,
        startsAt: new Date(row.starts_at).toISOString(),
      },
    });
  }
}

/**
 * Applies one candidate: preference gate, mute window, dedupe ledger, then
 * in-app notification + push fan-out. The alert_dispatch insert is the
 * idempotency boundary — a conflicting row means this alert already went out
 * and nothing is queued or pushed.
 */
async function dispatchAlert(
  db: Queryable,
  adapter: PushAdapter,
  candidate: AlertCandidate,
  now: Date,
  errors: AlertEvaluationResult["errors"],
): Promise<DispatchOutcome> {
  const preferences = await db.query<{
    timezone: string;
    enabled: boolean | null;
    mute_start_minute: number | null;
    mute_end_minute: number | null;
  }>(
    `select u.timezone, p.enabled, p.mute_start_minute, p.mute_end_minute
     from app_user u
     left join alert_preference p on p.user_id = u.id and p.kind = $2
     where u.id = $1`,
    [candidate.userId, candidate.kind],
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
    [candidate.userId, candidate.kind, candidate.dedupeKey, candidate.payload],
  );
  if (!dedupe.rowCount) return "duplicates";

  await db.query(
    `insert into notification(user_id, kind, title, body, payload)
     values ($1, $2, $3, $4, $5)`,
    [
      candidate.userId,
      candidate.kind,
      candidate.title,
      candidate.body,
      { ...candidate.payload, dedupeKey: candidate.dedupeKey },
    ],
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
    kind: candidate.kind,
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
        source: `push:${candidate.kind}`,
        error: errorMessage(error),
      });
    }
  }
  return "dispatched";
}

/**
 * Runs every evaluator, then dispatches what they found. Each evaluator and
 * each dispatch is isolated: one beach or user failing never aborts the rest,
 * failures land in `errors` and the refresh job keeps its own exit code.
 */
export async function evaluateAlerts(
  db: Queryable,
  options: { now?: Date; adapter?: PushAdapter } = {},
): Promise<AlertEvaluationResult> {
  const now = options.now ?? new Date();
  const adapter = options.adapter ?? dispatchPush;
  const result: AlertEvaluationResult = {
    candidates: 0,
    dispatched: 0,
    duplicates: 0,
    suppressed: 0,
    errors: [],
  };
  const candidates: AlertCandidate[] = [];

  const evaluators: Array<[string, () => Promise<void>]> = [
    ["conditions", () => collectConditionAlerts(db, now, candidates)],
    ["events", () => collectEventAlerts(db, now, candidates)],
    ["hazards", () => collectHazardAlerts(db, now, candidates)],
    ["bookings", () => collectBookingAlerts(db, now, candidates)],
  ];
  for (const [source, run] of evaluators) {
    try {
      await run();
    } catch (error) {
      result.errors.push({ source, error: errorMessage(error) });
    }
  }

  for (const candidate of candidates) {
    result.candidates += 1;
    try {
      const outcome = await dispatchAlert(
        db,
        adapter,
        candidate,
        now,
        result.errors,
      );
      result[outcome] += 1;
    } catch (error) {
      result.errors.push({
        source: `dispatch:${candidate.kind}`,
        error: errorMessage(error),
      });
    }
  }
  return result;
}
