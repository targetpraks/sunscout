/**
 * Trip Day tests — client half of the timed Beach Day itinerary.
 *
 * Coverage mirrors the acceptance criteria:
 *  - buildDayPlan (the client mirror in ./timeline) deterministically orders
 *    arrival, lowest-tide window, event windows, golden hour and the booking
 *    redemption window from a FIXED conditions + tide + events fixture,
 *  - the honest empty state (no_data) when nothing is left to sequence,
 *  - the kind-rank tie-break table is pinned to the exact values of
 *    server/dayPlan.ts (the two trees cannot import each other, so the
 *    pinned literals are the drift guard, the same pattern as
 *    dayOutlook.test.ts pinning the tier constants),
 *  - the presentational components render the ordered items, their
 *    beach-local times, and their honest empty/error states.
 *
 * The fixture and the expected order are deliberately identical to
 * server/dayPlan.test.ts — change one, change both.
 *
 * JSX is avoided (React.createElement) so this file is a plain .ts test
 * matching the vitest include glob (node environment, no DOM).
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDayPlan, daytimeLowestTide } from "./timeline";
import { TripDayTimeline } from "./TripDayTimeline";
import { TripDayTimelineCard } from "./TripDayTimelineCard";
import {
  DAY_PLAN_KINDS,
  DAY_PLAN_KIND_RANK,
  type DayPlan,
  type DayPlanEventInput,
  type DayPlanInput,
} from "./types";

// ---------------------------------------------------------------------------
// Shared fixture — identical in server/dayPlan.test.ts (drift guard)
// ---------------------------------------------------------------------------

const BEACH_SLUG = "praia-do-mirante";
const BEACH_TIMEZONE = "Europe/Lisbon"; // WEST (UTC+1) on 2026-06-15
/** 09:00 beach-local. */
const NOW = "2026-06-15T08:00:00Z";

const TIDE_POINTS = [
  { time: "06:00", level: 1.9 },
  { time: "09:00", level: 1.2 },
  { time: "12:00", level: 0.6 },
  { time: "14:00", level: 0.4 },
  { time: "17:00", level: 1.1 },
  { time: "20:00", level: 1.8 },
];

/** 19:30–20:15 beach-local. */
const GOLDEN_HOUR = {
  startsAt: "2026-06-15T18:30:00Z",
  endsAt: "2026-06-15T19:15:00Z",
};

function planEvent(
  id: string,
  startsAt: string,
  endsAt: string,
  overrides: Partial<DayPlanEventInput> = {},
): DayPlanEventInput {
  return {
    id,
    title: `Event ${id}`,
    category: "party",
    startsAt,
    endsAt,
    paidTakeover: { isPaid: false, sponsorName: null },
    ...overrides,
  };
}

const FIXTURE_EVENTS: DayPlanEventInput[] = [
  // Live later today: 16:00–18:00 beach-local.
  planEvent("e-party", "2026-06-15T15:00:00Z", "2026-06-15T17:00:00Z", {
    title: "Sunset Beach Party",
  }),
  // Paid takeover tonight: 20:00–22:00 beach-local — included and labeled.
  planEvent("e-takeover", "2026-06-15T19:00:00Z", "2026-06-15T21:00:00Z", {
    title: "Brand Takeover Bash",
    category: "takeover",
    paidTakeover: { isPaid: true, sponsorName: "Sunblock Co" },
  }),
  // Already over by now: 06:00–08:00 beach-local — must be dropped.
  planEvent("e-past", "2026-06-15T05:00:00Z", "2026-06-15T07:00:00Z", {
    title: "Morning Yoga",
  }),
  // Tomorrow: belongs to tomorrow's plan, not this one.
  planEvent("e-tomorrow", "2026-06-16T15:00:00Z", "2026-06-16T17:00:00Z", {
    title: "Tomorrow Party",
  }),
];

/** 15:00–17:00 beach-local. */
const BOOKING = {
  startsAt: "2026-06-15T14:00:00Z",
  endsAt: "2026-06-15T16:00:00Z",
  summary: "2 sunbeds · 1 umbrella",
};

const FULL_FIXTURE: DayPlanInput = {
  slug: BEACH_SLUG,
  timezone: BEACH_TIMEZONE,
  goldenHour: GOLDEN_HOUR,
  tide: TIDE_POINTS,
  events: FIXTURE_EVENTS,
  booking: BOOKING,
  now: NOW,
};

/** The expected chronological order for FULL_FIXTURE (beach-local starts). */
const EXPECTED_ORDER = [
  { kind: "arrival", startTime: "13:00", endTime: "14:00" },
  { kind: "tide", startTime: "14:00", endTime: "17:00" },
  { kind: "booking", startTime: "15:00", endTime: "17:00" },
  { kind: "event", startTime: "16:00", endTime: "18:00" },
  { kind: "golden-hour", startTime: "19:30", endTime: "20:15" },
  { kind: "event", startTime: "20:00", endTime: "22:00" },
] as const;

