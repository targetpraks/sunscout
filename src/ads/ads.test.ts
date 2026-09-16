import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fetchActivePlacements } from "./api";
import { SponsoredRailView } from "./SponsoredRail";
import { SponsoredSlot } from "./SponsoredSlot";
import {
  activePlacementsAt,
  AD_KIND_LABELS,
  AD_PLACEMENT_KINDS,
  SPONSORED_LABEL,
  type SponsoredPlacement,
} from "./types";

const NOW = new Date("2026-06-15T12:00:00Z");
const BEACH_ID = "22222222-2222-4222-8222-222222222222";

function makePlacement(
  overrides: Partial<SponsoredPlacement> = {},
): SponsoredPlacement {
  return {
    id: 1,
    publicId: "11111111-1111-4111-8111-111111111111",
    beachPublicId: BEACH_ID,
    kind: "placement",
    brandName: "Solara Sunblock",
    label: "Sponsored · Solara Sunblock",
    headline: "Stay protected at golden hour",
    body: "SPF 50 reef-safe sunblock, sampled on this beach today.",
    imageUrl: null,
    targetUrl: "https://example.com/solara",
    eventPublicId: null,
    weight: 0,
    sponsored: true,
    startsAt: "2026-06-15T10:00:00Z",
    endsAt: "2026-06-15T18:00:00Z",
    ...overrides,
  };
}

describe("labels", () => {
  it("pins the disclosure label", () => {
    expect(SPONSORED_LABEL).toBe("Sponsored");
  });

  it("labels every placement kind", () => {
    for (const kind of AD_PLACEMENT_KINDS) {
      expect(AD_KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
  });
});

describe("activePlacementsAt (client mirror of the server window filter)", () => {
  it("keeps a placement whose window starts exactly at now", () => {
    const starting = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000001",
      startsAt: "2026-06-15T12:00:00Z",
      endsAt: "2026-06-15T18:00:00Z",
    });
    expect(activePlacementsAt([starting], NOW)).toHaveLength(1);
  });

  it("drops a placement whose window ends exactly at now (half-open)", () => {
    const ending = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000002",
      startsAt: "2026-06-15T08:00:00Z",
      endsAt: "2026-06-15T12:00:00Z",
    });
    expect(activePlacementsAt([ending], NOW)).toHaveLength(0);
  });

  it("drops past and future placements and keeps the live one", () => {
    const past = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000003",
      startsAt: "2026-06-14T08:00:00Z",
      endsAt: "2026-06-14T18:00:00Z",
    });
    const future = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000004",
      startsAt: "2026-06-16T08:00:00Z",
      endsAt: "2026-06-16T18:00:00Z",
    });
    const live = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000005",
    });
    const active = activePlacementsAt([future, past, live], NOW);
    expect(active.map((p) => p.publicId)).toEqual([live.publicId]);
  });

  it("orders takeovers ahead of placements, then weight desc, then start asc", () => {
    const plainHeavy = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000006",
      weight: 90,
    });
    const beachTakeover = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000007",
      kind: "beach_takeover",
      weight: 1,
    });
    const eventTakeover = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000008",
      kind: "event_takeover",
      weight: 1,
    });
    const plainLight = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000009",
      weight: 10,
    });
    const plainHeavyLater = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-00000000000a",
      weight: 90,
      startsAt: "2026-06-15T11:00:00Z",
    });
    const ordered = activePlacementsAt(
      [plainLight, plainHeavyLater, plainHeavy, eventTakeover, beachTakeover],
      NOW,
    );
    expect(ordered.map((p) => p.publicId)).toEqual([
      beachTakeover.publicId,
      eventTakeover.publicId,
      plainHeavy.publicId,
      plainHeavyLater.publicId,
      plainLight.publicId,
    ]);
  });

  it("does not mutate its input array", () => {
    const input = [makePlacement(), makePlacement()];
    const snapshot = input.map((p) => p.publicId);
    activePlacementsAt(input, NOW);
    expect(input.map((p) => p.publicId)).toEqual(snapshot);
  });
});

