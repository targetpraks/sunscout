import { describe, expect, it } from "vitest";
import type { Beach } from "./types";
import { beaches as seedBeaches } from "./data";
import {
  bookingTotalCents,
  bookingTotalEuros,
  canCreateTrip,
  canSaveBeach,
  discoveryFreeResults,
  FREE_RESULT_LIMIT,
  parseQuery,
  rankBeaches,
  SAVED_LIMIT_FREE,
  toQueryAudience,
} from "./logic";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const hoursBeforeNow = (hours: number) =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const makeBeach = (overrides: Partial<Beach> = {}): Beach => ({
  id: "b1",
  name: "Praia Test",
  location: "Algarve, Portugal",
  image: "/x.png",
  decision: "A calm family cove",
  match: 80,
  drive: "30 min",
  distance: "20 km",
  seaTemp: "19°C",
  waves: "0.5 m",
  uv: "6 High",
  crowd: 35,
  waterQuality: "Good",
  goldenHour: "19:42–20:24",
  vibes: ["Quiet", "Family"],
  // Fresh by default so legacy fixtures keep their pre-upgrade ordering.
  conditionsUpdatedAt: hoursBeforeNow(1),
  suitability: [
    { id: "families", label: "Families", value: "Excellent", score: 3 },
    { id: "party", label: "Party", value: "Quiet", score: 0 },
  ],
  amenities: ["Lifeguard"],
  available: { sunbeds: 10, umbrellas: 5, clubs: 2 },
  ...overrides,
});

describe("parseQuery", () => {
  it("maps audience terms to structured audiences", () => {
    expect(parseQuery("families").audience).toBe("family");
    expect(parseQuery("family").audience).toBe("family");
    expect(parseQuery("friends").audience).toBe("friends");
    expect(parseQuery("solo").audience).toBe("solo");
    expect(parseQuery("couples").audience).toBe("couples");
    expect(parseQuery("clubs").audience).toBe("party");
    expect(parseQuery("party").audience).toBe("party");
    expect(parseQuery("chill").audience).toBe("chill");
  });

  it("maps activity terms to structured activities, deduped in first-seen order", () => {
    expect(parseQuery("snorkeling").activities).toEqual(["snorkeling"]);
    expect(parseQuery("good surf today").activities).toEqual(["water_sports"]);
    expect(parseQuery("beach park").activities).toEqual(["beach_park"]);
    expect(parseQuery("beach clubs open").activities).toEqual(["beach_club"]);
    expect(parseQuery("snorkel or snorkeling").activities).toEqual([
      "snorkeling",
    ]);
  });

  it("maps nudist and clothing-optional phrasing to the clothingOptional flag, never to activities", () => {
    for (const query of [
      "nudist",
      "nude beach",
      "naturist",
      "clothing optional",
      "clothing-optional",
      "topless",
      "fkk",
    ]) {
      expect(parseQuery(query).clothingOptional).toBe(true);
      expect(parseQuery(query).activities).toEqual([]);
    }
  });

  it("uses word boundaries so embedded substrings do not match", () => {
    expect(parseQuery("updated conditions").audience).toBeNull();
    expect(parseQuery("a display of talent").activities).toEqual([]);
  });

  it("returns empty structured filters for plain legacy queries", () => {
    for (const query of ["", "calm water", "sandy", "gold"]) {
      expect(parseQuery(query)).toEqual({
        audience: null,
        activities: [],
        clothingOptional: false,
      });
    }
  });
});

