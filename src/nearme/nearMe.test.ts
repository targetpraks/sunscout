import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEAR_ME_AUDIENCE,
  NEAR_ME_RADIUS_KM,
  beachToPulseInput,
  haversineKm,
  nearMeRankScore,
  nearMeTravel,
  rankNearMeBeaches,
} from "./nearMe";
import type { Beach } from "../types";
import type { NearMeOrigin } from "./types";

const NOW = new Date("2026-09-16T12:00:00Z");
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

/**
 * Minimal Beach fixture. Conditions default to the "great for family" set
 * (every signal inside the family profile's scoring bands); tests override
 * per-case. observedAt is fresh by default so staleness never perturbs the
 * ordering assertions.
 */
function makeBeach(overrides: Partial<Beach> = {}): Beach {
  return {
    id: "beach",
    name: "Test Beach",
    location: "Algarve",
    image: "/images/test.webp",
    decision: "Great pick",
    match: 80,
    drive: "15 min",
    distance: "5 km",
    seaTemp: "23°C",
    waves: "0.3 m",
    uv: "5 Moderate",
    crowd: 25,
    waterQuality: "Excellent",
    goldenHour: "19:42–20:24",
    vibes: ["Family"],
    suitability: [],
    amenities: [],
    available: { sunbeds: 0, umbrellas: 0, clubs: 0 },
    airTemp: "26°C",
    windSpeed: "8 km/h",
    cloudCover: "10%",
    provenance: { observedAt: hoursAgo(1) },
    ...overrides,
  };
}

/** "Mediocre for family" conditions — every signal far outside the bands. */
const MEDIOCRE: Partial<Beach> = {
  seaTemp: "12°C",
  waves: "1.5 m",
  uv: "9 Extreme",
  crowd: 95,
  airTemp: "15°C",
  windSpeed: "36 km/h",
  cloudCover: "80%",
};

const LAGOS: NearMeOrigin = {
  latitude: 37.0,
  longitude: -8.35,
  source: "geolocation",
};

/** ~2 km north of LAGOS (1 deg lat ≈ 111.19 km). */
const NEAR = { latitude: 37.018, longitude: -8.35 } as const;
/** ~3.3 km north of LAGOS. */
const MID = { latitude: 37.03, longitude: -8.35 } as const;
/** ~50 km north of LAGOS. */
const FAR = { latitude: 37.45, longitude: -8.35 } as const;

describe("haversineKm", () => {
  it("measures 0.1 deg of longitude at the equator as ~11.12 km", () => {
    expect(haversineKm(0, 0, 0, 0.1)).toBeCloseTo(11.12, 1);
  });

  it("returns 0 for identical points", () => {
    expect(haversineKm(37.0, -8.35, 37.0, -8.35)).toBe(0);
  });
});

describe("nearMeTravel", () => {
  it("derives walk minutes at 4.5 km/h and drive minutes at 0.55 km/min", () => {
    const travel = nearMeTravel(4.5);
    expect(travel.distanceKm).toBe(4.5);
    expect(travel.walkMinutes).toBe(60);
    expect(travel.driveMinutes).toBe(8);
  });

  it("floors drive time at 5 minutes and rounds distance to 0.1 km", () => {
    const travel = nearMeTravel(0.512);
    expect(travel.distanceKm).toBe(0.5);
    expect(travel.walkMinutes).toBe(7);
    expect(travel.driveMinutes).toBe(5);
  });
});

describe("beachToPulseInput", () => {
  it("parses the leading number out of display strings", () => {
    const input = beachToPulseInput(makeBeach());
    expect(input.id).toBe("beach");
    expect(input.conditions?.waveM).toBe(0.3);
    expect(input.conditions?.windKmh).toBe(8);
    expect(input.conditions?.waterTempC).toBe(23);
    expect(input.conditions?.airTempC).toBe(26);
    expect(input.conditions?.uvIndex).toBe(5);
    expect(input.conditions?.crowdPct).toBe(25);
    expect(input.conditions?.cloudPct).toBe(10);
    expect(input.conditions?.observedAt).toBe(hoursAgo(1));
  });

  it("leaves missing and unparsable signals null, never NaN or 0", () => {
    const input = beachToPulseInput(
      makeBeach({
        waves: "Low",
        windSpeed: undefined,
        seaTemp: undefined,
        airTemp: "",
        uv: undefined,
        crowd: Number.NaN,
        cloudCover: undefined,
        provenance: {},
      }),
    );
    expect(input.conditions?.waveM).toBeNull();
    expect(input.conditions?.windKmh).toBeNull();
    expect(input.conditions?.waterTempC).toBeNull();
    expect(input.conditions?.airTempC).toBeNull();
    expect(input.conditions?.uvIndex).toBeNull();
    expect(input.conditions?.crowdPct).toBeNull();
    expect(input.conditions?.cloudPct).toBeNull();
    expect(input.conditions?.observedAt).toBe("");
  });
});

describe("nearMeRankScore", () => {
  it("keeps full weight at the doorstep and zero at the horizon", () => {
    expect(nearMeRankScore(100, 0)).toBe(100);
    expect(nearMeRankScore(100, NEAR_ME_RADIUS_KM)).toBe(0);
    expect(nearMeRankScore(100, 2)).toBeCloseTo(
      100 * (1 - 2 / NEAR_ME_RADIUS_KM),
      6,
    );
  });
});

