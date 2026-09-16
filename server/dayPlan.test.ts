/**
 * Day plan engine tests — server half of the timed Beach Day itinerary.
 *
 * Coverage mirrors the acceptance criteria:
 *  - buildDayPlan deterministically orders arrival, lowest-tide window,
 *    event windows, golden hour and the booking redemption window from a
 *    fixed conditions + tide + events fixture, chronologically (the kind
 *    list enumerates item types; "time-ordered" is the ordering rule),
 *  - the honest empty state (no_data) when nothing is left to sequence,
 *  - getDayPlan composes DB rows, drops drafts/cancelled/past/next-day
 *    events, and never queries the booking for an anonymous caller,
 *  - the HTTP handler returns 200 with the ordered plan and 404 for an
 *    unknown beach,
 *  - the route is mounted inside routes/beaches.ts AND the documented
 *    mount-order trap holds: community subpaths (/api/beaches/:id/vibes,
 *    :id/pulse, :id/sightings) mounted before beachesRouter still win
 *    over the single-segment /api/beaches/:slug detail route.
 *
 * The fixture and the expected order are deliberately identical to the
 * ones pinned in src/tripday/tripday.test.ts — the client mirror cannot
 * import from server/ (and vice versa), so the two suites are the drift
 * guard, the same pattern as dayOutlook.test.ts pinning the tier
 * constants of server/dayQuality.ts.
 *
 * No Postgres: DB access is faked with the same asQuery cast pattern as
 * events.test.ts; the beachesRouter import is safe because the pool
 * connects lazily (proven by the existing pillarsRouter.test.ts).
 */

import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { beachesRouter } from "./routes/beaches";
import {
  buildDayPlan,
  createDayPlanHandler,
  DAY_PLAN_KIND_RANK,
  daytimeLowestTide,
  getDayPlan,
  type DayPlanDb,
  type DayPlanEventInput,
  type DayPlanInput,
} from "./dayPlan";

// ---------------------------------------------------------------------------
// Shared fixture — identical in src/tripday/tripday.test.ts (drift guard)
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
// Pure builder
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
    expect(DAY_PLAN_KIND_RANK.arrival).toBeLessThan(DAY_PLAN_KIND_RANK.tide);
    expect(DAY_PLAN_KIND_RANK.tide).toBeLessThan(DAY_PLAN_KIND_RANK.event);
    expect(DAY_PLAN_KIND_RANK.event).toBeLessThan(
      DAY_PLAN_KIND_RANK["golden-hour"],
    );
    expect(DAY_PLAN_KIND_RANK["golden-hour"]).toBeLessThan(
      DAY_PLAN_KIND_RANK.booking,
    );
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
// Fake DB helpers (asQuery pattern from events.test.ts)
// ---------------------------------------------------------------------------

function asQuery(
  fn: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>,
): DayPlanDb["query"] {
  return fn as unknown as DayPlanDb["query"];
}

const BEACH_ROW = {
  id: 42,
  public_id: "22222222-2222-4222-8222-222222222222",
  slug: BEACH_SLUG,
  timezone: BEACH_TIMEZONE,
};

const CONDITION_ROW = {
  golden_hour_start: "2026-06-15T18:30:00Z",
  golden_hour_end: "2026-06-15T19:15:00Z",
};

const TIDE_ROWS = TIDE_POINTS.map((point) => ({
  time_label: point.time,
  height_m: String(point.level),
}));

