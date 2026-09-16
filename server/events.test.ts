import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import {
  assertEventOwner,
  cancelEvent,
  consumerVisibleEvents,
  createEvent,
  createEventsRouter,
  EVENT_CATEGORIES,
  eventInputSchema,
  listBeachEvents,
  listLiveEventsAt,
  listUpcomingEvents,
  PAID_TAKEOVER_LABEL,
  partitionEvents,
  publishEvent,
  type BeachEvent,
  type EventsDb,
} from "./events";

const NOW = new Date("2026-06-15T12:00:00Z");

function makeEvent(overrides: Partial<BeachEvent> = {}): BeachEvent {
  return {
    id: 1,
    publicId: "11111111-1111-4111-8111-111111111111",
    beachPublicId: "22222222-2222-4222-8222-222222222222",
    beachName: "Praia Test",
    coordinatorId: 7,
    title: "Sunset party",
    description: null,
    category: "party",
    state: "published",
    startsAt: "2026-06-15T10:00:00Z",
    endsAt: "2026-06-15T18:00:00Z",
    paidTakeover: {
      isPaid: false,
      label: PAID_TAKEOVER_LABEL,
      sponsorName: null,
    },
    createdAt: "2026-06-01T09:00:00Z",
    updatedAt: "2026-06-01T09:00:00Z",
    ...overrides,
  };
}

/**
 * pg's query is a heavily overloaded generic, so a hand-rolled stub is not
 * directly assignable. Route the cast through unknown once, here, instead of
 * at every call site.
 */
function asQuery(
  fn: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>,
): EventsDb["query"] {
  return fn as unknown as EventsDb["query"];
}

