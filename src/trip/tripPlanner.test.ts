import { describe, expect, it } from "vitest";
import type { Beach } from "../types";
import {
  haversineKm,
  matchesActivities,
  matchesAudience,
  parseCoordinates,
  planBeaches,
  PLANNER_AUDIENCES,
  travelEstimates,
} from "./distance";
import type { PlannerLocation } from "./types";

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
    { id: "clubs", label: "Clubs", value: "Some", score: 1 },
    { id: "solo", label: "Solo", value: "Good", score: 2 },
  ],
  amenities: ["Lifeguard"],
  available: { sunbeds: 10, umbrellas: 5, clubs: 2 },
  ...overrides,
});

const LAGOS: PlannerLocation = {
  label: "Lagos",
  latitude: 37.103,
  longitude: -8.674,
};

describe("haversineKm", () => {
  it("measures one degree of latitude as ~111.195 km", () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.195, 2);
  });

  it("measures one equatorial degree of longitude as ~111.195 km", () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.195, 2);
  });

  it("returns 0 for identical points", () => {
    expect(
      haversineKm(
        LAGOS.latitude,
        LAGOS.longitude,
        LAGOS.latitude,
        LAGOS.longitude,
      ),
    ).toBe(0);
  });

  it("is symmetric", () => {
    expect(haversineKm(37.103, -8.674, 37.089, -8.25)).toBeCloseTo(
      haversineKm(37.089, -8.25, 37.103, -8.674),
      9,
    );
  });
});

describe("travelEstimates", () => {
  it("computes walk minutes at ~5 km/h and drive minutes at ~40 km/h", () => {
    // 10 km: walk = 10/5*60 = 120 min, drive = 10/40*60 = 15 min.
    expect(travelEstimates(10)).toEqual({
      walkDistanceKm: 10,
      walkMinutes: 120,
      driveDistanceKm: 10,
      driveMinutes: 15,
    });
  });

  it("floors short drives at the 5-minute parking/access minimum", () => {
    // 0.5 km: drive would be <1 min, so the floor applies; walk = 6 min.
    expect(travelEstimates(0.5)).toEqual({
      walkDistanceKm: 0.5,
      walkMinutes: 6,
      driveDistanceKm: 0.5,
      driveMinutes: 5,
    });
  });

  it("rounds distances to one decimal place", () => {
    const estimates = travelEstimates(3.14159);
    expect(estimates.walkDistanceKm).toBe(3.1);
    expect(estimates.driveDistanceKm).toBe(3.1);
    expect(estimates.walkMinutes).toBe(Math.round((3.14159 / 5) * 60));
  });
});

describe("parseCoordinates", () => {
  it("accepts comma-separated lat, lng", () => {
    expect(parseCoordinates("37.103, -8.674")).toEqual({
      latitude: 37.103,
      longitude: -8.674,
    });
  });

  it("accepts whitespace-separated coordinates", () => {
    expect(parseCoordinates("37.103 -8.674")).toEqual({
      latitude: 37.103,
      longitude: -8.674,
    });
  });

  it("rejects a third junk token instead of silently ignoring it", () => {
    expect(parseCoordinates("37.1, -8.6, extra")).toBeNull();
  });

  it("rejects a single token, empty input and non-numeric input", () => {
    expect(parseCoordinates("37.103")).toBeNull();
    expect(parseCoordinates("")).toBeNull();
    expect(parseCoordinates("abc, def")).toBeNull();
  });

  it("rejects out-of-range latitude and longitude", () => {
    expect(parseCoordinates("91, 0")).toBeNull();
    expect(parseCoordinates("-91, 0")).toBeNull();
    expect(parseCoordinates("0, 181")).toBeNull();
    expect(parseCoordinates("0, -181")).toBeNull();
  });

  it("accepts the boundary values", () => {
    expect(parseCoordinates("90, 180")).toEqual({
      latitude: 90,
      longitude: 180,
    });
    expect(parseCoordinates("-90, -180")).toEqual({
      latitude: -90,
      longitude: -180,
    });
  });
});

