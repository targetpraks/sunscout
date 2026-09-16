import type { PulseAudience } from "../pulse/types";

/**
 * Client-side event domain types and pure helpers. Mirrors the server module
 * (server/events.ts) — the front-end cannot import server code, so keep the
 * two copies aligned. Field names must match the server serializer exactly.
 *
 * The paid-takeover flag lives only inside the nested `paidTakeover` object
 * and is never read by any ranking/pulse logic (see PAID_TAKEOVER_LABEL).
 */

export const EVENT_CATEGORIES = [
  "party",
  "surf-competition",
  "beach-soccer",
  "triathlon",
  "sailing",
  "takeover",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  party: "Beach party",
  "surf-competition": "Surf competition",
  "beach-soccer": "Beach soccer",
  triathlon: "Triathlon",
  sailing: "Sailing",
  takeover: "Beach takeover",
};

export const EVENT_STATES = ["draft", "published", "cancelled"] as const;

export type EventState = (typeof EVENT_STATES)[number];

export const EVENT_STATE_LABELS: Record<EventState, string> = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
};

/**
 * Monetization label for paid beach/island/region takeovers. Owns ONLY the
 * visual/branding/curated layer; never consumed by earned rankings or the
 * Beach Pulse.
 */
export const PAID_TAKEOVER_LABEL = "Paid takeover";

export type PaidTakeover = {
  isPaid: boolean;
  label: string;
  sponsorName: string | null;
};

export type BeachEvent = {
  id: number;
  publicId: string;
  beachPublicId: string;
  beachName: string;
  coordinatorId: number;
  title: string;
  description: string | null;
  category: EventCategory;
  state: EventState;
  startsAt: string;
  endsAt: string;
  paidTakeover: PaidTakeover;
  createdAt: string;
  updatedAt: string;
};

export type EventInput = {
  beachPublicId: string;
  title: string;
  description?: string;
  category: EventCategory;
  startsAt: string;
  endsAt: string;
  isPaidTakeover?: boolean;
  sponsorName?: string;
};

export type EventPartition = {
  happeningNow: BeachEvent[];
  upcoming: BeachEvent[];
  past: BeachEvent[];
};

/**
 * Partitions events relative to a fixed reference time into three disjoint
 * buckets: past (end <= now), happeningNow (start <= now < end) and upcoming
 * (start > now). Upcoming and happening-now sort by start ascending, past by
 * end descending. Pure: no DB, and deliberately ignores paidTakeover.
 */
export function partitionEvents(
  events: BeachEvent[],
  now: Date,
): EventPartition {
  const ref = now.getTime();
  const happeningNow: BeachEvent[] = [];
  const upcoming: BeachEvent[] = [];
  const past: BeachEvent[] = [];
  for (const event of events) {
    const start = new Date(event.startsAt).getTime();
    const end = new Date(event.endsAt).getTime();
    if (end <= ref) {
      past.push(event);
    } else if (start <= ref) {
      happeningNow.push(event);
    } else {
      upcoming.push(event);
    }
  }
  const byStartAsc = (a: BeachEvent, b: BeachEvent) =>
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  const byEndDesc = (a: BeachEvent, b: BeachEvent) =>
    new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime();
  upcoming.sort(byStartAsc);
  happeningNow.sort(byStartAsc);
  past.sort(byEndDesc);
  return { happeningNow, upcoming, past };
}

/**
 * Events visible on the consumer calendar: only published ones. Drafts and
 * cancelled events stay coordinator-private.
 */
export function consumerVisibleEvents(events: BeachEvent[]): BeachEvent[] {
  return events.filter((event) => event.state === "published");
}

export function consumerCalendarPartition(
  events: BeachEvent[],
  now: Date,
): EventPartition {
  return partitionEvents(consumerVisibleEvents(events), now);
}

