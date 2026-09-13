import { describe, expect, it } from "vitest";
import {
  assertEventOwner,
  cancelEvent,
  consumerVisibleEvents,
  createEvent,
  EVENT_CATEGORIES,
  eventInputSchema,
  listBeachEvents,
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