describe("rankNearMeBeaches", () => {
  it("blends distance with the right-now score: a nearby mediocre beach outranks a distant great one", () => {
    const ranked = rankNearMeBeaches(
      [
        makeBeach({ id: "near", name: "Near Mediocre", ...MEDIOCRE, ...NEAR }),
        makeBeach({ id: "far", name: "Far Great", ...FAR }),
      ],
      LAGOS,
      DEFAULT_NEAR_ME_AUDIENCE,
      NOW,
    );

    // Sanity: pure pulse would put "far" first; pure distance too is not the
    // point — the blend must favor the practical drive to the mediocre one.
    expect(ranked).toHaveLength(2);
    const far = ranked.find((item) => item.beach.id === "far");
    const near = ranked.find((item) => item.beach.id === "near");
    expect(near?.pulseScore).toBeLessThan(far?.pulseScore ?? 0);
    expect(near?.distanceKm).toBeLessThan(far?.distanceKm ?? 0);
    expect(ranked[0].beach.id).toBe("near");
    expect(ranked[1].beach.id).toBe("far");
  });

  it("lets the right-now score win at equal distance", () => {
    const ranked = rankNearMeBeaches(
      [
        makeBeach({ id: "mediocre", ...MEDIOCRE, ...NEAR }),
        makeBeach({ id: "great", ...NEAR }),
      ],
      LAGOS,
      DEFAULT_NEAR_ME_AUDIENCE,
      NOW,
    );
    expect(ranked[0].beach.id).toBe("great");
    expect(ranked[1].beach.id).toBe("mediocre");
  });

  it("breaks equal-score ties by distance, then by id", () => {
    const ranked = rankNearMeBeaches(
      [
        makeBeach({ id: "z", name: "Far Twin", ...FAR }),
        makeBeach({ id: "mid", name: "Middle Twin", ...MID }),
        makeBeach({ id: "b", name: "Near Twin B", ...NEAR }),
        makeBeach({ id: "a", name: "Near Twin A", ...NEAR }),
      ],
      LAGOS,
      DEFAULT_NEAR_ME_AUDIENCE,
      NOW,
    );
    // Identical right-now scores, so the blend ties everywhere: distance
    // orders the NEAR pair before MID before FAR, and the coincident NEAR
    // pair falls to the stable id tiebreak (a before b).
    expect(ranked.map((item) => item.beach.id)).toEqual(["a", "b", "mid", "z"]);
  });

  it("excludes beaches beyond the radius and beaches without coordinates", () => {
    const ranked = rankNearMeBeaches(
      [
        makeBeach({ id: "near", ...NEAR }),
        // ~0.63 deg lat north ≈ 70 km — beyond the 60 km horizon.
        makeBeach({ id: "beyond", latitude: 37.63, longitude: -8.35 }),
        makeBeach({
          id: "no-coords",
          latitude: undefined,
          longitude: undefined,
        }),
      ],
      LAGOS,
      DEFAULT_NEAR_ME_AUDIENCE,
      NOW,
    );
    expect(ranked.map((item) => item.beach.id)).toEqual(["near"]);
  });

  it("returns an empty list for zero matches without crashing", () => {
    const ranked = rankNearMeBeaches(
      [makeBeach({ id: "near", ...NEAR })],
      // South Atlantic, nowhere near the Algarve fixtures.
      { latitude: -30, longitude: -20, source: "manual" },
      DEFAULT_NEAR_ME_AUDIENCE,
      NOW,
    );
    expect(ranked).toEqual([]);
  });

  it("returns an empty list for an empty catalog", () => {
    expect(rankNearMeBeaches([], LAGOS, DEFAULT_NEAR_ME_AUDIENCE, NOW)).toEqual(
      [],
    );
  });

  it("carries walk/drive estimates, the pulse score and staleness per row", () => {
    const [item] = rankNearMeBeaches(
      [makeBeach({ id: "near", ...NEAR })],
      LAGOS,
      DEFAULT_NEAR_ME_AUDIENCE,
      NOW,
    );
    expect(item.distanceKm).toBeGreaterThan(1.9);
    expect(item.distanceKm).toBeLessThan(2.1);
    expect(item.travel.distanceKm).toBe(2);
    expect(item.travel.walkMinutes).toBe(27);
    expect(item.travel.driveMinutes).toBe(5);
    expect(item.pulseScore).toBeGreaterThanOrEqual(0);
    expect(item.pulseScore).toBeLessThanOrEqual(100);
    expect(item.staleConditions).toBe(false);
  });

  it("flags stale condition rows (older than the pulse 6h window)", () => {
    const ranked = rankNearMeBeaches(
      [
        makeBeach({
          id: "stale",
          ...NEAR,
          provenance: { observedAt: hoursAgo(30) },
        }),
      ],
      LAGOS,
      DEFAULT_NEAR_ME_AUDIENCE,
      NOW,
    );
    expect(ranked[0].staleConditions).toBe(true);
  });

  it("does not mutate the input array", () => {
    const beaches = [
      makeBeach({ id: "z", ...FAR }),
      makeBeach({ id: "a", ...NEAR }),
    ];
    const before = beaches.map((beach) => beach.id);
    rankNearMeBeaches(beaches, LAGOS, DEFAULT_NEAR_ME_AUDIENCE, NOW);
    expect(beaches.map((beach) => beach.id)).toEqual(before);
  });
});