export function formatEventRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = start.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const fmt = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${day} · ${fmt(start)}–${fmt(end)}`
    : `${day} ${fmt(start)} – ${end.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${fmt(end)}`;
}

/**
 * Human label for how much of an event's window is left, relative to `now`.
 * Pure and locale-free so tests stay deterministic. Windows that have
 * already closed report "Ended" — defensive only: callers filter first.
 */
export function formatEventRemaining(endsAt: string, now: Date): string {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (ms <= 0) return "Ended";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes === 0) return "Ends in <1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `Ends in ${minutes}m`;
  return minutes === 0 ? `Ends in ${hours}h` : `Ends in ${hours}h ${minutes}m`;
}

// === Consumer "What's happening" screen: pure filtering and grouping ===
//
// The screen is a client-side view over the per-beach /api/events feeds:
// everything below is pure (no DB, no clock reads) so node tests stay
// deterministic. None of it is consumed by the Beach Pulse or rankings.

/** Date windows offered on the events screen. */
export const EVENT_WINDOWS = ["today", "weekend", "week", "anytime"] as const;

export type EventWindow = (typeof EVENT_WINDOWS)[number];

export const EVENT_WINDOW_LABELS: Record<EventWindow, string> = {
  today: "Today",
  weekend: "This weekend",
  week: "Next 7 days",
  anytime: "Any time",
};

/**
 * Client-side convenience map from event category to the pulse audiences it
 * plausibly serves. The server event model has no audience field, so the
 * consumer screen derives one from the category. Purely a UI affordance —
 * this map is never consumed by the Beach Pulse or any ranking.
 */
export const EVENT_CATEGORY_AUDIENCES: Record<
  EventCategory,
  readonly PulseAudience[]
> = {
  party: ["party", "friends"],
  "surf-competition": ["party", "friends", "solo"],
  "beach-soccer": ["family", "friends"],
  triathlon: ["friends", "solo"],
  sailing: ["couples", "chill", "solo"],
  takeover: ["family", "friends", "solo", "couples", "party", "chill"],
};

const DAY_MS = 86_400_000;

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export type EventWindowRange = {
  /** Inclusive local-midnight start of the window. */
  start: Date;
  /** Exclusive end, or null for an open-ended window. */
  end: Date | null;
};

/**
 * Resolve a date window to an absolute range relative to `now`, in the
 * viewer's local calendar. "weekend" covers the Saturday the current or
 * upcoming weekend begins (Sunday events included via the end bound).
 */
export function eventWindowRange(
  window: EventWindow,
  now: Date,
): EventWindowRange {
  const start = localMidnight(now);
  if (window === "today")
    return { start, end: new Date(start.getTime() + DAY_MS) };
  if (window === "week")
    return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
  if (window === "anytime") return { start, end: null };
  const day = now.getDay();
  const satOffset = day === 0 ? -1 : 6 - day;
  const saturday = new Date(start.getTime() + satOffset * DAY_MS);
  return { start: saturday, end: new Date(saturday.getTime() + 2 * DAY_MS) };
}

export type ScreenEventFilters = {
  window: EventWindow;
  audience: PulseAudience | null;
};

/**
 * Filter a raw merged event feed down to what the consumer screen shows:
 * published, not yet ended, overlapping the selected window, and matching
 * the selected audience. Sorted by start ascending. Deliberately ignores
 * the paid-takeover flag — paid placement never changes visibility.
 */
export function filterScreenEvents(
  events: BeachEvent[],
  filters: ScreenEventFilters,
  now: Date,
): BeachEvent[] {
  const ref = now.getTime();
  const range = eventWindowRange(filters.window, now);
  const rangeStart = range.start.getTime();
  const rangeEnd = range.end?.getTime() ?? null;
  return consumerVisibleEvents(events)
    .filter((event) => {
      const start = new Date(event.startsAt).getTime();
      const end = new Date(event.endsAt).getTime();
      return (
        end > ref && end > rangeStart && (rangeEnd == null || start < rangeEnd)
      );
    })
    .filter(
      (event) =>
        filters.audience == null ||
        EVENT_CATEGORY_AUDIENCES[event.category].includes(filters.audience),
    )
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
}

export type EventDayGroup = {
  /** `new Date(startsAt).toDateString()` of the group's local day. */
  dayKey: string;
  /** "Today", "Tomorrow" or a weekday + date label. */
  label: string;
  isToday: boolean;
  /** Events in the day, sorted by start ascending. */
  events: BeachEvent[];
};

/**
 * Bucket events by local calendar day. Events whose window covers `now`
 * always land in the Today group (they are what's actually happening),
 * everything else buckets by its start day. Groups sort Today first, then
 * ascending by day; each group's events sort by start ascending.
 */
export function groupEventsByDay(
  events: BeachEvent[],
  now: Date,
): EventDayGroup[] {
  const ref = now.getTime();
  const todayKey = now.toDateString();
  const tomorrow = new Date(localMidnight(now).getTime() + DAY_MS);
  const tomorrowKey = tomorrow.toDateString();
  const buckets = new Map<string, BeachEvent[]>();
  for (const event of [...events].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  )) {
    const start = new Date(event.startsAt).getTime();
    const end = new Date(event.endsAt).getTime();
    const key =
      start <= ref && ref < end
        ? todayKey
        : new Date(event.startsAt).toDateString();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(event);
    else buckets.set(key, [event]);
  }
  const groups: Array<EventDayGroup & { sortInstant: number }> = [];
  for (const [dayKey, bucketEvents] of buckets) {
    const first = new Date(bucketEvents[0].startsAt);
    const isToday = dayKey === todayKey;
    const label = isToday
      ? "Today"
      : dayKey === tomorrowKey
        ? "Tomorrow"
        : first.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "short",
          });
    groups.push({
      dayKey,
      label,
      isToday,
      events: bucketEvents,
      sortInstant: isToday ? ref - 1 : localMidnight(first).getTime(),
    });
  }
  groups.sort((a, b) => a.sortInstant - b.sortInstant);
  return groups.map(({ sortInstant: _sortInstant, ...group }) => group);
}

export type EventBeachGroup = {
  beachPublicId: string;
  beachName: string;
  events: BeachEvent[];
};

/**
 * Group events per beach, first-seen order preserved, events in input
 * order. The screen renders one group per beach so a beachgoer can scan
 * what each beach has on.
 */
export function groupEventsByBeach(events: BeachEvent[]): EventBeachGroup[] {
  const groups: EventBeachGroup[] = [];
  const index = new Map<string, EventBeachGroup>();
  for (const event of events) {
    const existing = index.get(event.beachPublicId);
    if (existing) {
      existing.events.push(event);
      continue;
    }
    const group: EventBeachGroup = {
      beachPublicId: event.beachPublicId,
      beachName: event.beachName,
      events: [event],
    };
    index.set(event.beachPublicId, group);
    groups.push(group);
  }
  return groups;
}
