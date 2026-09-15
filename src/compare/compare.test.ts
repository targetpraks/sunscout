import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Beach } from "../types";
import { commitTripDraft, fetchCompareCatalog, fetchWishlistIds } from "./api";
import CompareRow from "./CompareRow";
import ScoreColumn from "./ScoreColumn";
import { compareDestination } from "./routes";
import CompareScreen from "./CompareScreen";
import {
  amenityFlags,
  driveEstimate,
  filterByQuery,
  parseDisplayNumber,
  toConditionSnapshot,
  topScoreIds,
  upsertBeachInDraft,
  type Origin,
} from "./types";

const ORIGIN: Origin = { label: "Lagos", latitude: 37.103, longitude: -8.674 };

const makeBeach = (overrides: Partial<Beach> = {}): Beach => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Praia Test",
  location: "Algarve, Portugal",
  image: "/assets/beaches/praia-test.svg",
  decision: "Calm cove",
  match: 80,
  drive: "28 min",
  distance: "18 km",
  seaTemp: "22°C",
  waves: "0.8 m",
  uv: "5 Moderate",
  crowd: 40,
  waterQuality: "Excellent",
  goldenHour: "06:12–20:24",
  airTemp: "26°C",
  wind: "Gentle offshore",
  windSpeed: "12 km/h",
  cloudCover: "10%",
  vibes: ["Beach clubs"],
  activities: [],
  latitude: 37.09,
  longitude: -8.7,
  amenities: ["Lifeguard", "Parking"],
  suitability: [],
  available: { sunbeds: 10, umbrellas: 4, clubs: 2 },
  provenance: { observedAt: "2026-06-15T10:00:00Z" },
  ...overrides,
});

describe("parseDisplayNumber", () => {
  it("extracts numbers from display strings", () => {
    expect(parseDisplayNumber("22°C")).toBe(22);
    expect(parseDisplayNumber("0.8 m")).toBe(0.8);
    expect(parseDisplayNumber("30%")).toBe(30);
    expect(parseDisplayNumber("5 Moderate")).toBe(5);
  });

  it("returns null for missing or non-numeric values", () => {
    expect(parseDisplayNumber("—")).toBeNull();
    expect(parseDisplayNumber("")).toBeNull();
    expect(parseDisplayNumber(null)).toBeNull();
    expect(parseDisplayNumber("abc")).toBeNull();
  });
});

describe("toConditionSnapshot", () => {
  it("maps beach display strings into a numeric snapshot", () => {
    const snapshot = toConditionSnapshot(makeBeach());
    expect(snapshot.airTempC).toBe(26);
    expect(snapshot.waterTempC).toBe(22);
    expect(snapshot.windKmh).toBe(12);
    expect(snapshot.waveM).toBe(0.8);
    expect(snapshot.uvIndex).toBe(5);
    expect(snapshot.cloudPct).toBe(10);
    expect(snapshot.crowdPct).toBe(40);
    expect(snapshot.observedAt).toBe("2026-06-15T10:00:00Z");
  });

  it("keeps every signal null-safe when the beach has no data", () => {
    const empty = makeBeach({
      airTemp: null,
      windSpeed: null,
      cloudCover: null,
      seaTemp: "—",
      waves: "—",
      uv: "—",
      crowd: NaN,
      provenance: undefined,
    });
    const snapshot = toConditionSnapshot(empty);
    expect(snapshot.airTempC).toBeNull();
    expect(snapshot.crowdPct).toBeNull();
    expect(snapshot.observedAt).toBe("");
  });
});

describe("amenityFlags", () => {
  it("reads parking and lifeguard from the amenity list", () => {
    const flags = amenityFlags(makeBeach());
    expect(flags.parking).toBe(true);
    expect(flags.lifeguard).toBe(true);
  });

  it("derives shade from umbrella inventory and beach club from vibes", () => {
    const flags = amenityFlags(
      makeBeach({ amenities: ["Restrooms"], vibes: ["Beach clubs"] }),
    );
    expect(flags.shade).toBe(true);
    expect(flags.beachClub).toBe(true);
  });

  it("reports false for all four rows on a bare beach", () => {
    const flags = amenityFlags(
      makeBeach({
        amenities: [],
        vibes: [],
        available: { sunbeds: 0, umbrellas: 0, clubs: 0 },
      }),
    );
    expect(flags).toEqual({
      parking: false,
      lifeguard: false,
      shade: false,
      beachClub: false,
    });
  });
});