describe("fetchActivePlacements", () => {
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

  it("requests the ads endpoint for the beach and unwraps data", async () => {
    const fetchMock = stubFetch({ data: [makePlacement()] });
    const placements = await fetchActivePlacements(BEACH_ID);
    expect(placements).toHaveLength(1);
    expect(placements[0].brandName).toBe("Solara Sunblock");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/ads?beachId=${BEACH_ID}`,
    );
  });

  it("resolves an empty data array to an empty list", async () => {
    stubFetch({ data: [] });
    const placements = await fetchActivePlacements(BEACH_ID);
    expect(placements).toEqual([]);
  });

  it("propagates the server error message", async () => {
    stubFetch({ error: "invalid_request" }, false, 400);
    await expect(fetchActivePlacements(BEACH_ID)).rejects.toThrow(
      "invalid_request",
    );
  });

  it("falls back to a status-coded error when the body is unparseable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 502,
            json: async () => Promise.reject(new Error("bad body")),
          }) as unknown as Response,
      ),
    );
    await expect(fetchActivePlacements(BEACH_ID)).rejects.toThrow("api_502");
  });
});

describe("SponsoredSlot (static render)", () => {
  it("always renders the Sponsored disclosure, brand and kind", () => {
    const markup = renderToStaticMarkup(
      createElement(SponsoredSlot, {
        placement: makePlacement({ kind: "beach_takeover" }),
      }),
    );
    expect(markup).toContain("Sponsored");
    expect(markup).toContain("Solara Sunblock");
    expect(markup).toContain("Beach takeover");
  });

  it("marks outbound paid links rel=sponsored", () => {
    const markup = renderToStaticMarkup(
      createElement(SponsoredSlot, { placement: makePlacement() }),
    );
    expect(markup).toContain('rel="sponsored noopener noreferrer"');
  });

  it("falls back to the pinned disclosure label when the record label is blank", () => {
    const markup = renderToStaticMarkup(
      createElement(SponsoredSlot, {
        placement: makePlacement({ label: "   " }),
      }),
    );
    expect(markup).toContain(SPONSORED_LABEL);
  });

  it("omits headline, body and cta nodes when the record has none", () => {
    const markup = renderToStaticMarkup(
      createElement(SponsoredSlot, {
        placement: makePlacement({
          headline: null,
          body: null,
          targetUrl: null,
        }),
      }),
    );
    expect(markup).not.toContain("<h");
    expect(markup).not.toContain("Learn more");
  });
});

describe("SponsoredRailView (static render)", () => {
  it("renders placements with the visible Sponsored label", () => {
    const markup = renderToStaticMarkup(
      createElement(SponsoredRailView, {
        beachName: "Praia Test",
        placements: [makePlacement()],
        now: NOW,
      }),
    );
    expect(markup).toContain("Sponsored");
    expect(markup).toContain("Solara Sunblock");
    expect(markup).toContain('rel="sponsored noopener noreferrer"');
  });

  it("renders an honest empty state when no placements are active", () => {
    const markup = renderToStaticMarkup(
      createElement(SponsoredRailView, {
        beachName: "Praia Test",
        placements: [],
        now: NOW,
      }),
    );
    expect(markup).toContain("Sponsored");
    expect(markup).toContain("No sponsored placements");
    expect(markup).toContain("Praia Test");
    // The integrity note must be present in the empty state too.
    expect(markup).toContain("never affect the Beach Pulse");
  });

  it("filters expired placements client-side so cached responses cannot show them", () => {
    const expired = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-00000000000b",
      endsAt: "2026-06-15T12:00:00Z",
    });
    const markup = renderToStaticMarkup(
      createElement(SponsoredRailView, {
        beachName: "Praia Test",
        placements: [expired],
        now: NOW,
      }),
    );
    expect(markup).toContain("No sponsored placements");
    expect(markup).not.toContain("Solara Sunblock");
  });

  it("renders a loading state that still carries the Sponsored disclosure", () => {
    const markup = renderToStaticMarkup(
      createElement(SponsoredRailView, {
        beachName: "Praia Test",
        placements: [],
        loading: true,
        now: NOW,
      }),
    );
    expect(markup).toContain("Sponsored");
    expect(markup).toContain("Loading sponsored placements");
  });

  it("renders an error state with a Retry affordance when provided", () => {
    const markup = renderToStaticMarkup(
      createElement(SponsoredRailView, {
        beachName: "Praia Test",
        placements: [],
        error: "api_502",
        onRetry: () => {},
        now: NOW,
      }),
    );
    expect(markup).toContain("Sponsored");
    expect(markup).toContain("unavailable right now");
    expect(markup).toContain("Retry");
  });

  it("keeps valid placements visible even when a refresh is in flight", () => {
    const markup = renderToStaticMarkup(
      createElement(SponsoredRailView, {
        beachName: "Praia Test",
        placements: [makePlacement()],
        loading: true,
        now: NOW,
      }),
    );
    expect(markup).toContain("Solara Sunblock");
    expect(markup).not.toContain("Loading sponsored placements");
  });
});
