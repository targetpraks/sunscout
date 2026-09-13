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
