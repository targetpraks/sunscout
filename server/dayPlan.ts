/**
 * Timed Beach Day itinerary engine (day plan).
 *
 * Composes existing trunk data — latest live conditions (golden hour),
 * the latest-day tide readings, published beach events (server/events.ts)
 * and the user's own booking for that beach — into ONE time-ordered plan
 * for the rest of the beach-local day. Rendered as the expandable
 * "Your beach day" section of the Beach Day Guide card.
 *
 * Composition rules (deliberate mirror of src/tripday/timeline.ts — the
 * server tree cannot import from src/ and vice versa, the same duplicate-
 * with-drift-guard pattern as dayQuality.ts <-> src/dayOutlook/types.ts;
 * server/dayPlan.test.ts and src/tripday/tripday.test.ts pin the SAME
 * fixture and the SAME expected order so the two copies cannot drift):
 *
 *   arrival      — the hour ending at the lowest-tide window start
 *                  (falls back to 09:00–10:00 beach-local), so the plan
 *                  always starts with "get there before the good window".
 *   tide         — the window from the daytime lowest-tide reading to the
 *                  next reading (the widest-dry-sand leg). Uses the same
 *                  10:00–19:00 daytime filter as src/tide.ts.
 *   event        — one item per published event still running or starting
 *                  before the end of the plan day. Paid takeovers ARE
 *                  included and labeled — they are curated/visual content
 *                  that literally happens at the beach (the integrity
 *                  rule in server/events.ts bans them from RANKING, not
 *                  from the factual "what's on" timeline).
 *   golden-hour  — the golden-hour window from the latest condition row.
 *   booking      — the caller's own soonest pending/confirmed booking on
 *                  this beach, as the redemption window.
 *
 * Honesty rules:
 *   - every function takes `now`/the clock explicitly; the pure builder
 *     never reads the system clock, so the fixture test is deterministic;
 *   - windows that have already ended are dropped (the plan is for the
 *     rest of the day, never a stale history);
 *   - when nothing is left, the plan says so via emptyReason: "no_data"
 *     instead of inventing stops;
 *   - booking lookup is user-scoped: a plan never leaks another user's
 *     booking.
 *
 * Ordering is total and deterministic: startsAt ascending, then the kind
 * rank below, then the stable item id.
 */

import type { Pool, PoolClient } from "pg";
import type { Request, RequestHandler } from "express";
import { resolveOptionalUser } from "./auth";
import { consumerCalendarPartition, listBeachEvents } from "./events";

type Queryable = Pick<Pool | PoolClient, "query">;

/** Exported so tests and callers can type fake/connection-scoped DB handles. */
export type DayPlanDb = Queryable;

// ---------------------------------------------------------------------------
// Wire contract (mirrored in src/tripday/types.ts — keep in sync)
// ---------------------------------------------------------------------------

export const DAY_PLAN_KINDS = [
  "arrival",
  "tide",
  "event",
  "golden-hour",
  "booking",
] as const;

export type DayPlanItemKind = (typeof DAY_PLAN_KINDS)[number];

/**
 * Tie-break rank for items that share a start instant. Pinned in BOTH test
 * suites (the drift guard for the src/tripday mirror).
 */
export const DAY_PLAN_KIND_RANK: Record<DayPlanItemKind, number> = {
  arrival: 0,
  tide: 1,
  event: 2,
  "golden-hour": 3,
  booking: 4,
};

export type DayPlanEventInput = {
  /** Stable id (event public id) — used for React keys and tie-breaks. */
  id: string;
  title: string;
  category: string;
  /** ISO instant. */
  startsAt: string;
  /** ISO instant. */
  endsAt: string;
  paidTakeover: { isPaid: boolean; sponsorName: string | null };
};

export type DayPlanInput = {
  slug: string;
  /** IANA timezone of the beach (e.g. "Europe/Lisbon"). */
  timezone: string;
  goldenHour: { startsAt: string; endsAt: string } | null;
  /** Latest-day tide readings, sorted by HH:MM label. */
  tide: Array<{ time: string; level: number }>;
  events: DayPlanEventInput[];
  booking: { startsAt: string; endsAt: string; summary: string } | null;
  /** ISO instant the plan is computed at — injected, never the clock. */
  now: string;
};