describe("driveEstimate", () => {
  it("prefers the server-populated travel field", () => {
    const beach = makeBeach({
      travel: { distanceKm: 18.4, walkMinutes: 245, driveMinutes: 33 },
    });
    expect(driveEstimate(ORIGIN, beach)).toEqual({
      distanceKm: 18.4,
      driveMinutes: 33,
    });
  });

  it("falls back to the haversine estimate when travel is absent", () => {
    const drive = driveEstimate(ORIGIN, makeBeach());
    expect(drive).not.toBeNull();
    expect(drive!.distanceKm).toBeGreaterThan(0);
    expect(drive!.driveMinutes).toBeGreaterThan(0);
  });

  it("returns null without an origin or beach coordinates", () => {
    expect(driveEstimate(null, makeBeach())).toBeNull();
    expect(
      driveEstimate(ORIGIN, makeBeach({ latitude: undefined })),
    ).toBeNull();
  });
});

describe("topScoreIds", () => {
  it("highlights every beach tied at the highest score", () => {
    expect(
      topScoreIds([
        { id: "a", score: 70 },
        { id: "b", score: 80 },
        { id: "c", score: 80 },
      ]),
    ).toEqual(["b", "c"]);
  });

  it("returns empty for no input and ignores non-finite scores", () => {
    expect(topScoreIds([])).toEqual([]);
    expect(
      topScoreIds([
        { id: "a", score: Number.NaN },
        { id: "b", score: 10 },
      ]),
    ).toEqual(["b"]);
  });
});

describe("upsertBeachInDraft", () => {
  it("adds a beach once and never mutates the input", () => {
    const draft = { name: "Compare picks", beachIds: ["a"] };
    const next = upsertBeachInDraft(draft, "b");
    expect(next.beachIds).toEqual(["a", "b"]);
    expect(upsertBeachInDraft(next, "b").beachIds).toEqual(["a", "b"]);
    expect(draft.beachIds).toEqual(["a"]);
  });
});

describe("filterByQuery", () => {
  const beaches = [
    makeBeach({ id: "1", name: "Praia da Coelha" }),
    makeBeach({
      id: "2",
      name: "Other",
      vibes: ["Snorkeling"],
      location: "Sagres, Portugal",
    }),
  ];

  it("returns everything for an empty query", () => {
    expect(filterByQuery(beaches, "  ")).toHaveLength(2);
  });

  it("matches on name, location and vibes, case-insensitively", () => {
    expect(filterByQuery(beaches, "coelha")).toHaveLength(1);
    expect(filterByQuery(beaches, "sagres")).toHaveLength(1);
    expect(filterByQuery(beaches, "snorkeling")).toHaveLength(1);
    expect(filterByQuery(beaches, "nowhere")).toHaveLength(0);
  });
});

describe("compare route registration", () => {
  it("self-registers the /compare destination with real metadata", () => {
    expect(compareDestination.path).toBe("/compare");
    expect(compareDestination.label.trim().length).toBeGreaterThan(0);
    expect(compareDestination.description.trim().length).toBeGreaterThan(0);
    expect(compareDestination.component).toBeTruthy();
  });
});

describe("ScoreColumn", () => {
  it("marks the highest-scoring beach for accessibility", () => {
    const markup = renderToStaticMarkup(
      createElement(ScoreColumn, {
        score: 82,
        isTop: true,
        beachName: "Praia",
      }),
    );
    expect(markup).toContain("Highest Beach Pulse score");
    expect(markup).toContain("Praia");
  });

  it("renders the shared PulseBadge tier label inside", () => {
    const markup = renderToStaticMarkup(
      createElement(ScoreColumn, { score: 82 }),
    );
    expect(markup).toContain("Excellent");
  });
});

