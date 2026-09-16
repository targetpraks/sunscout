/**
 * Trip Day wire contract (client mirror of server/dayPlan.ts).
 *
 * KEEP IN SYNC with server/dayPlan.ts — the server tree cannot import from
 * src/ (server/tsconfig.json pins rootDir to server/), so the types and the
 * kind constants are deliberate duplicates, the same pattern as
 * src/dayOutlook/types.ts <-> server/dayQuality.ts.
 * src/tripday/tripday.test.ts and server/dayPlan.test.ts pin the SAME fixture
 * and the SAME expected order, so the two copies cannot drift silently.
 */

export const DAY_PLAN_KINDS = [
  "arrival",
  "tide",
  "event",
  "golden-hour",
  "booking",
] as const;

export type DayPlanItemKind = (typeof DAY_PLAN_KINDS)[number];

/**
 * Tie-break rank for items that share a start instant — the drift guard
 * pins these exact values against server/dayPlan.ts.
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
