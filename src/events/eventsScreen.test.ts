import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventsScreenView } from "./EventsScreen";
import { fetchAllBeachEvents } from "./api";
import {
  eventWindowRange,
  filterScreenEvents,
  groupEventsByBeach,
  groupEventsByDay,
  type BeachEvent,
} from "./types";

const NOW = new Date("2026-06-15T12:00:00Z"); // Monday

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
    paidTakeover: { isPaid: false, label: "Paid takeover", sponsorName: null },
    createdAt: "2026-06-01T09:00:00Z",
    updatedAt: "2026-06-01T09:00:00Z",
    ...overrides,
  };
}

function view(overrides: Record<string, unknown> = {}): string {
  const props = {
    events: [] as BeachEvent[],
    dateWindow: "anytime" as const,
    audience: null,
    onDateWindowChange: () => undefined,
    onAudienceChange: () => undefined,
    onOpenBeach: () => undefined,
    now: NOW,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(EventsScreenView, props));
}

describe("eventWindowRange", () => {
  it("today spans local midnight to midnight", () => {
    const range = eventWindowRange("today", NOW);
    expect(range.start.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(range.end).not.toBeNull();
    expect(range.end!.getTime() - range.start.getTime()).toBe(86_400_000);
  });

  it("weekend covers Saturday and Sunday of the current weekend", () => {
    const range = eventWindowRange("weekend", NOW);
    expect(range.start.getDay()).toBe(6);
    expect(range.end!.getDay()).toBe(1); // Monday midnight, exclusive end
    expect(range.end!.getTime() - range.start.getTime()).toBe(2 * 86_400_000);
  });

  it("anytime is open-ended", () => {
    const range = eventWindowRange("anytime", NOW);
    expect(range.end).toBeNull();
  });
});

describe("filterScreenEvents", () => {
  const live = makeEvent({
    publicId: "f1",
    startsAt: "2026-06-15T10:00:00Z",
    endsAt: "2026-06-15T18:00:00Z",
  });
  const nextWeek = makeEvent({
    publicId: "f2",
    title: "Next week party",
    startsAt: "2026-06-22T10:00:00Z",
    endsAt: "2026-06-22T18:00:00Z",
  });
  const ended = makeEvent({
    publicId: "f3",
    startsAt: "2026-06-14T10:00:00Z",
    endsAt: "2026-06-14T18:00:00Z",
  });
  const draft = makeEvent({
    publicId: "f4",
    state: "draft",
    startsAt: "2026-06-15T13:00:00Z",
    endsAt: "2026-06-15T15:00:00Z",
  });

  it("keeps published not-yet-ended events and drops drafts", () => {
    const filtered = filterScreenEvents(
      [live, ended, draft],
      { window: "anytime", audience: null },
      NOW,
    );
    expect(filtered.map((event) => event.publicId)).toEqual(["f1"]);
  });

  it("today window excludes events beyond midnight", () => {
    const filtered = filterScreenEvents(
      [live, nextWeek],
      { window: "today", audience: null },
      NOW,
    );
    expect(filtered.map((event) => event.publicId)).toEqual(["f1"]);
    const anytime = filterScreenEvents(
      [live, nextWeek],
      { window: "anytime", audience: null },
      NOW,
    );
    expect(anytime.map((event) => event.publicId)).toEqual(["f1", "f2"]);
  });

  it("audience filter maps from category and null keeps everything", () => {
    const soccer = makeEvent({
      publicId: "f5",
      category: "beach-soccer",
      startsAt: "2026-06-16T10:00:00Z",
      endsAt: "2026-06-16T12:00:00Z",
    });
    const family = filterScreenEvents(
      [live, soccer],
      { window: "anytime", audience: "family" },
      NOW,
    );
    expect(family.map((event) => event.publicId)).toEqual(["f5"]);
    const anyone = filterScreenEvents(
      [live, soccer],
      { window: "anytime", audience: null },
      NOW,
    );
    expect(anyone).toHaveLength(2);
  });

  it("never hides an event because of the paid-takeover flag", () => {
    const paid = makeEvent({
      publicId: "f6",
      paidTakeover: { isPaid: true, label: "Paid takeover", sponsorName: "X" },
      startsAt: "2026-06-16T10:00:00Z",
      endsAt: "2026-06-16T18:00:00Z",
    });
    expect(
      filterScreenEvents([paid], { window: "anytime", audience: null }, NOW),
    ).toHaveLength(1);
  });
});

describe("groupEventsByDay", () => {
  it("hoists live events into the Today group which sorts first", () => {
    const live = makeEvent({ publicId: "g1" });
    const tomorrow = makeEvent({
      publicId: "g2",
      startsAt: "2026-06-16T10:00:00Z",
      endsAt: "2026-06-16T18:00:00Z",
    });
    const groups = groupEventsByDay([tomorrow, live], NOW);
    expect(groups.map((group) => group.label)).toEqual(["Today", "Tomorrow"]);
    expect(groups[0].isToday).toBe(true);
    expect(groups[0].events.map((event) => event.publicId)).toEqual(["g1"]);
  });

  it("labels later days with a weekday + date", () => {
    const later = makeEvent({
      publicId: "g3",
      startsAt: "2026-06-18T10:00:00Z",
      endsAt: "2026-06-18T18:00:00Z",
    });
    const [group] = groupEventsByDay([later], NOW);
    expect(group.label.length).toBeGreaterThan(0);
    expect(group.isToday).toBe(false);
  });
});

describe("groupEventsByBeach", () => {
  it("groups per beach preserving first-seen order", () => {
    const a1 = makeEvent({
      publicId: "h1",
      beachPublicId: "beach-a",
      beachName: "Beach A",
    });
    const b1 = makeEvent({
      publicId: "h2",
      beachPublicId: "beach-b",
      beachName: "Beach B",
    });
    const a2 = makeEvent({
      publicId: "h3",
      beachPublicId: "beach-a",
      beachName: "Beach A",
    });
    const groups = groupEventsByBeach([a1, b1, a2]);
    expect(groups.map((group) => group.beachPublicId)).toEqual([
      "beach-a",
      "beach-b",
    ]);
    expect(groups[0].events).toHaveLength(2);
  });
});

describe("fetchAllBeachEvents", () => {
  it("merges feeds, dedupes by publicId and isolates failures", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("beach-a")) {
        calls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => [makeEvent({ publicId: "e1" })],
        } as unknown as Response;
      }
      if (url.includes("beach-b")) {
        calls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => [
            makeEvent({ publicId: "e1" }),
            makeEvent({ publicId: "e2", title: "Other" }),
          ],
        } as unknown as Response;
      }
      calls.push(url);
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    try {
      const result = await fetchAllBeachEvents([
        "beach-a",
        "beach-b",
        "beach-c",
      ]);
      expect(result.events.map((event) => event.publicId).sort()).toEqual([
        "e1",
        "e2",
      ]);
      expect(result.failedBeachIds).toEqual(["beach-c"]);
      expect(calls).toHaveLength(3);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns empty for an empty catalog", async () => {
    const result = await fetchAllBeachEvents([]);
    expect(result.events).toEqual([]);
    expect(result.failedBeachIds).toEqual([]);
  });
});

