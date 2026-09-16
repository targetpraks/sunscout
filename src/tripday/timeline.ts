/**
 * Timed Beach Day itinerary — client engine (mirror of server/dayPlan.ts).
 *
 * The server endpoint (GET /api/beaches/:slug/day-plan) is the source of
 * truth on the wire; this mirror exists because the acceptance contract
 * for the card is deterministic ordering from raw conditions + tide +
 * events inputs, and so the two trees can never drift silently:
 *
 *   - server/dayPlan.test.ts and src/tripday/tripday.test.ts pin the SAME
 *     fixture and the SAME expected order,
 *   - DAY_PLAN_KIND_RANK is hard-pinned in both suites (the constants are
 *     deliberate duplicates — the server tree cannot import from src/
 *     and vice versa, the same pattern as dayQuality.ts <-> dayOutlook).
 *
 * Keep the composition rules byte-identical to server/dayPlan.ts:
 * arrival (hour ending at the tide window), tide (daytime low -> next
 * reading), events (live + upcoming, past and next-day dropped),
 * golden hour, booking redemption. When any source is empty the plan is
 * honestly empty (emptyReason: "no_data") instead of invented stops.
 */

import {
  DAY_PLAN_KIND_RANK,
  type DayPlan,
  type DayPlanInput,
  type DayPlanItem,
  type DayPlanItemKind,
} from "./types";

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

  for (const event of liveEvents) {
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
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