/** Event DB rows (EventRow shape from server/events.ts). */
const EVENT_ROWS = [
  {
    id: 1,
    public_id: "e-party",
    beach_public_id: BEACH_ROW.public_id,
    beach_name: "Praia do Mirante",
    coordinator_id: 7,
    title: "Sunset Beach Party",
    description: null,
    category: "party",
    state: "published",
    start_at: "2026-06-15T15:00:00Z",
    end_at: "2026-06-15T17:00:00Z",
    is_paid_takeover: false,
    sponsor_name: null,
    created_at: "2026-06-01T09:00:00Z",
    updated_at: "2026-06-01T09:00:00Z",
  },
  {
    id: 2,
    public_id: "e-takeover",
    beach_public_id: BEACH_ROW.public_id,
    beach_name: "Praia do Mirante",
    coordinator_id: 7,
    title: "Brand Takeover Bash",
    description: null,
    category: "takeover",
    state: "published",
    start_at: "2026-06-15T19:00:00Z",
    end_at: "2026-06-15T21:00:00Z",
    is_paid_takeover: true,
    sponsor_name: "Sunblock Co",
    created_at: "2026-06-01T09:00:00Z",
    updated_at: "2026-06-01T09:00:00Z",
  },
  {
    id: 3,
    public_id: "e-past",
    beach_public_id: BEACH_ROW.public_id,
    beach_name: "Praia do Mirante",
    coordinator_id: 7,
    title: "Morning Yoga",
    description: null,
    category: "party",
    state: "published",
    start_at: "2026-06-15T05:00:00Z",
    end_at: "2026-06-15T07:00:00Z",
    is_paid_takeover: false,
    sponsor_name: null,
    created_at: "2026-06-01T09:00:00Z",
    updated_at: "2026-06-01T09:00:00Z",
  },
  {
    id: 4,
    public_id: "e-draft",
    beach_public_id: BEACH_ROW.public_id,
    beach_name: "Praia do Mirante",
    coordinator_id: 7,
    title: "Secret Draft Gig",
    description: null,
    category: "party",
    state: "draft",
    start_at: "2026-06-15T15:00:00Z",
    end_at: "2026-06-15T17:00:00Z",
    is_paid_takeover: false,
    sponsor_name: null,
    created_at: "2026-06-01T09:00:00Z",
    updated_at: "2026-06-01T09:00:00Z",
  },
  {
    id: 5,
    public_id: "e-tomorrow",
    beach_public_id: BEACH_ROW.public_id,
    beach_name: "Praia do Mirante",
    coordinator_id: 7,
    title: "Tomorrow Party",
    description: null,
    category: "party",
    state: "published",
    start_at: "2026-06-16T15:00:00Z",
    end_at: "2026-06-16T17:00:00Z",
    is_paid_takeover: false,
    sponsor_name: null,
    created_at: "2026-06-01T09:00:00Z",
    updated_at: "2026-06-01T09:00:00Z",
  },
];

const BOOKING_ROW = {
  id: 99,
  starts_at: "2026-06-15T14:00:00Z",
  ends_at: "2026-06-15T16:00:00Z",
};

const BOOKING_ITEM_ROWS = [
  { amenity_type: "sunbed", quantity: 2 },
  { amenity_type: "umbrella", quantity: 1 },
];

/**
 * Fake DB emulating every query getDayPlan issues, for the seeded beach.
 * `withBooking` toggles whether the booking tables hold the user's row so
 * the anonymous-caller path can be exercised.
 */
function dayPlanDb(options: { withBooking?: boolean } = {}): DayPlanDb {
  const withBooking = options.withBooking ?? true;
  return {
    query: asQuery(async (sql) => {
      if (sql.includes("from beach where slug = $1")) {
        return { rows: [BEACH_ROW], rowCount: 1 };
      }
      if (sql.includes("from beach_condition")) {
        return { rows: [CONDITION_ROW], rowCount: 1 };
      }
      if (sql.includes("from beach_tide_reading")) {
        return { rows: TIDE_ROWS, rowCount: TIDE_ROWS.length };
      }
      // listBeachEvents selector: published only (no coordinator id passed).
      if (sql.includes("where b.public_id = $1")) {
        const rows = EVENT_ROWS.filter((row) => row.state === "published");
        return { rows, rowCount: rows.length };
      }
      // NOTE: checked before the plain booking branch — the booking-item
      // query contains "from booking_item" whose text includes "from booking".
      if (sql.includes("join amenity_inventory")) {
        if (!withBooking) return { rows: [], rowCount: 0 };
        return { rows: BOOKING_ITEM_ROWS, rowCount: BOOKING_ITEM_ROWS.length };
      }
      if (sql.includes("from booking")) {
        if (!withBooking) return { rows: [], rowCount: 0 };
        return { rows: [BOOKING_ROW], rowCount: 1 };
      }
      throw new Error(`fake_db_unexpected_query: ${sql}`);
    }),
  };
}