describe("eventInputSchema", () => {
  const valid = {
    beachPublicId: "22222222-2222-4222-8222-222222222222",
    title: "Sunset party",
    category: "party",
    startsAt: "2026-06-15T10:00:00Z",
    endsAt: "2026-06-15T18:00:00Z",
  };

  it("accepts a well-formed event", () => {
    expect(eventInputSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts every category in the enum", () => {
    for (const category of EVENT_CATEGORIES) {
      expect(eventInputSchema.safeParse({ ...valid, category }).success).toBe(
        true,
      );
    }
  });

  it("rejects an event whose end is before its start", () => {
    expect(
      eventInputSchema.safeParse({ ...valid, endsAt: "2026-06-15T09:59:59Z" })
        .success,
    ).toBe(false);
  });

  it("rejects an event whose end equals its start", () => {
    expect(
      eventInputSchema.safeParse({ ...valid, endsAt: valid.startsAt }).success,
    ).toBe(false);
  });

  it("rejects a missing beach id", () => {
    const { beachPublicId: _omitted, ...withoutBeach } = valid;
    expect(eventInputSchema.safeParse(withoutBeach).success).toBe(false);
  });

  it("rejects a non-uuid beach id", () => {
    expect(
      eventInputSchema.safeParse({ ...valid, beachPublicId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing category", () => {
    const { category: _omitted, ...withoutCategory } = valid;
    expect(eventInputSchema.safeParse(withoutCategory).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(
      eventInputSchema.safeParse({ ...valid, category: "free-skydiving" })
        .success,
    ).toBe(false);
  });

  it("rejects an empty title", () => {
    expect(eventInputSchema.safeParse({ ...valid, title: "   " }).success).toBe(
      false,
    );
  });
});

describe("partitionEvents", () => {
  const happened = makeEvent({
    publicId: "aaaaaaaa-0000-4000-8000-000000000001",
    title: "Past event",
    startsAt: "2026-06-14T10:00:00Z",
    endsAt: "2026-06-14T18:00:00Z",
  });
  const live = makeEvent({
    publicId: "aaaaaaaa-0000-4000-8000-000000000002",
    title: "Live event",
    startsAt: "2026-06-15T10:00:00Z",
    endsAt: "2026-06-15T18:00:00Z",
  });
  const soonB = makeEvent({
    publicId: "aaaaaaaa-0000-4000-8000-000000000003",
    title: "Soon B",
    startsAt: "2026-06-20T10:00:00Z",
    endsAt: "2026-06-20T18:00:00Z",
  });
  const soonA = makeEvent({
    publicId: "aaaaaaaa-0000-4000-8000-000000000004",
    title: "Soon A",
    startsAt: "2026-06-17T10:00:00Z",
    endsAt: "2026-06-17T18:00:00Z",
  });

  it("partitions events exactly into happening-now, upcoming and past", () => {
    const partition = partitionEvents([live, soonB, happened, soonA], NOW);
    expect(partition.happeningNow.map((event) => event.publicId)).toEqual([
      live.publicId,
    ]);
    expect(partition.upcoming.map((event) => event.publicId)).toEqual([
      soonA.publicId,
      soonB.publicId,
    ]);
    expect(partition.past.map((event) => event.publicId)).toEqual([
      happened.publicId,
    ]);
    const all = [
      ...partition.happeningNow,
      ...partition.upcoming,
      ...partition.past,
    ];
    expect(all).toHaveLength(4);
  });

  it("never places a past event in the upcoming selector", () => {
    const partition = partitionEvents([happened], NOW);
    expect(partition.upcoming).toHaveLength(0);
    expect(partition.happeningNow).toHaveLength(0);
    expect(partition.past).toHaveLength(1);
  });

  it("orders upcoming by start time ascending regardless of input order", () => {
    const partition = partitionEvents([soonB, soonA, live, happened], NOW);
    const starts = partition.upcoming.map((event) =>
      new Date(event.startsAt).getTime(),
    );
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("treats end == now as past and start == now as happening-now", () => {
    const endedNow = makeEvent({
      publicId: "aaaaaaaa-0000-4000-8000-000000000005",
      startsAt: "2026-06-15T08:00:00Z",
      endsAt: "2026-06-15T12:00:00Z",
    });
    const startingNow = makeEvent({
      publicId: "aaaaaaaa-0000-4000-8000-000000000006",
      startsAt: "2026-06-15T12:00:00Z",
      endsAt: "2026-06-15T20:00:00Z",
    });
    const partition = partitionEvents([endedNow, startingNow], NOW);
    expect(partition.past.map((event) => event.publicId)).toContain(
      endedNow.publicId,
    );
    expect(partition.happeningNow.map((event) => event.publicId)).toContain(
      startingNow.publicId,
    );
  });

  it("is invariant to the paid-takeover flag (paid placement never moves rank)", () => {
    const free = makeEvent({
      publicId: "aaaaaaaa-0000-4000-8000-000000000007",
      startsAt: "2026-06-17T10:00:00Z",
      endsAt: "2026-06-17T18:00:00Z",
    });
    const paid = makeEvent({
      publicId: "aaaaaaaa-0000-4000-8000-000000000008",
      startsAt: "2026-06-20T10:00:00Z",
      endsAt: "2026-06-20T18:00:00Z",
      paidTakeover: {
        isPaid: true,
        label: PAID_TAKEOVER_LABEL,
        sponsorName: "Sunblock Co",
      },
    });
    const buckets = partitionEvents([free, paid], NOW);
    // Flipping the paid flag on the paid event must not change its bucket.
    const flipped = partitionEvents(
      [
        free,
        {
          ...paid,
          paidTakeover: {
            isPaid: false,
            label: PAID_TAKEOVER_LABEL,
            sponsorName: null,
          },
        },
      ],
      NOW,
    );
    expect(flipped.upcoming.map((event) => event.publicId)).toEqual(
      buckets.upcoming.map((event) => event.publicId),
    );
  });
});

describe("consumerVisibleEvents", () => {
  it("keeps published events only", () => {
    const events = [
      makeEvent({ publicId: "b1", state: "published" }),
      makeEvent({ publicId: "b2", state: "draft" }),
      makeEvent({ publicId: "b3", state: "cancelled" }),
    ];
    const visible = consumerVisibleEvents(events);
    expect(visible).toHaveLength(1);
    expect(visible[0].state).toBe("published");
  });
});

describe("assertEventOwner", () => {
  const event = makeEvent({ coordinatorId: 7 });

  it("lets the owning coordinator through", () => {
    expect(() => assertEventOwner(event, 7)).not.toThrow();
  });

  it("throws event_forbidden for a wrong owner", () => {
    expect(() => assertEventOwner(event, 99)).toThrow("event_forbidden");
  });
});

const dbEventRow = {
  id: 1,
  public_id: "11111111-1111-4111-8111-111111111111",
  beach_public_id: "22222222-2222-4222-8222-222222222222",
  beach_name: "Praia Test",
  coordinator_id: 7,
  title: "Sunset party",
  description: null,
  category: "party",
  state: "draft",
  start_at: "2026-06-15T10:00:00Z",
  end_at: "2026-06-15T18:00:00Z",
  is_paid_takeover: false,
  sponsor_name: null,
  created_at: "2026-06-01T09:00:00Z",
  updated_at: "2026-06-01T09:00:00Z",
};

describe("publishEvent / cancelEvent ownership gating (fake DB)", () => {
  it("refuses to publish when the caller is not the coordinator", async () => {
    const db: EventsDb = {
      query: asQuery(async () => ({ rows: [dbEventRow], rowCount: 1 })),
    };
    await expect(publishEvent(db, dbEventRow.public_id, 99)).rejects.toThrow(
      "event_forbidden",
    );
  });

  it("refuses to cancel when the caller is not the coordinator", async () => {
    const db: EventsDb = {
      query: asQuery(async () => ({ rows: [dbEventRow], rowCount: 1 })),
    };
    await expect(cancelEvent(db, dbEventRow.public_id, 99)).rejects.toThrow(
      "event_forbidden",
    );
  });

  it("throws event_not_found for an unknown event", async () => {
    const db: EventsDb = {
      query: asQuery(async () => ({ rows: [], rowCount: 0 })),
    };
    await expect(
      publishEvent(db, "00000000-0000-4000-8000-000000000000", 7),
    ).rejects.toThrow("event_not_found");
  });

  it("lets the owner publish a draft and persists the new state", async () => {
    let savedState: unknown = null;
    const db: EventsDb = {
      query: asQuery(async (sql, params) => {
        if (sql.includes("update beach_event set state")) {
          savedState = params?.[0];
          return { rows: [], rowCount: 1 };
        }
        return {
          rows: [
            savedState ? { ...dbEventRow, state: savedState } : dbEventRow,
          ],
          rowCount: 1,
        };
      }),
    };
    const published = await publishEvent(db, dbEventRow.public_id, 7);
    expect(savedState).toBe("published");
    expect(published.state).toBe("published");
  });

  it("refuses to republish a cancelled event", async () => {
    const db: EventsDb = {
      query: asQuery(async () => ({
        rows: [{ ...dbEventRow, state: "cancelled" }],
        rowCount: 1,
      })),
    };
    await expect(publishEvent(db, dbEventRow.public_id, 7)).rejects.toThrow(
      "event_cancelled",
    );
  });
});

describe("listBeachEvents (fake DB)", () => {
  it("exposes published events to everyone and drafts only to the owner", async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const db: EventsDb = {
      query: asQuery(async (sql, params) => {
        calls.push([sql, params]);
        return { rows: [dbEventRow], rowCount: 1 };
      }),
    };
    await listBeachEvents(db, "22222222-2222-4222-8222-222222222222");
    await listBeachEvents(db, "22222222-2222-4222-8222-222222222222", {
      coordinatorId: 7,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toEqual(["22222222-2222-4222-8222-222222222222", null]);
    expect(calls[1][1]).toEqual(["22222222-2222-4222-8222-222222222222", 7]);
  });
});

describe("createEvent (fake DB)", () => {
  it("inserts a draft owned by the caller and returns the stored row", async () => {
    const inserts: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const db: EventsDb = {
      query: asQuery(async (sql, params) => {
        if (sql.includes("insert into beach_event")) {
          inserts.push({ sql, params });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("select id from beach")) {
          return { rows: [{ id: 42 }], rowCount: 1 };
        }
        if (sql.includes("where e.public_id = $1")) {
          return { rows: [{ ...dbEventRow, id: 42 }], rowCount: 1 };
        }
        throw new Error("fake_db_unexpected_query");
      }),
    };
    const created = await createEvent(
      db,
      {
        beachPublicId: "22222222-2222-4222-8222-222222222222",
        title: "Sunset party",
        category: "party",
        startsAt: "2026-06-15T10:00:00Z",
        endsAt: "2026-06-15T18:00:00Z",
      },
      7,
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain("'draft'");
    expect(inserts[0].params).toContain(7);
    expect(created.id).toBe(42);
    expect(created.state).toBe("draft");
  });

  it("rejects an unknown beach", async () => {
    const db: EventsDb = {
      query: asQuery(async () => ({ rows: [], rowCount: 0 })),
    };
    await expect(
      createEvent(
        db,
        {
          beachPublicId: "22222222-2222-4222-8222-222222222222",
          title: "Sunset party",
          category: "party",
          startsAt: "2026-06-15T10:00:00Z",
          endsAt: "2026-06-15T18:00:00Z",
        },
        7,
      ),
    ).rejects.toThrow("beach_not_found");
  });

  it("persists the paid-takeover label fields on insert", async () => {
    const inserts: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const db: EventsDb = {
      query: asQuery(async (sql, params) => {
        if (sql.includes("insert into beach_event")) {
          inserts.push({ sql, params });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("select id from beach")) {
          return { rows: [{ id: 42 }], rowCount: 1 };
        }
        if (sql.includes("where e.public_id = $1")) {
          return {
            rows: [
              {
                ...dbEventRow,
                id: 42,
                is_paid_takeover: true,
                sponsor_name: "Sunblock Co",
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error("fake_db_unexpected_query");
      }),
    };
    const created = await createEvent(
      db,
      {
        beachPublicId: "22222222-2222-4222-8222-222222222222",
        title: "Sponsored takeover",
        category: "takeover",
        startsAt: "2026-06-15T10:00:00Z",
        endsAt: "2026-06-15T18:00:00Z",
        isPaidTakeover: true,
        sponsorName: "Sunblock Co",
      },
      7,
    );
    expect(created.paidTakeover.isPaid).toBe(true);
    expect(created.paidTakeover.label).toBe(PAID_TAKEOVER_LABEL);
    expect(created.paidTakeover.sponsorName).toBe("Sunblock Co");
  });
});

const LIVE_BEACH = "22222222-2222-4222-8222-222222222222";
const OTHER_BEACH = "33333333-3333-4333-8333-333333333333";

function eventRow(
  publicId: string,
  overrides: Partial<typeof dbEventRow> = {},
): typeof dbEventRow {
  return { ...dbEventRow, public_id: publicId, ...overrides };
}

/**
 * Window fixtures shared by the live/upcoming selector tests and the router
 * HTTP tests. All rows target LIVE_BEACH except the explicit other-beach row.
 */
const liveWindowRows = [
  eventRow("aaaaaaaa-0000-4000-8000-000000000101", {
    state: "published",
    title: "Live party",
    start_at: "2026-06-15T10:00:00Z",
    end_at: "2026-06-15T18:00:00Z",
  }),
  eventRow("aaaaaaaa-0000-4000-8000-000000000102", {
    state: "published",
    title: "Starts exactly at noon",
    start_at: "2026-06-15T12:00:00Z",
    end_at: "2026-06-15T20:00:00Z",
  }),
  eventRow("aaaaaaaa-0000-4000-8000-000000000103", {
    state: "published",
    title: "Ends exactly at noon",
    start_at: "2026-06-15T08:00:00Z",
    end_at: "2026-06-15T12:00:00Z",
  }),
  eventRow("aaaaaaaa-0000-4000-8000-000000000104", {
    state: "published",
    title: "Soon A",
    start_at: "2026-06-17T10:00:00Z",
    end_at: "2026-06-17T18:00:00Z",
  }),
  eventRow("aaaaaaaa-0000-4000-8000-000000000105", {
    state: "published",
    title: "Soon B",
    start_at: "2026-06-20T10:00:00Z",
    end_at: "2026-06-20T18:00:00Z",
  }),
  eventRow("aaaaaaaa-0000-4000-8000-000000000106", {
    state: "published",
    title: "Soon C",
    start_at: "2026-06-22T10:00:00Z",
    end_at: "2026-06-22T18:00:00Z",
  }),
  eventRow("aaaaaaaa-0000-4000-8000-000000000107", {
    state: "published",
    title: "Past day",
    start_at: "2026-06-14T10:00:00Z",
    end_at: "2026-06-14T18:00:00Z",
  }),
  eventRow("aaaaaaaa-0000-4000-8000-000000000108", {
    state: "draft",
    title: "Draft in live window",
    start_at: "2026-06-15T10:00:00Z",
    end_at: "2026-06-15T18:00:00Z",
  }),
  eventRow("aaaaaaaa-0000-4000-8000-000000000109", {
    state: "cancelled",
    title: "Cancelled in live window",
    start_at: "2026-06-15T10:00:00Z",
    end_at: "2026-06-15T18:00:00Z",
  }),
  eventRow("aaaaaaaa-0000-4000-8000-000000000110", {
    state: "published",
    beach_public_id: OTHER_BEACH,
    title: "Other beach live",
    start_at: "2026-06-15T10:00:00Z",
    end_at: "2026-06-15T18:00:00Z",
  }),
];

/**
 * Fake DB emulating the listBeachEvents selector: returns rows for the
 * requested beach public id — published ones for consumers, plus the
 * caller's own drafts/cancellations when a coordinator id is supplied.
 */
function scopedEventsDb(rows: Array<typeof dbEventRow>): EventsDb {
  return {
    query: asQuery(async (sql, params) => {
      if (sql.includes("where b.public_id = $1")) {
        const beachId = params?.[0];
        const coordinatorId = (params?.[1] as number | null) ?? null;
        const visible = rows.filter(
          (row) =>
            row.beach_public_id === beachId &&
            (row.state === "published" ||
              (coordinatorId !== null && row.coordinator_id === coordinatorId)),
        );
        return { rows: visible, rowCount: visible.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe("listLiveEventsAt (fake DB)", () => {
  const db = scopedEventsDb(liveWindowRows);

  it("returns only published events whose half-open window covers the instant", async () => {
    const live = await listLiveEventsAt(db, LIVE_BEACH, NOW);
    expect(live.map((event) => event.title)).toEqual([
      "Live party",
      "Starts exactly at noon",
    ]);
  });

  it("treats end == now as over (end boundary is exclusive)", async () => {
    const live = await listLiveEventsAt(db, LIVE_BEACH, NOW);
    expect(live.map((event) => event.title)).not.toContain(
      "Ends exactly at noon",
    );
  });

  it("treats start == now as live (start boundary is inclusive)", async () => {
    const live = await listLiveEventsAt(db, LIVE_BEACH, NOW);
    expect(live.map((event) => event.title)).toContain(
      "Starts exactly at noon",
    );
  });

  it("excludes past and future events", async () => {
    const live = await listLiveEventsAt(db, LIVE_BEACH, NOW);
    const titles = live.map((event) => event.title);
    expect(titles).not.toContain("Past day");
    expect(titles).not.toContain("Soon A");
  });

  it("excludes draft and cancelled events even when their window covers now", async () => {
    const live = await listLiveEventsAt(db, LIVE_BEACH, NOW);
    const titles = live.map((event) => event.title);
    expect(titles).not.toContain("Draft in live window");
    expect(titles).not.toContain("Cancelled in live window");
  });

  it("never returns events scoped to another beach", async () => {
    const live = await listLiveEventsAt(db, LIVE_BEACH, NOW);
    expect(live.map((event) => event.title)).not.toContain("Other beach live");
    expect(live.every((event) => event.beachPublicId === LIVE_BEACH)).toBe(
      true,
    );
  });

  it("resolves offset-authored instants by absolute time (13:00+02:00 == 11:00Z)", async () => {
    const offset = await listLiveEventsAt(
      db,
      LIVE_BEACH,
      new Date("2026-06-15T13:00:00+02:00"),
    );
    const utc = await listLiveEventsAt(
      db,
      LIVE_BEACH,
      new Date("2026-06-15T11:00:00Z"),
    );
    // At 11:00Z both "Ends exactly at noon" (08:00–12:00Z) and "Live party"
    // (10:00–18:00Z) are live, ordered by start ascending.
    expect(offset.map((event) => event.title)).toEqual([
      "Ends exactly at noon",
      "Live party",
    ]);
    // An implementation that dropped the offset would parse to 13:00Z and
    // diverge from the UTC spelling of the same instant.
    expect(offset.map((event) => event.publicId)).toEqual(
      utc.map((event) => event.publicId),
    );
  });
});

describe("listUpcomingEvents (fake DB)", () => {
  const db = scopedEventsDb(liveWindowRows);

  it("returns strictly future published events, soonest first", async () => {
    const upcoming = await listUpcomingEvents(db, LIVE_BEACH, NOW);
    expect(upcoming.map((event) => event.title)).toEqual([
      "Soon A",
      "Soon B",
      "Soon C",
    ]);
  });

  it("excludes live, past, draft and cancelled events", async () => {
    const upcoming = await listUpcomingEvents(db, LIVE_BEACH, NOW);
    const titles = upcoming.map((event) => event.title);
    expect(titles).not.toContain("Live party");
    expect(titles).not.toContain("Past day");
    expect(titles).not.toContain("Draft in live window");
  });

  it("caps the result at the supplied limit", async () => {
    const upcoming = await listUpcomingEvents(db, LIVE_BEACH, NOW, 2);
    expect(upcoming.map((event) => event.title)).toEqual(["Soon A", "Soon B"]);
  });
});

describe("createEventsRouter (real HTTP)", () => {
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

  async function listen(db: EventsDb): Promise<string> {
    const app = express();
    app.use("/api/events", createEventsRouter(db));
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

  const db = scopedEventsDb(liveWindowRows);

  it("GET /now returns only window-covering published events as a raw array", async () => {
    const base = await listen(db);
    const response = await fetch(
      `${base}/api/events/now?beachId=${LIVE_BEACH}&at=${encodeURIComponent("2026-06-15T12:00:00Z")}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as BeachEvent[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((event) => event.title)).toEqual([
      "Live party",
      "Starts exactly at noon",
    ]);
    expect(body[0].startsAt).toBe("2026-06-15T10:00:00.000Z");
  });

  it("excludes events that ended exactly at the instant (half-open window)", async () => {
    const base = await listen(db);
    const response = await fetch(
      `${base}/api/events/now?beachId=${LIVE_BEACH}&at=${encodeURIComponent("2026-06-15T12:00:00Z")}`,
    );
    const body = (await response.json()) as BeachEvent[];
    expect(body.map((event) => event.title)).not.toContain(
      "Ends exactly at noon",
    );
  });

  it("timezone boundary: an offset instant equals its UTC equivalent", async () => {
    const base = await listen(db);
    // 09:00-03:00 == 12:00Z — same instant, different zone spelling.
    const offsetResponse = await fetch(
      `${base}/api/events/now?beachId=${LIVE_BEACH}&at=${encodeURIComponent("2026-06-15T09:00:00-03:00")}`,
    );
    const utcResponse = await fetch(
      `${base}/api/events/now?beachId=${LIVE_BEACH}&at=${encodeURIComponent("2026-06-15T12:00:00Z")}`,
    );
    const offsetBody = (await offsetResponse.json()) as BeachEvent[];
    const utcBody = (await utcResponse.json()) as BeachEvent[];
    expect(offsetBody.map((event) => event.publicId)).toEqual(
      utcBody.map((event) => event.publicId),
    );
  });

  it("timezone boundary: an instant just before UTC midnight excludes next-day windows", async () => {
    const base = await listen(db);
    // 23:59:59Z on the 14th: Live party (15th 10:00Z) must be excluded.
    const response = await fetch(
      `${base}/api/events/now?beachId=${LIVE_BEACH}&at=${encodeURIComponent("2026-06-14T23:59:59Z")}`,
    );
    const body = (await response.json()) as BeachEvent[];
    expect(body).toHaveLength(0);
  });

  it("rejects a naive instant without a timezone designator", async () => {
    const base = await listen(db);
    const response = await fetch(
      `${base}/api/events/now?beachId=${LIVE_BEACH}&at=${encodeURIComponent("2026-06-15T12:00:00")}`,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("rejects a missing or malformed beachId", async () => {
    const base = await listen(db);
    const missing = await fetch(`${base}/api/events/now`);
    expect(missing.status).toBe(400);
    const malformed = await fetch(`${base}/api/events/now?beachId=not-a-uuid`);
    expect(malformed.status).toBe(400);
  });

  it("GET /beaches/:id/upcoming returns soonest-first future events and honors limit", async () => {
    const base = await listen(db);
    const response = await fetch(
      `${base}/api/events/beaches/${LIVE_BEACH}/upcoming?from=${encodeURIComponent("2026-06-15T12:00:00Z")}&limit=2`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as BeachEvent[];
    expect(body.map((event) => event.title)).toEqual(["Soon A", "Soon B"]);
  });

  it("rejects an out-of-range upcoming limit", async () => {
    const base = await listen(db);
    const response = await fetch(
      `${base}/api/events/beaches/${LIVE_BEACH}/upcoming?limit=51`,
    );
    expect(response.status).toBe(400);
  });
});