describe("EventsScreenView", () => {
  const live = makeEvent({ publicId: "v1", title: "Sunset party" });
  const later = makeEvent({
    publicId: "v2",
    title: "Later surf comp",
    category: "surf-competition",
    startsAt: "2026-06-17T10:00:00Z",
    endsAt: "2026-06-17T18:00:00Z",
  });

  it("renders EventNowBanner and per-beach EventsCalendar for live events", () => {
    const markup = view({ events: [live, later] });
    expect(markup).toContain('aria-label="Live events"');
    expect(markup).toContain("Sunset party");
    // EventsCalendar renders the "What's happening · <beach>" heading.
    expect(markup).toContain("What&#x27;s happening · Praia Test");
    // Day groups: Today first, then the later day as cards.
    expect(markup).toContain("Today");
    expect(markup).toContain("Later surf comp");
  });

  it("renders non-today events as beach-linking cards", () => {
    const markup = view({ events: [later] });
    expect(markup).toContain(
      'data-beach-id="22222222-2222-4222-8222-222222222222"',
    );
    expect(markup).toContain('aria-label="Open Praia Test detail"');
  });

  it("applies the date window from filter state", () => {
    const markup = view({
      events: [later],
      dateWindow: "today",
    });
    expect(markup).toContain("Nothing on right now");
    const wide = view({ events: [later], dateWindow: "anytime" });
    expect(wide).toContain("Later surf comp");
  });

  it("applies the audience filter", () => {
    const markup = view({
      events: [live],
      audience: "family",
    });
    expect(markup).toContain("Nothing on right now");
    const partyView = view({ events: [live], audience: "party" });
    expect(partyView).toContain("Sunset party");
  });

  it("shows loading and hides the banner while loading", () => {
    const markup = view({ events: [live], loading: true });
    expect(markup).toContain("Loading events…");
    expect(markup).not.toContain('aria-label="Live events"');
  });

  it("shows the error state with a retry hook and hides content", () => {
    const markup = view({
      events: [live],
      error: "api_500",
      onRetry: () => undefined,
    });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("api_500");
    expect(markup).toContain("Try again");
    expect(markup).not.toContain('aria-label="Live events"');
  });

  it("shows an honest empty state when nothing matches", () => {
    const markup = view({ events: [] });
    expect(markup).toContain("Nothing on right now");
  });

  it("surfaces the partial-outage note", () => {
    const markup = view({ events: [live], failedBeachCount: 2 });
    expect(markup).toContain("2 beach feeds could not be reached");
  });
});