function emptyDayPlanDb(): DayPlanDb {
  return {
    query: asQuery(async (sql) => {
      if (sql.includes("from beach where slug = $1")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`fake_db_unexpected_query: ${sql}`);
    }),
  };
}

// ---------------------------------------------------------------------------
// getDayPlan (fake DB)
// ---------------------------------------------------------------------------

describe("getDayPlan (fake DB)", () => {
  it("composes DB rows into the same ordered plan as the pure builder", async () => {
    const plan = await getDayPlan(dayPlanDb(), BEACH_SLUG, {
      now: new Date(NOW),
      userId: 7,
    });
    expect(plan).not.toBeNull();
    expect(plan?.emptyReason).toBeNull();
    expect(
      plan?.items.map((item) => ({
        kind: item.kind,
        startTime: item.startTime,
        endTime: item.endTime,
      })),
    ).toEqual([...EXPECTED_ORDER]);
  });

  it("summarizes the booking from its line items", async () => {
    const plan = await getDayPlan(dayPlanDb(), BEACH_SLUG, {
      now: new Date(NOW),
      userId: 7,
    });
    const booking = plan?.items.find((item) => item.kind === "booking");
    expect(booking?.detail).toBe("2 sunbeds · 1 umbrella");
  });

  it("excludes draft events via the consumer visibility rules", async () => {
    const plan = await getDayPlan(dayPlanDb(), BEACH_SLUG, {
      now: new Date(NOW),
      userId: 7,
    });
    const titles = plan?.items
      .filter((item) => item.kind === "event")
      .map((item) => item.label);
    expect(titles).not.toContain("Secret Draft Gig");
    expect(titles).not.toContain("Morning Yoga");
    expect(titles).not.toContain("Tomorrow Party");
  });

  it("never queries bookings for an anonymous caller", async () => {
    const queries: string[] = [];
    const db: DayPlanDb = {
      query: asQuery(async (sql) => {
        queries.push(sql);
        if (sql.includes("from beach where slug = $1")) {
          return { rows: [BEACH_ROW], rowCount: 1 };
        }
        if (sql.includes("from beach_condition")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("from beach_tide_reading")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("where b.public_id = $1")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`fake_db_unexpected_query: ${sql}`);
      }),
    };
    const plan = await getDayPlan(db, BEACH_SLUG, {
      now: new Date(NOW),
      userId: null,
    });
    expect(queries.some((sql) => sql.includes("from booking"))).toBe(false);
    // No data anywhere: honest empty state.
    expect(plan?.items).toEqual([]);
    expect(plan?.emptyReason).toBe("no_data");
  });

  it("returns null only for an unknown beach", async () => {
    expect(await getDayPlan(emptyDayPlanDb(), "no-such-beach")).toBeNull();
  });

  it("uses the caller's injected clock, never the system clock", async () => {
    const plan = await getDayPlan(dayPlanDb(), BEACH_SLUG, {
      now: new Date("2026-06-15T22:00:00Z"), // 23:00 beach-local
      userId: 7,
    });
    expect(plan?.items).toEqual([]);
    expect(plan?.emptyReason).toBe("no_data");
  });
});

// ---------------------------------------------------------------------------
// HTTP handler (real express, fake DB)
// ---------------------------------------------------------------------------

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    if (server.listening) resolve();
    else {
      server.once("listening", () => resolve());
      server.once("error", reject);
    }
  });
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("no_listening_port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function dayPlanApp(db: DayPlanDb): express.Express {
  const app = express();
  app.get(
    "/api/beaches/:slug/day-plan",
    createDayPlanHandler(db, {
      now: () => new Date(NOW),
      resolveUserId: async () => 7,
    }),
  );
  return app;
}

