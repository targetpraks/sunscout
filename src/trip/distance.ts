import type { Beach } from "../types";
import type {
  PlannedBeach,
  PlannerAudience,
  PlannerFilters,
  PlannerLocation,
  TravelEstimates,
} from "./types";

const EARTH_RADIUS_KM = 6371;
/**
 * Average walking speed in km/h — the locked trip-planner direction
 * (2026-06-22) specifies ~5 km/h. Deliberately diverges from travelFor() in
 * src/logic.ts (4.5 km/h), which keeps its own model so discovery and
 * logic.test.ts stay unchanged.
 */
const WALK_SPEED_KMH = 5;
/**
 * Average driving speed in km/h — the locked trip-planner direction
 * specifies ~40 km/h. Deliberately diverges from server/providers/mapping.ts
 * (~33 km/h) for the same reason.
 */
const DRIVE_SPEED_KMH = 40;
/** Minimum driving time in minutes — parking/access overhead on short hops. */
const MIN_DRIVE_MINUTES = 5;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Haversine great-circle distance in kilometres.
 *
 * Same formula as the mapping adapter (server/providers/mapping.ts) and
 * haversineKm() in src/logic.ts, kept here so the planner owns its distance
 * source of truth.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Walk and drive estimates from a straight-line haversine distance.
 *
 * Walk distance and drive distance both use the haversine estimate (no road
 * circuity factor) — identical to the current mapping adapter model, so the
 * planner stays consistent with discovery distances until a real routing
 * provider replaces it.
 */
export function travelEstimates(distanceKm: number): TravelEstimates {
  const rounded = Math.round(distanceKm * 10) / 10;
  return {
    walkDistanceKm: rounded,
    walkMinutes: Math.round((distanceKm / WALK_SPEED_KMH) * 60),
    driveDistanceKm: rounded,
    driveMinutes: Math.max(
      MIN_DRIVE_MINUTES,
      Math.round((distanceKm / DRIVE_SPEED_KMH) * 60),
    ),
  };
}

/**
 * Parse a typed "lat, lng" string (comma or whitespace separated) into a
 * planner origin. Returns null when the input is not a valid coordinate
 * pair so callers can surface a validation message instead of guessing.
 */
export function parseCoordinates(
  input: string,
): { latitude: number; longitude: number } | null {
  const tokens = input
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean);
  if (tokens.length !== 2) return null;
  const [latitude, longitude] = tokens.map((token) => Number.parseFloat(token));
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export const PLANNER_AUDIENCES: Array<{
  id: PlannerAudience;
  label: string;
}> = [
  { id: "family", label: "Family" },
  { id: "friends", label: "Friends" },
  { id: "clubs", label: "Clubs" },
  { id: "chill", label: "Chill" },
  { id: "solo", label: "Solo" },
];

const AUDIENCE_SUITABILITY_ID: Record<
  Exclude<PlannerAudience, "chill">,
  string
> = {
  family: "families",
  friends: "party",
  clubs: "clubs",
  solo: "solo",
};

/**
 * True when the beach suits the selected audience. Empty audience matches
 * every beach. See src/trip/types.ts for the audience -> suitability mapping.
 */
export function matchesAudience(
  beach: Beach,
  audience: PlannerAudience | "",
): boolean {
  if (!audience) return true;
  if (audience === "chill") {
    return (
      beach.vibes.some((vibe) => /quiet|calm/i.test(vibe)) ||
      (beach.activities ?? []).includes("chill")
    );
  }
  const suitabilityId = AUDIENCE_SUITABILITY_ID[audience];
  const score = beach.suitability.find(
    (item) => item.id === suitabilityId,
  )?.score;
  return (score ?? 0) >= 2;
}

/** True when the beach offers every selected activity. */
export function matchesActivities(beach: Beach, activities: string[]): boolean {
  return activities.every((activity) =>
    (beach.activities ?? []).includes(activity),
  );
}

/**
 * Distance-sorted planner results: every beach in the catalog filtered by
 * audience and activities, nearest first. Beaches without coordinates (or
 * when no origin is set) keep their place at the end of the list, ordered by
 * match score, so the planner degrades gracefully instead of hiding beaches.
 */
export function planBeaches(
  beaches: Beach[],
  origin: PlannerLocation | null,
  filters: PlannerFilters,
): PlannedBeach[] {
  return beaches
    .map((beach) => {
      const straightKm =
        origin != null && beach.latitude != null && beach.longitude != null
          ? haversineKm(
              origin.latitude,
              origin.longitude,
              beach.latitude,
              beach.longitude,
            )
          : null;
      return {
        beach,
        travel: straightKm != null ? travelEstimates(straightKm) : null,
      };
    })
    .filter(
      (planned) =>
        matchesAudience(planned.beach, filters.audience) &&
        matchesActivities(planned.beach, filters.activities),
    )
    .sort((a, b) => {
      if (a.travel && b.travel) {
        return (
          a.travel.walkDistanceKm - b.travel.walkDistanceKm ||
          b.beach.match - a.beach.match
        );
      }
      if (a.travel) return -1;
      if (b.travel) return 1;
      return b.beach.match - a.beach.match;
    });
}