describe("CompareRow", () => {
  const beach = makeBeach();

  it("renders aligned condition, amenity, score and drive rows", () => {
    const markup = renderToStaticMarkup(
      createElement(CompareRow, {
        beach,
        pulse: null,
        isTop: false,
        drive: { distanceKm: 18.4, driveMinutes: 33 },
        inTrip: false,
        onAddToTrip: () => {},
      }),
    );
    expect(markup).toContain("Praia Test");
    expect(markup).toContain("26°C");
    expect(markup).toContain("22°C");
    expect(markup).toContain("12 km/h");
    expect(markup).toContain("0.8 m");
    expect(markup).toContain("Excellent");
    expect(markup).toContain("Lifeguard: Yes");
    expect(markup).toContain("Parking: Yes");
    expect(markup).toContain("18.4 km · 33 min drive");
    expect(markup).toContain("Add to current trip");
  });

  it("shows the added state once the beach is in the trip", () => {
    const markup = renderToStaticMarkup(
      createElement(CompareRow, {
        beach,
        pulse: null,
        isTop: false,
        drive: null,
        inTrip: true,
        onAddToTrip: () => {},
      }),
    );
    expect(markup).toContain("Added to trip");
    expect(markup).toContain('disabled=""');
  });
});

describe("CompareScreen", () => {
  it("renders a loading state before any data arrives", () => {
    const markup = renderToStaticMarkup(createElement(CompareScreen, {}));
    expect(markup).toContain("Compare beaches");
    expect(markup).toContain("Loading live beach data");
  });
});

describe("compare api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (json: unknown, status = 200) =>
    vi.fn(
      async (_path: string, _init?: RequestInit) =>
        ({
          ok: status < 400,
          status,
          json: async () => json,
        }) as unknown as Response,
    );

  it("fetchCompareCatalog passes the origin and refresh flag", async () => {
    const fetchMock = stubFetch({ data: [] });
    vi.stubGlobal("fetch", fetchMock);
    await fetchCompareCatalog(ORIGIN);
    const called = String(fetchMock.mock.calls[0]?.[0]);
    expect(called).toContain("lat=37.103");
    expect(called).toContain("lng=-8.674");
    expect(called).toContain("refresh=true");
  });

  it("fetchCompareCatalog omits coordinates without an origin", async () => {
    const fetchMock = stubFetch({ data: [] });
    vi.stubGlobal("fetch", fetchMock);
    await fetchCompareCatalog(null);
    const called = String(fetchMock.mock.calls[0]?.[0]);
    expect(called).not.toContain("lat=");
    expect(called).not.toContain("lng=");
  });

  it("fetchWishlistIds reads the saved-beaches endpoint", async () => {
    const fetchMock = stubFetch({ data: ["a", "b"] });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchWishlistIds()).toEqual(["a", "b"]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/me/saved");
  });

  it("commits the whole draft through the create-trip endpoint once", async () => {
    const fetchMock = stubFetch(
      { data: { public_id: "22222222-2222-4222-8222-222222222222" } },
      201,
    );
    vi.stubGlobal("fetch", fetchMock);
    const tripId = await commitTripDraft(
      { name: "Compare picks", beachIds: ["a", "b", "c"] },
      ORIGIN,
    );
    expect(tripId).toBe("22222222-2222-4222-8222-222222222222");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(path)).toContain("/me/trips");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      name: "Compare picks",
      beachPublicIds: ["a", "b", "c"],
      locationLabel: "Lagos",
      latitude: 37.103,
      longitude: -8.674,
    });
  });

  it("surfaces a server error as a rejected promise", async () => {
    const fetchMock = stubFetch({ error: "trip_not_found" }, 404);
    vi.stubGlobal("fetch", fetchMock);
    // Raw passthrough — the api layer never transforms the server error;
    // the screen owns the underscore→space humanizing.
    await expect(
      commitTripDraft({ name: "Compare picks", beachIds: ["a"] }, null),
    ).rejects.toThrow("trip_not_found");
  });
});
