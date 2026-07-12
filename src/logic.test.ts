import { describe, expect, it } from "vitest";
import type { Beach } from "./types";
import {
  bookingTotalCents,
  bookingTotalEuros,
  canCreateTrip,
  canSaveBeach,
  discoveryFreeResults,
  FREE_RESULT_LIMIT,
  rankBeaches,
  SAVED_LIMIT_FREE,
} from "./logic";

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
  suitability: [
    { id: "families", label: "Families", value: "Excellent", score: 3 },
    { id: "party", label: "Party", value: "Quiet", score: 0 },
  ],
  amenities: ["Lifeguard"],
  available: { sunbeds: 10, umbrellas: 5, clubs: 2 },
  ...overrides,
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