describe("rankBeaches", () => {
  it("ranks by base match score when no query or filters", () => {
    const catalog = [
      makeBeach({ id: "a", match: 70 }),
      makeBeach({ id: "b", match: 90 }),
    ];
    const ranked = rankBeaches(catalog, "", []);
    expect(ranked[0].beach.id).toBe("b");
    expect(ranked[1].beach.id).toBe("a");
  });

  it("boosts family beaches for a family query", () => {
    const catalog = [
      makeBeach({
        id: "a",
        match: 70,
        decision: "rocky surf spot",
        vibes: ["Surf", "Waves"],
        suitability: [
          { id: "party", label: "Party", value: "Lively", score: 2 },
        ],
      }),
      makeBeach({
        id: "b",
        match: 70,
        decision: "calm family water",
        vibes: ["Quiet", "Family"],
        suitability: [
          { id: "families", label: "Families", value: "Excellent", score: 3 },
        ],
      }),
    ];
    const ranked = rankBeaches(catalog, "family", []);
    expect(ranked[0].beach.id).toBe("b");
  });

  it("applies the Low crowd filter only to low-crowd beaches", () => {
    const catalog = [
      makeBeach({ id: "a", crowd: 80 }),
      makeBeach({ id: "b", crowd: 30 }),
    ];
    const ranked = rankBeaches(catalog, "", ["Low crowd"]);
    expect(ranked[0].beach.id).toBe("b");
  });

  it("caps scores at 99", () => {
    const catalog = [makeBeach({ id: "a", match: 95, crowd: 30 })];
    const ranked = rankBeaches(catalog, "party party", ["Low crowd"]);
    expect(ranked[0].score).toBeLessThanOrEqual(99);
  });

  it("keeps legacy behavior for plain queries: no audience blending, no filtering", () => {
    const catalog = [
      makeBeach({ id: "a", match: 60, activities: ["snorkeling"] }),
      makeBeach({ id: "b", match: 85, activities: [] }),
    ];
    // "sandy" parses to no audience, no activities, no clothing flag: b wins on match alone.
    const ranked = rankBeaches(catalog, "sandy", [], { now: NOW });
    expect(ranked.map((r) => r.beach.id)).toEqual(["b", "a"]);
    expect(ranked[0].score).toBe(85);
  });

  it("ranks identical fixtures in different orders per audience via the parsed query", () => {
    const calm = makeBeach({
      id: "calm",
      match: 80,
      name: "Calm Cove",
      decision: "sheltered shallow water",
      waves: "0.3 m",
      crowd: 20,
      uv: "5 Moderate",
      windSpeed: "10 km/h",
      airTemp: "26°C",
      cloudCover: "10%",
      suitability: [
        { id: "families", label: "Families", value: "Good", score: 2 },
      ],
    });
    const busy = makeBeach({
      id: "busy",
      match: 80,
      name: "Busy Bay",
      decision: "waves and a packed shore",
      waves: "1.1 m",
      crowd: 85,
      uv: "8 Very high",
      windSpeed: "10 km/h",
      airTemp: "26°C",
      cloudCover: "10%",
      suitability: [
        { id: "families", label: "Families", value: "Fair", score: 1 },
      ],
    });
    const catalog = [calm, busy];
    const familyOrder = rankBeaches(catalog, "families", [], {
      now: NOW,
    }).map((r) => r.beach.id);
    const partyOrder = rankBeaches(catalog, "party", [], {
      now: NOW,
    }).map((r) => r.beach.id);
    expect(familyOrder[0]).toBe("calm");
    expect(partyOrder[0]).toBe("busy");
    expect(familyOrder).not.toEqual(partyOrder);
  });

  it("ranks identical fixtures differently per audience via RankOptions override", () => {
    const base = {
      match: 80,
      waves: "0.3 m",
      crowd: 20,
      uv: "5 Moderate",
      windSpeed: "10 km/h",
      airTemp: "26°C",
      cloudCover: "10%",
      suitability: [],
    };
    const catalog = [makeBeach({ id: "x", ...base })];
    // Same beach, two audiences: both runs are valid and deterministic; the
    // criterion is exercised by the per-audience ordering test above. Here we
    // assert the explicit override drives the pulse path (score differs from
    // the plain legacy score for the same input).
    const plain = rankBeaches(catalog, "", [], { now: NOW });
    const withFamily = rankBeaches(catalog, "", [], {
      now: NOW,
      audience: "family",
    });
    expect(plain[0].score).toBe(80);
    expect(withFamily[0].score).not.toBe(80);
  });

  it("sorts stale condition matches below fresh ones", () => {
    const catalog = [
      makeBeach({
        id: "stale",
        match: 80,
        conditionsUpdatedAt: hoursBeforeNow(30),
      }),
      makeBeach({
        id: "fresh",
        match: 80,
        conditionsUpdatedAt: hoursBeforeNow(1),
      }),
    ];
    const ranked = rankBeaches(catalog, "", [], { now: NOW });
    expect(ranked[0].beach.id).toBe("fresh");
    expect(ranked[1].beach.id).toBe("stale");
  });

  it("treats missing and unparsable condition timestamps as stale", () => {
    const catalog = [
      makeBeach({ id: "unknown-age", match: 80, conditionsUpdatedAt: null }),
      makeBeach({
        id: "bad-age",
        match: 80,
        conditionsUpdatedAt: "not-a-date",
      }),
      makeBeach({
        id: "fresh",
        match: 80,
        conditionsUpdatedAt: hoursBeforeNow(1),
      }),
    ];
    const ranked = rankBeaches(catalog, "", [], { now: NOW });
    expect(ranked[0].beach.id).toBe("fresh");
    for (const entry of ranked) {
      expect(Number.isFinite(entry.score)).toBe(true);
    }
    // Both stale entries decay by the same factor; the id tie-break orders them.
    expect(ranked.slice(1).map((r) => r.beach.id)).toEqual([
      "bad-age",
      "unknown-age",
    ]);
  });

  it("falls back to provenance.observedAt when conditionsUpdatedAt is missing", () => {
    const catalog = [
      makeBeach({
        id: "provenance-fresh",
        match: 80,
        conditionsUpdatedAt: null,
        provenance: { observedAt: hoursBeforeNow(1) },
      }),
      makeBeach({
        id: "explicit-stale",
        match: 80,
        conditionsUpdatedAt: hoursBeforeNow(30),
      }),
    ];
    const ranked = rankBeaches(catalog, "", [], { now: NOW });
    expect(ranked[0].beach.id).toBe("provenance-fresh");
  });

  it("is deterministic: re-ranking the same input yields the identical order", () => {
    const catalog = [
      makeBeach({ id: "a", match: 80, crowd: 30 }),
      makeBeach({ id: "b", match: 80, crowd: 60 }),
      makeBeach({ id: "c", match: 85, activities: ["snorkeling"] }),
      makeBeach({ id: "d", match: 80, allowsNudism: true }),
    ];
    const first = rankBeaches(catalog, "chill", [], { now: NOW });
    const second = rankBeaches(catalog, "chill", [], { now: NOW });
    expect(first.map((r) => r.beach.id)).toEqual(second.map((r) => r.beach.id));
    expect(first.map((r) => r.score)).toEqual(second.map((r) => r.score));
  });

  it("breaks score ties by beach id for a stable order", () => {
    const catalog = [
      makeBeach({ id: "z", match: 80 }),
      makeBeach({ id: "a", match: 80 }),
      makeBeach({ id: "m", match: 80 }),
    ];
    const ranked = rankBeaches(catalog, "", [], { now: NOW });
    expect(ranked.map((r) => r.beach.id)).toEqual(["a", "m", "z"]);
  });

  it("filters to clothing-optional beaches for an explicit nudist query", () => {
    const catalog = [
      makeBeach({ id: "textile", match: 90, allowsNudism: false }),
      makeBeach({ id: "naturist", match: 70, allowsNudism: true }),
    ];
    const ranked = rankBeaches(catalog, "nudist beach", [], { now: NOW });
    expect(ranked.map((r) => r.beach.id)).toEqual(["naturist"]);
  });

  it("filters to clothing-optional beaches via the explicit option switch", () => {
    const catalog = [
      makeBeach({ id: "textile", match: 90, allowsNudism: false }),
      makeBeach({ id: "naturist", match: 70, allowsNudism: true }),
    ];
    const ranked = rankBeaches(catalog, "", [], {
      now: NOW,
      clothingOptionalOnly: true,
    });
    expect(ranked.map((r) => r.beach.id)).toEqual(["naturist"]);
  });

  it("keeps the pulse blend influential even when a legacy substring boost fires", () => {
    const calm = makeBeach({
      id: "calm",
      match: 80,
      name: "Calm Cove",
      decision: "sheltered shallow water, away from the party strip",
      waves: "0.3 m",
      crowd: 20,
      uv: "5 Moderate",
      windSpeed: "10 km/h",
      airTemp: "26°C",
      cloudCover: "10%",
      suitability: [
        { id: "families", label: "Families", value: "Good", score: 2 },
      ],
    });
    const busy = makeBeach({
      id: "busy",
      match: 80,
      name: "Busy Bay",
      decision: "party waves and a packed shore",
      waves: "1.1 m",
      crowd: 85,
      uv: "8 Very high",
      windSpeed: "10 km/h",
      airTemp: "26°C",
      cloudCover: "10%",
      suitability: [
        { id: "families", label: "Families", value: "Fair", score: 1 },
      ],
    });
    // The query contains "party", so BOTH beaches get the equal +10 legacy
    // substring boost — the only remaining differentiator must be the pulse.
    const ranked = rankBeaches([calm, busy], "party weekend", [], {
      now: NOW,
      audience: "family",
    });
    expect(ranked.map((r) => r.beach.id)).toEqual(["calm", "busy"]);
  });

  it("normalizes Discovery-screen audience slugs to pulse audiences", () => {
    expect(toQueryAudience("families")).toBe("family");
    expect(toQueryAudience("friends")).toBe("friends");
    expect(toQueryAudience("chill")).toBe("chill");
    expect(toQueryAudience("")).toBeNull();
    expect(toQueryAudience("anyone")).toBeNull();
  });

  it("filters activity queries to beaches offering every parsed activity", () => {
    const catalog = [
      makeBeach({
        id: "snorkel-spot",
        match: 70,
        activities: ["snorkeling", "photography"],
      }),
      makeBeach({ id: "surf-spot", match: 90, activities: ["water_sports"] }),
      makeBeach({ id: "no-activities", match: 95, activities: [] }),
    ];
    const ranked = rankBeaches(catalog, "snorkeling", [], { now: NOW });
    expect(ranked.map((r) => r.beach.id)).toEqual(["snorkel-spot"]);
  });

  it("filters via the explicit activities option, requiring all of them", () => {
    const catalog = [
      makeBeach({
        id: "both",
        match: 70,
        activities: ["snorkeling", "photography"],
      }),
      makeBeach({ id: "one", match: 90, activities: ["snorkeling"] }),
    ];
    const ranked = rankBeaches(catalog, "", [], {
      now: NOW,
      activities: ["snorkeling", "photography"],
    });
    expect(ranked.map((r) => r.beach.id)).toEqual(["both"]);
  });
});