describe("createDayPlanHandler (real HTTP)", () => {
  it("GET /api/beaches/:slug/day-plan returns 200 with the time-ordered plan", async () => {
    const base = await listen(dayPlanApp(dayPlanDb()));
    const response = await fetch(`${base}/api/beaches/${BEACH_SLUG}/day-plan`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: ReturnType<typeof buildDayPlan>;
    };
    expect(body.data.slug).toBe(BEACH_SLUG);
    expect(body.data.emptyReason).toBeNull();
    expect(body.data.items).toHaveLength(6);
    expect(
      body.data.items.map((item) => ({
        kind: item.kind,
        startTime: item.startTime,
      })),
    ).toEqual([
      { kind: "arrival", startTime: "13:00" },
      { kind: "tide", startTime: "14:00" },
      { kind: "booking", startTime: "15:00" },
      { kind: "event", startTime: "16:00" },
      { kind: "golden-hour", startTime: "19:30" },
      { kind: "event", startTime: "20:00" },
    ]);
  });

  it("returns 404 with the sibling error shape for an unknown beach", async () => {
    const base = await listen(dayPlanApp(emptyDayPlanDb()));
    const response = await fetch(`${base}/api/beaches/no-such-beach/day-plan`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("beach_not_found");
  });

  it("degrades to a plan without the booking when identity resolution fails", async () => {
    const app = express();
    app.get(
      "/api/beaches/:slug/day-plan",
      createDayPlanHandler(dayPlanDb(), {
        now: () => new Date(NOW),
        resolveUserId: async () => {
          throw new Error("auth_adapter_down");
        },
      }),
    );
    const base = await listen(app);
    const response = await fetch(`${base}/api/beaches/${BEACH_SLUG}/day-plan`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { items: Array<{ kind: string }> };
    };
    const kinds = body.data.items.map((item) => item.kind);
    expect(kinds).not.toContain("booking");
    // The rest of the plan still composes without the caller's identity.
    expect(kinds).toContain("arrival");
    expect(kinds).toContain("tide");
  });
});

// ---------------------------------------------------------------------------
// Mount-order trap (routes/beaches.ts)
// ---------------------------------------------------------------------------

/** Express exposes the registered layer stack; assert real mounting. */
function registeredPaths(router: express.Router): string[] {
  const stack = (
    router as unknown as {
      stack: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }>;
    }
  ).stack;
  return stack
    .filter((layer) => layer.route)
    .map((layer) => {
      const methods = Object.keys(layer.route!.methods)
        .filter((m) => layer.route!.methods[m])
        .map((m) => m.toUpperCase())
        .join(",");
      return `${methods} ${layer.route!.path}`;
    })
    .sort();
}

describe("day-plan route mounting in routes/beaches.ts", () => {
  it("registers GET /api/beaches/:slug/day-plan alongside the existing routes", () => {
    const paths = registeredPaths(beachesRouter);
    expect(paths).toContain("GET /api/beaches/:slug/day-plan");
    expect(paths).toContain("GET /api/beaches");
    expect(paths).toContain("GET /api/beaches/:slug");
    expect(paths).toContain("GET /api/beaches/:slug/crowd-forecast");
    expect(paths).toContain("GET /api/beaches/:slug/day-quality");
  });

  it("keeps the documented mount-order trap: community subpaths beat the :slug detail route", async () => {
    // Replicates server/index.ts: the community routers are mounted BEFORE
    // beachesRouter, and their deeper :id subpaths must win first-match over
    // anything beachesRouter registers. The stub stands in for
    // vibesRouter/pillarsRouter so no pool query runs in this test.
    const communityStub = express.Router();
    communityStub.get("/api/beaches/:id/vibes", (request, response) => {
      response.json({ marker: "vibes", id: request.params.id });
    });
    communityStub.get("/api/beaches/:id/pulse", (request, response) => {
      response.json({ marker: "pulse", id: request.params.id });
    });
    communityStub.get("/api/beaches/:id/sightings", (request, response) => {
      response.json({ marker: "sightings", id: request.params.id });
    });

    const app = express();
    app.use(communityStub);
    app.use(beachesRouter);
    const base = await listen(app);

    for (const [sub, marker] of [
      ["vibes", "vibes"],
      ["pulse", "pulse"],
      ["sightings", "sightings"],
    ] as const) {
      const response = await fetch(`${base}/api/beaches/${BEACH_SLUG}/${sub}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { marker: string; id: string };
      // The community stub wins registration order — the beachesRouter
      // detail route never shadows it.
      expect(body.marker).toBe(marker);
      expect(body.id).toBe(BEACH_SLUG);
    }
  });
});