// ---------------------------------------------------------------------------
// Wire contract drift guard (server/dayPlan.ts <-> ./types)
// ---------------------------------------------------------------------------

describe("kind constants (drift guard with server/dayPlan.ts)", () => {
  it("pins the exact kind vocabulary", () => {
    expect([...DAY_PLAN_KINDS]).toEqual([
      "arrival",
      "tide",
      "event",
      "golden-hour",
      "booking",
    ]);
  });

  it("pins the tie-break rank table", () => {
    expect(DAY_PLAN_KIND_RANK).toEqual({
      arrival: 0,
      tide: 1,
      event: 2,
      "golden-hour": 3,
      booking: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// Pure builder (client mirror)
// ---------------------------------------------------------------------------

describe("buildDayPlan", () => {
  it("orders arrival, lowest tide, booking, events and golden hour chronologically from the fixed fixture", () => {
    const plan = buildDayPlan(FULL_FIXTURE);
    expect(plan.slug).toBe(BEACH_SLUG);
    expect(plan.emptyReason).toBeNull();
    expect(plan.date).toBe("2026-06-15");
    expect(
      plan.items.map((item) => ({
        kind: item.kind,
        startTime: item.startTime,
        endTime: item.endTime,
      })),
    ).toEqual([...EXPECTED_ORDER]);
  });

  it("is deterministic: the same input twice produces the identical plan", () => {
    expect(buildDayPlan(FULL_FIXTURE)).toEqual(buildDayPlan(FULL_FIXTURE));
  });

  it("derives the tide window from the daytime low to the next reading", () => {
    const tideItem = buildDayPlan(FULL_FIXTURE).items.find(
      (item) => item.kind === "tide",
    );
    expect(tideItem?.label).toBe("Lowest tide");
    // Daytime low is 14:00 (0.4 m); next reading 17:00 — window 14:00–17:00.
    expect(tideItem?.startTime).toBe("14:00");
    expect(tideItem?.endTime).toBe("17:00");
    expect(tideItem?.startsAt).toBe("2026-06-15T13:00:00.000Z");
  });

  it("schedules arrival to end exactly at the tide window start", () => {
    const plan = buildDayPlan(FULL_FIXTURE);
    const arrival = plan.items.find((item) => item.kind === "arrival");
    const tide = plan.items.find((item) => item.kind === "tide");
    expect(arrival?.endsAt).toBe(tide?.startsAt);
  });

  it("drops events that already ended or start after the plan day", () => {
    const titles = buildDayPlan(FULL_FIXTURE)
      .items.filter((item) => item.kind === "event")
      .map((item) => item.label);
    expect(titles).toEqual(["Sunset Beach Party", "Brand Takeover Bash"]);
    expect(titles).not.toContain("Morning Yoga");
    expect(titles).not.toContain("Tomorrow Party");
  });

  it("labels a paid takeover event without hiding it (integrity rule is about rank, not facts)", () => {
    const takeover = buildDayPlan(FULL_FIXTURE).items.find(
      (item) => item.id === "event:e-takeover",
    );
    expect(takeover?.detail).toBe("takeover — Paid takeover by Sunblock Co");
  });

  it("breaks start-time ties by kind rank, then stable id", () => {
    const a = planEvent(
      "b-event",
      "2026-06-15T15:00:00Z",
      "2026-06-15T17:00:00Z",
    );
    const b = planEvent(
      "a-event",
      "2026-06-15T15:00:00Z",
      "2026-06-15T17:00:00Z",
    );
    const plan = buildDayPlan({
      ...FULL_FIXTURE,
      booking: null,
      goldenHour: null,
      events: [b, a],
    });
    const sameStart = plan.items.filter(
      (item) => item.startTime === "16:00" && item.kind === "event",
    );
    expect(sameStart.map((item) => item.id)).toEqual([
      "event:a-event",
      "event:b-event",
    ]);
  });

  it("returns the honest no_data empty state when no source has anything to sequence", () => {
    const plan = buildDayPlan({
      slug: BEACH_SLUG,
      timezone: BEACH_TIMEZONE,
      goldenHour: null,
      tide: [],
      events: [],
      booking: null,
      now: NOW,
    });
    expect(plan.items).toEqual([]);
    expect(plan.emptyReason).toBe("no_data");
  });

  it("goes empty late in the evening once every window has passed", () => {
    const plan = buildDayPlan({
      ...FULL_FIXTURE,
      // 21:30 beach-local — everything except the takeover has ended, and the
      // takeover window (20:00–22:00) still runs... it must survive.
      now: "2026-06-15T20:30:00Z",
    });
    expect(plan.items.map((item) => item.id)).toEqual(["event:e-takeover"]);
    // 23:00 beach-local — even the takeover is over: nothing left today.
    const done = buildDayPlan({
      ...FULL_FIXTURE,
      now: "2026-06-15T22:00:00Z",
    });
    expect(done.items).toEqual([]);
    expect(done.emptyReason).toBe("no_data");
  });

  it("goes empty when the only data is a booking that already ended", () => {
    const plan = buildDayPlan({
      slug: BEACH_SLUG,
      timezone: BEACH_TIMEZONE,
      goldenHour: null,
      tide: [],
      events: [],
      // 15:00–17:00 beach-local, but it is already 18:00 local.
      booking: BOOKING,
      now: "2026-06-15T17:00:00Z",
    });
    expect(plan.items).toEqual([]);
    expect(plan.emptyReason).toBe("no_data");
  });

  it("falls back to a morning arrival window when there is no tide data", () => {
    const plan = buildDayPlan({
      ...FULL_FIXTURE,
      tide: [],
      events: [],
      booking: null,
    });
    const arrival = plan.items.find((item) => item.kind === "arrival");
    expect(arrival?.startTime).toBe("09:00");
    expect(arrival?.endTime).toBe("10:00");
  });
});

describe("daytimeLowestTide", () => {
  it("picks the lowest reading within the 10:00–19:00 daytime window", () => {
    expect(daytimeLowestTide(TIDE_POINTS)).toEqual({
      index: 3,
      time: "14:00",
      level: 0.4,
    });
  });

  it("returns null for an empty or all-night-time series", () => {
    expect(daytimeLowestTide([])).toBeNull();
    expect(
      daytimeLowestTide([
        { time: "02:00", level: 0.2 },
        { time: "04:00", level: 0.1 },
      ]),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Components (renderToStaticMarkup — node environment, no DOM)
// ---------------------------------------------------------------------------

const FULL_PLAN: DayPlan = buildDayPlan(FULL_FIXTURE);
const EMPTY_PLAN: DayPlan = {
  slug: BEACH_SLUG,
  date: "2026-06-15",
  items: [],
  emptyReason: "no_data",
  computedAt: NOW,
};

describe("TripDayTimeline", () => {
  it("renders every plan item in order with its window and label", () => {
    const html = renderToStaticMarkup(
      createElement(TripDayTimeline, { plan: FULL_PLAN }),
    );
    for (const expected of EXPECTED_ORDER) {
      expect(html).toContain(`${expected.startTime}–${expected.endTime}`);
    }
    expect(html).toContain("Arrive");
    expect(html).toContain("Lowest tide");
    expect(html).toContain("Sunset Beach Party");
    expect(html).toContain("Golden hour");
    expect(html).toContain("Redeem your booking");
    // Ordered by start time: the arrival window appears before the party.
    expect(html.indexOf("13:00–14:00")).toBeLessThan(
      html.indexOf("Sunset Beach Party"),
    );
  });

  it("renders the honest empty state when the plan has no items", () => {
    const html = renderToStaticMarkup(
      createElement(TripDayTimeline, { plan: EMPTY_PLAN }),
    );
    expect(html).toContain("No plan yet");
    expect(html).not.toContain("Arrive");
  });
});

describe("TripDayTimelineCard", () => {
  it("renders nothing without a slug (call sites without a slug keep working)", () => {
    const html = renderToStaticMarkup(createElement(TripDayTimelineCard, {}));
    expect(html).not.toContain("Your beach day");
  });

  it("renders an explicit error state when the plan cannot be loaded", () => {
    const html = renderToStaticMarkup(
      createElement(TripDayTimelineCard, {
        slug: BEACH_SLUG,
        initialError: true,
        initialExpanded: true,
      }),
    );
    expect(html).toContain("Beach day plan unavailable right now");
  });

  it("renders the fetched plan when one is injected (expandable section)", () => {
    const html = renderToStaticMarkup(
      createElement(TripDayTimelineCard, {
        slug: BEACH_SLUG,
        initialPlan: FULL_PLAN,
        initialExpanded: true,
      }),
    );
    expect(html).toContain("Your beach day");
    expect(html).toContain("Arrive");
    expect(html).toContain("Golden hour");
  });

  it("renders the honest empty state when the fetched plan is empty", () => {
    const html = renderToStaticMarkup(
      createElement(TripDayTimelineCard, {
        slug: BEACH_SLUG,
        initialPlan: EMPTY_PLAN,
        initialExpanded: true,
      }),
    );
    expect(html).toContain("Your beach day");
    expect(html).toContain("No plan yet");
  });
});