describe("PLANNER_AUDIENCES", () => {
  it("carries the locked audience vocabulary with non-empty labels", () => {
    expect(PLANNER_AUDIENCES.map((option) => option.id)).toEqual([
      "family",
      "friends",
      "clubs",
      "chill",
      "solo",
    ]);
    for (const option of PLANNER_AUDIENCES) {
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("matchesAudience", () => {
  it("matches every beach when no audience is selected", () => {
    expect(matchesAudience(makeBeach(), "")).toBe(true);
  });

  it("maps family to a families suitability score of at least 2", () => {
    expect(matchesAudience(makeBeach(), "family")).toBe(true);
    expect(
      matchesAudience(
        makeBeach({
          suitability: [
            { id: "families", label: "Families", value: "Poor", score: 0 },
          ],
        }),
        "family",
      ),
    ).toBe(false);
  });

  it("maps friends to the party suitability score", () => {
    expect(matchesAudience(makeBeach(), "friends")).toBe(false);
    expect(
      matchesAudience(
        makeBeach({
          suitability: [
            { id: "party", label: "Party", value: "Lively", score: 3 },
          ],
        }),
        "friends",
      ),
    ).toBe(true);
  });

  it("maps solo to the solo suitability score", () => {
    expect(matchesAudience(makeBeach(), "solo")).toBe(true);
    expect(
      matchesAudience(
        makeBeach({
          suitability: [{ id: "solo", label: "Solo", value: "Busy", score: 1 }],
        }),
        "solo",
      ),
    ).toBe(false);
  });

  it("maps clubs to the clubs suitability score", () => {
    expect(matchesAudience(makeBeach(), "clubs")).toBe(false);
    expect(
      matchesAudience(
        makeBeach({
          suitability: [
            { id: "clubs", label: "Clubs", value: "Excellent", score: 3 },
          ],
        }),
        "clubs",
      ),
    ).toBe(true);
  });

  it("maps chill to quiet/calm vibes or the chill activity", () => {
    expect(matchesAudience(makeBeach(), "chill")).toBe(true); // vibes: ["Quiet", "Family"]
    expect(
      matchesAudience(
        makeBeach({
          vibes: ["Lively"],
          activities: ["chill"],
        }),
        "chill",
      ),
    ).toBe(true);
    expect(
      matchesAudience(
        makeBeach({ vibes: ["Lively"], activities: ["nightlife"] }),
        "chill",
      ),
    ).toBe(false);
  });
});

describe("matchesActivities", () => {
  it("matches every beach when no activities are selected", () => {
    expect(matchesActivities(makeBeach(), [])).toBe(true);
  });

  it("requires the beach to offer every selected activity (AND semantics)", () => {
    const beach = makeBeach({ activities: ["water_sports", "snorkeling"] });
    expect(matchesActivities(beach, ["water_sports"])).toBe(true);
    expect(matchesActivities(beach, ["water_sports", "snorkeling"])).toBe(true);
    expect(matchesActivities(beach, ["water_sports", "beach_park"])).toBe(
      false,
    );
  });

  it("matches nothing when the beach lists no activities", () => {
    expect(matchesActivities(makeBeach({ activities: [] }), ["chill"])).toBe(
      false,
    );
  });
});

describe("planBeaches", () => {
  const nearBeach = makeBeach({
    id: "near",
    name: "Near Beach",
    latitude: 37.11,
    longitude: -8.68,
  });
  const farBeach = makeBeach({
    id: "far",
    name: "Far Beach",
    latitude: 37.089,
    longitude: -8.25,
  });
  const noCoordsBeach = makeBeach({
    id: "no-coords",
    name: "No Coords Beach",
    match: 99,
  });

  it("returns every beach sorted nearest-first by walk distance", () => {
    const planned = planBeaches([farBeach, nearBeach], LAGOS, {
      audience: "",
      activities: [],
    });
    expect(planned.map((entry) => entry.beach.id)).toEqual(["near", "far"]);
  });

  it("gives every beach walk distance+time and drive distance+time", () => {
    const planned = planBeaches([nearBeach], LAGOS, {
      audience: "",
      activities: [],
    });
    const travel = planned[0].travel;
    expect(travel).not.toBeNull();
    // Lagos -> Near Beach is roughly 0.8 km straight-line.
    expect(travel!.walkDistanceKm).toBeGreaterThan(0);
    expect(travel!.walkMinutes).toBe(
      Math.round((travel!.walkDistanceKm / 5) * 60),
    );
    expect(travel!.driveMinutes).toBeGreaterThanOrEqual(5);
  });

  it("sinks beaches without coordinates (or origin) to the end", () => {
    const planned = planBeaches([noCoordsBeach, farBeach, nearBeach], LAGOS, {
      audience: "",
      activities: [],
    });
    expect(planned.map((entry) => entry.beach.id)).toEqual([
      "near",
      "far",
      "no-coords",
    ]);
    expect(planned[2].travel).toBeNull();
  });

  it("degrades gracefully when no origin is set: keeps all beaches, no travel", () => {
    const planned = planBeaches([farBeach, nearBeach, noCoordsBeach], null, {
      audience: "",
      activities: [],
    });
    expect(planned).toHaveLength(3);
    for (const entry of planned) {
      expect(entry.travel).toBeNull();
    }
  });

  it("composes audience and activity filters (AND semantics)", () => {
    const sportyFamilyBeach = makeBeach({
      id: "sporty-family",
      latitude: 37.11,
      longitude: -8.68,
      activities: ["water_sports"],
    });
    const sportyPartyBeach = makeBeach({
      id: "sporty-party",
      latitude: 37.12,
      longitude: -8.7,
      activities: ["water_sports"],
      suitability: [
        { id: "families", label: "Families", value: "Poor", score: 0 },
        { id: "party", label: "Party", value: "Lively", score: 3 },
      ],
    });
    const planned = planBeaches([sportyPartyBeach, sportyFamilyBeach], LAGOS, {
      audience: "family",
      activities: ["water_sports"],
    });
    expect(planned.map((entry) => entry.beach.id)).toEqual(["sporty-family"]);
  });

  it("returns an empty list when the filters exclude every beach", () => {
    const planned = planBeaches([nearBeach, farBeach], LAGOS, {
      audience: "friends",
      activities: ["nudist"],
    });
    expect(planned).toEqual([]);
  });
});