export type DayPlanItem = {
  id: string;
  kind: DayPlanItemKind;
  label: string;
  detail: string | null;
  /** ISO instant of the window start. */
  startsAt: string;
  /** ISO instant of the window end (exclusive). */
  endsAt: string;
  /** Beach-local HH:MM display of the window start. */
  startTime: string;
  /** Beach-local HH:MM display of the window end. */
  endTime: string;
};

export type DayPlan = {
  slug: string;
  /** Beach-local date the plan covers (YYYY-MM-DD). */
  date: string;
  items: DayPlanItem[];
  /** Honest empty-state reason; null whenever items exist. */
  emptyReason: "no_data" | null;
  /** ISO instant the plan was computed at. */
  computedAt: string;
};

// ---------------------------------------------------------------------------
// Timezone helpers (DST-correct via Intl, deterministic across runtimes)
// ---------------------------------------------------------------------------

const PARTS_CACHE = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = PARTS_CACHE.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PARTS_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

/** Offset (ms) the timezone is behind UTC at the given instant. */
function timeZoneOffsetMs(at: Date, timeZone: string): number {
  const parts = offsetFormatter(timeZone).formatToParts(at);
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "0";
  const asUtc = Date.parse(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get(
      "minute",
    )}:${get("second")}Z`,
  );
  return asUtc - at.getTime();
}

/**
 * Convert a beach-local wall clock (date + HH:MM) to a UTC instant,
 * DST-correct. Naive labels (tide readings carry no zone) are anchored to
 * the beach timezone exactly like the display side, so a label and its
 * formatted instant can never disagree by an hour.
 */
export function zonedTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const offset = timeZoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

/** Beach-local HH:MM display for an ISO instant. */
export function formatClock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Beach-local calendar date (YYYY-MM-DD) for an ISO instant. */
function localDateOf(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

function clockHour(label: string): number {
  return Number(label.split(":")[0]);
}

// ---------------------------------------------------------------------------
// Pure plan builder — no DB, no clock reads
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

/** Daytime window for the lowest-tide pick — mirrors src/tide.ts daytimeLowest. */
export function daytimeLowestTide(
  points: DayPlanInput["tide"],
): { index: number; time: string; level: number } | null {
  let best: { index: number; time: string; level: number } | null = null;
  points.forEach((point, index) => {
    const hour = clockHour(point.time);
    if (hour < 10 || hour > 19) return;
    if (!best || point.level < best.level) {
      best = { index, time: point.time, level: point.level };
    }
  });
  return best;
}

/**
 * Build the deterministic day plan from a fixed input. Pure: given the same
 * input (including `now`) it always produces the same ordered items.
 */
export function buildDayPlan(input: DayPlanInput): DayPlan {
  const timeZone = input.timezone;
  const now = new Date(input.now);
  const date = localDateOf(input.now, timeZone);
  // Plan-day horizon: the next beach-local midnight. Windows starting after
  // it belong to tomorrow's plan, not this one. Deliberately NOT the golden
  // hour end — an evening event that starts after sunset is still tonight.
  const dayEnd = zonedTimeToInstant(date, "23:59", timeZone);

  const items: DayPlanItem[] = [];
  const push = (
    kind: DayPlanItemKind,
    id: string,
    label: string,
    detail: string | null,
    start: Date,
    end: Date,
  ): void => {
    items.push({
      id,
      kind,
      label,
      detail,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      startTime: formatClock(start.toISOString(), timeZone),
      endTime: formatClock(end.toISOString(), timeZone),
    });
  };

  // Lowest-tide window: from the daytime low reading to the next reading.
  const lowest = daytimeLowestTide(input.tide);
  let tideWindow: { start: Date; end: Date } | null = null;
  if (lowest) {
    const start = zonedTimeToInstant(date, lowest.time, timeZone);
    const next = input.tide[lowest.index + 1];
    const end = next
      ? zonedTimeToInstant(date, next.time, timeZone)
      : new Date(start.getTime() + HOUR_MS);
    if (end.getTime() > start.getTime()) {
      tideWindow = { start, end };
    }
  }

  // Events and windows still ahead today (happening-now included — its end
  // is still in the future, so it belongs in the rest-of-day plan).
  const liveEvents = input.events.filter((event) => {
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    return end.getTime() > now.getTime() && start.getTime() < dayEnd.getTime();
  });

  // Honest empty state: with no tide, no golden hour, no live events and no
  // booking there is nothing to sequence — say so instead of inventing a
  // synthetic day around a made-up arrival time.
  const booking =
    input.booking &&
    new Date(input.booking.endsAt).getTime() >
      new Date(input.booking.startsAt).getTime()
      ? input.booking
      : null;
  if (!tideWindow && !input.goldenHour && !liveEvents.length && !booking) {
    return {
      slug: input.slug,
      date,
      items: [],
      emptyReason: "no_data",
      computedAt: input.now,
    };
  }

  // Arrival: the hour ending at the tide window start, or a 09:00 fallback.
  const arrivalStart = tideWindow
    ? new Date(tideWindow.start.getTime() - HOUR_MS)
    : zonedTimeToInstant(date, "09:00", timeZone);
  const arrivalEnd = tideWindow
    ? tideWindow.start
    : zonedTimeToInstant(date, "10:00", timeZone);
  push(
    "arrival",
    "arrival",
    "Arrive",
    tideWindow
      ? "Get in just before the lowest tide — most dry sand of the day."
      : "Morning arrival — beat the midday crowd.",
    arrivalStart,
    arrivalEnd,
  );

  if (tideWindow) {
    push(
      "tide",
      "tide",
      "Lowest tide",
      "Widest beach window around the low — best sand and shallow water.",
      tideWindow.start,
      tideWindow.end,
    );
  }

  for (const event of input.events) {
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    if (end.getTime() <= now.getTime()) continue;
    if (start.getTime() >= dayEnd.getTime()) continue;
    const detail = event.paidTakeover.isPaid
      ? `${event.category} — Paid takeover${event.paidTakeover.sponsorName ? ` by ${event.paidTakeover.sponsorName}` : ""}`
      : event.category;
    push("event", `event:${event.id}`, event.title, detail, start, end);
  }

  if (input.goldenHour) {
    const start = new Date(input.goldenHour.startsAt);
    const end = new Date(input.goldenHour.endsAt);
    if (end.getTime() > start.getTime()) {
      push(
        "golden-hour",
        "golden-hour",
        "Golden hour",
        "Last good light of the day — photos, then pack up.",
        start,
        end,
      );
    }
  }

  if (booking) {
    const start = new Date(booking.startsAt);
    const end = new Date(booking.endsAt);
    push(
      "booking",
      "booking",
      "Redeem your booking",
      booking.summary,
      start,
      end,
    );
  }

  // The plan is for the rest of the day: windows that already ended drop.
  const kept = items.filter(
    (item) => new Date(item.endsAt).getTime() > now.getTime(),
  );
  kept.sort((a, b) => {
    const byStart = a.startsAt.localeCompare(b.startsAt);
    if (byStart !== 0) return byStart;
    const byRank = DAY_PLAN_KIND_RANK[a.kind] - DAY_PLAN_KIND_RANK[b.kind];
    if (byRank !== 0) return byRank;
    return a.id.localeCompare(b.id);
  });

  return {
    slug: input.slug,
    date,
    items: kept,
    emptyReason: kept.length ? null : "no_data",
    computedAt: input.now,
  };
}

// ---------------------------------------------------------------------------
// DB composition
// ---------------------------------------------------------------------------

type BeachRow = {
  id: number;
  public_id: string;
  slug: string;
  timezone: string;
};

async function resolveBeachBySlug(
  db: DayPlanDb,
  slug: string,
): Promise<BeachRow | null> {
  const result = await db.query<BeachRow>(
    `select id, public_id::text, slug, timezone from beach where slug = $1`,
    [slug],
  );
  return result.rows[0] ?? null;
}

type BookingRow = {
  id: number;
  starts_at: Date;
  ends_at: Date;
};

/**
 * The caller's soonest still-relevant booking on this beach. User-scoped by
 * construction; statuses limited to pending/confirmed so cancelled, redeemed
 * and no-show bookings never appear as a redemption window.
 */
async function loadUserBooking(
  db: DayPlanDb,
  beachId: number,
  userId: number,
  now: Date,
): Promise<{ startsAt: string; endsAt: string; summary: string } | null> {
  const booking = await db.query<BookingRow>(
    `select id, starts_at, ends_at from booking
     where beach_id = $1 and user_id = $2
       and status in ('pending', 'confirmed')
       and ends_at > $3
     order by starts_at asc
     limit 1`,
    [beachId, userId, now],
  );
  const row = booking.rows[0];
  if (!row) return null;
  const items = await db.query<{
    amenity_type: string;
    quantity: number;
  }>(
    `select i.amenity_type, sum(bi.quantity)::int as quantity
     from booking_item bi
     join amenity_inventory i on i.id = bi.inventory_id
     where bi.booking_id = $1
     group by i.amenity_type
     order by i.amenity_type`,
    [row.id],
  );
  // Consumer-facing summary: pluralize the amenity when the quantity is
  // > 1. Every amenity_type enum value (sunbed/umbrella/cabana/activity)
  // takes a regular -s plural, so a suffix is enough and stays testable.
  const summary = items.rows.length
    ? items.rows
        .map(
          (item) =>
            `${item.quantity} ${item.amenity_type}${item.quantity === 1 ? "" : "s"}`,
        )
        .join(" · ")
    : "Your reservation";
  return {
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    summary,
  };
}

/**
 * Compose the day plan for one beach from live DB rows. Returns null only
 * when the beach slug is unknown; any missing data source degrades to an
 * honest smaller plan (or the no_data empty state) rather than an error.
 */
export async function getDayPlan(
  db: DayPlanDb,
  slug: string,
  options: { now?: Date; userId?: number | null } = {},
): Promise<DayPlan | null> {
  const beach = await resolveBeachBySlug(db, slug);
  if (!beach) return null;

  const now = options.now ?? new Date();
  const userId = options.userId ?? null;

  const [condition, tide, events] = await Promise.all([
    db.query<{ golden_hour_start: Date | null; golden_hour_end: Date | null }>(
      `select golden_hour_start, golden_hour_end
       from beach_condition
       where beach_id = $1
       order by received_at desc
       limit 1`,
      [beach.id],
    ),
    db.query<{ time_label: string; height_m: string }>(
      `select time_label, height_m from beach_tide_reading
       where beach_id = $1
         and day = (select max(day) from beach_tide_reading where beach_id = $1)
       order by time_label`,
      [beach.id],
    ),
    listBeachEvents(db, beach.public_id),
  ]);

  const booking =
    userId != null ? await loadUserBooking(db, beach.id, userId, now) : null;

  const conditionRow = condition.rows[0];
  const goldenHour =
    conditionRow?.golden_hour_start && conditionRow.golden_hour_end
      ? {
          startsAt: new Date(conditionRow.golden_hour_start).toISOString(),
          endsAt: new Date(conditionRow.golden_hour_end).toISOString(),
        }
      : null;

  // Live-now + upcoming published events only — the same visibility rules
  // as the consumer calendar, so the plan can never disagree with it.
  const partition = consumerCalendarPartition(events, now);

  return buildDayPlan({
    slug: beach.slug,
    timezone: beach.timezone,
    goldenHour,
    tide: tide.rows.map((row) => ({
      time: row.time_label,
      level: Number(row.height_m),
    })),
    events: [...partition.happeningNow, ...partition.upcoming].map((event) => ({
      id: event.publicId,
      title: event.title,
      category: event.category,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      paidTakeover: {
        isPaid: event.paidTakeover.isPaid,
        sponsorName: event.paidTakeover.sponsorName,
      },
    })),
    booking,
    now: now.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

export type DayPlanHandlerOptions = {
  /** Injected clock — defaults to the real clock; tests inject a fixed one. */
  now?: () => Date;
  /**
   * Resolves the optional caller identity for the booking window. Defaults
   * to the shared auth helper; tests inject a stub so no real pool is hit.
   */
  resolveUserId?: (request: Request) => Promise<number | null>;
};

/**
 * GET /api/beaches/:slug/day-plan — the time-ordered day plan. 404 for an
 * unknown beach, 200 with the plan (or its honest empty state) otherwise.
 */
export function createDayPlanHandler(
  db: DayPlanDb,
  options: DayPlanHandlerOptions = {},
): RequestHandler {
  const resolveUserId = options.resolveUserId ?? resolveOptionalUser;
  return async (request, response) => {
    const userId = await resolveUserId(request).catch(() => null);
    const plan = await getDayPlan(db, String(request.params.slug), {
      now: options.now ? options.now() : new Date(),
      userId,
    });
    if (!plan) {
      response.status(404).json({ error: "beach_not_found" });
      return;
    }
    response.json({ data: plan });
  };
}
