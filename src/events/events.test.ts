import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelEvent,
  createEvent,
  fetchBeachEvents,
  fetchCoordinatorEvents,
  publishEvent,
} from "./api";
import {
  consumerCalendarPartition,
  consumerVisibleEvents,
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  EVENT_STATES,
  EVENT_STATE_LABELS,
  formatEventRange,
  PAID_TAKEOVER_LABEL,
  partitionEvents,
  type BeachEvent,
} from "./types";

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

describe("label maps", () => {
  it("labels every event category", () => {
    for (const category of EVENT_CATEGORIES) {
      expect(EVENT_CATEGORY_LABELS[category].length).toBeGreaterThan(0);
    }
  });

  it("labels every event state", () => {
    for (const state of EVENT_STATES) {
      expect(EVENT_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });
});

describe("partitionEvents", () => {
  const happened = makeEvent({
    publicId: "aaaaaaaa-0000-4000-8000-000000000001",
    startsAt: "2026-06-14T10:00:00Z",
    endsAt: "2026-06-14T18:00:00Z",
  });
  const live = makeEvent({
    publicId: "aaaaaaaa-0000-4000-8000-000000000002",
    startsAt: "2026-06-15T10:00:00Z",
    endsAt: "2026-06-15T18:00:00Z",
  });
  const soonB = makeEvent({
    publicId: "aaaaaaaa-0000-4000-8000-000000000003",
    startsAt: "2026-06-20T10:00:00Z",
    endsAt: "2026-06-20T18:00:00Z",
  });
  const soonA = makeEvent({
    publicId: "aaaaaaaa-0000-4000-8000-000000000004",
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
  });

  it("never places a past event in the upcoming selector", () => {
    const partition = partitionEvents([happened], NOW);
    expect(partition.upcoming).toHaveLength(0);
    expect(partition.past).toHaveLength(1);
  });

  it("orders upcoming by start time ascending", () => {
    const partition = partitionEvents([soonB, soonA], NOW);
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

  it("is invariant to the paid-takeover flag", () => {
    const paid = makeEvent({
      publicId: "aaaaaaaa-0000-4000-8000-000000000007",
      startsAt: "2026-06-17T10:00:00Z",
      endsAt: "2026-06-17T18:00:00Z",
      paidTakeover: {
        isPaid: true,
        label: PAID_TAKEOVER_LABEL,
        sponsorName: "Sunblock Co",
      },
    });
    const original = partitionEvents([paid], NOW);
    const flipped = partitionEvents(
      [
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
      original.upcoming.map((event) => event.publicId),
    );
  });
});

describe("consumer visibility", () => {
  it("consumerVisibleEvents keeps published events only", () => {
    const events = [
      makeEvent({ publicId: "c1", state: "published" }),
      makeEvent({ publicId: "c2", state: "draft" }),
      makeEvent({ publicId: "c3", state: "cancelled" }),
    ];
    const visible = consumerVisibleEvents(events);
    expect(visible.map((event) => event.publicId)).toEqual(["c1"]);
  });

  it("consumerCalendarPartition excludes drafts and cancelled from every bucket", () => {
    const events = [
      makeEvent({
        publicId: "c1",
        startsAt: "2026-06-14T10:00:00Z",
        endsAt: "2026-06-14T18:00:00Z",
      }),
      makeEvent({ publicId: "c2", state: "draft" }),
      makeEvent({
        publicId: "c3",
        state: "cancelled",
        startsAt: "2026-06-20T10:00:00Z",
        endsAt: "2026-06-20T18:00:00Z",
      }),
    ];
    const partition = consumerCalendarPartition(events, NOW);
    expect(partition.past.map((event) => event.publicId)).toEqual(["c1"]);
    expect(partition.happeningNow).toHaveLength(0);
    expect(partition.upcoming).toHaveLength(0);
  });
});

describe("formatEventRange", () => {
  it("renders a same-day window with a single date and an en-dash time range", () => {
    const label = formatEventRange(
      "2026-06-15T10:00:00Z",
      "2026-06-15T18:00:00Z",
    );
    expect(label).toContain("–");
    expect(label).not.toContain("→");
    // Structural: one weekday token like "Mon" and one day/month pair.
    expect(label).toMatch(/[A-Z][a-z]{2}/);
    expect(label).toMatch(/\d{1,2}/);
  });

  it("renders a cross-day window with both dates", () => {
    const label = formatEventRange(
      "2026-06-15T22:00:00Z",
      "2026-06-16T04:00:00Z",
    );
    // Cross-day always contains two distinct day numbers separated by a dash.
    expect(label).toMatch(/(\d{1,2}).*–.*(\d{1,2})/);
  });
});

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(body: unknown, ok = true, status = 200) {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        ({ ok, status, json: async () => body }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("fetchBeachEvents requests the beach events endpoint", async () => {
    const fetchMock = stubFetch([makeEvent()]);
    const events = await fetchBeachEvents(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(events).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/events/beaches/22222222-2222-4222-8222-222222222222",
    );
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
    });
  });

  it("fetchCoordinatorEvents requests the coordinator endpoint", async () => {
    const fetchMock = stubFetch([]);
    await fetchCoordinatorEvents();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/events/mine");
  });

  it("createEvent posts the input payload", async () => {
    const fetchMock = stubFetch(makeEvent());
    await createEvent({
      beachPublicId: "22222222-2222-4222-8222-222222222222",
      title: "Sunset party",
      category: "party",
      startsAt: "2026-06-15T10:00:00Z",
      endsAt: "2026-06-15T18:00:00Z",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/events$/);
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("Sunset party");
  });

  it("publishEvent and cancelEvent hit their state endpoints", async () => {
    const publishFetch = stubFetch(makeEvent({ state: "published" }));
    await publishEvent("11111111-1111-4111-8111-111111111111");
    expect(String(publishFetch.mock.calls[0]?.[0])).toContain(
      "/events/11111111-1111-4111-8111-111111111111/publish",
    );
    const cancelFetch = stubFetch(makeEvent({ state: "cancelled" }));
    await cancelEvent("11111111-1111-4111-8111-111111111111");
    expect(String(cancelFetch.mock.calls[0]?.[0])).toContain(
      "/events/11111111-1111-4111-8111-111111111111/cancel",
    );
  });

  it("propagates the server error message", async () => {
    stubFetch({ error: "event_forbidden" }, false, 403);
    await expect(
      publishEvent("11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow("event_forbidden");
  });
});