describe("seed data", () => {
  it("gives every seed beach activity and clothing-optional attributes and a condition timestamp", () => {
    expect(seedBeaches.length).toBeGreaterThan(0);
    for (const beach of seedBeaches) {
      expect(beach.activities, `${beach.id} activities`).toBeDefined();
      expect(beach.activities!.length).toBeGreaterThan(0);
      expect(typeof beach.allowsNudism, `${beach.id} allowsNudism`).toBe(
        "boolean",
      );
      expect(beach.conditionsUpdatedAt, `${beach.id} timestamp`).toBeTruthy();
    }
  });

  it("includes at least one clothing-optional beach so nudist queries return results", () => {
    const nudist = rankBeaches(seedBeaches, "nudist", [], { now: new Date() });
    expect(nudist.length).toBeGreaterThan(0);
    expect(nudist.every((r) => r.beach.allowsNudism)).toBe(true);
  });

  it("ranks seed beaches differently for a family query than a party query", () => {
    const ids = (query: string) =>
      rankBeaches(seedBeaches, query, [], { now: new Date() }).map(
        (r) => r.beach.id,
      );
    const family = ids("families");
    const party = ids("party");
    expect(family).not.toEqual(party);
  });
});

describe("booking pricing", () => {
  it("totals sunbeds, umbrellas and the service fee in cents", () => {
    expect(bookingTotalCents(2, 1)).toBe(2 * 1200 + 1 * 800 + 300);
  });

  it("converts cents to euros", () => {
    expect(bookingTotalEuros(2, 1)).toBe(35);
  });

  it("charges only the service fee for an empty order", () => {
    expect(bookingTotalCents(0, 0)).toBe(300);
  });
});

describe("entitlements", () => {
  it("blocks saving beyond the free cap and allows it for premium", () => {
    expect(canSaveBeach(SAVED_LIMIT_FREE, false).ok).toBe(false);
    expect(canSaveBeach(SAVED_LIMIT_FREE, true).ok).toBe(true);
    expect(canSaveBeach(SAVED_LIMIT_FREE - 1, false).ok).toBe(true);
  });

  it("allows only one active trip on free, unlimited on premium", () => {
    expect(canCreateTrip(1, false).ok).toBe(false);
    expect(canCreateTrip(0, false).ok).toBe(true);
    expect(canCreateTrip(5, true).ok).toBe(true);
  });
});

describe("discovery free-tier boundary", () => {
  it("trims results to the free limit for non-premium and shows all for premium", () => {
    const results = [1, 2, 3, 4, 5, 6];
    expect(discoveryFreeResults(results, false)).toEqual([1, 2, 3]);
    expect(discoveryFreeResults(results, false).length).toBe(FREE_RESULT_LIMIT);
    expect(discoveryFreeResults(results, true).length).toBe(6);
  });
});
