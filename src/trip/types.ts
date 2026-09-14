import type { Beach } from "../types";

/**
 * Audience vocabulary for the trip planner.
 *
 * The durable product direction (2026-06-22) asks for
 * family / friends / clubs / chill / solo. Beach suitability data only carries
 * ids families / solo / couples / party / clubs (every beach has every row),
 * so audiences are matched by suitability score, and two requested audiences
 * need an explicit mapping:
 *
 * - family  -> suitability id "families" with score >= 2
 * - friends -> suitability id "party" with score >= 2 (a lively group day)
 * - clubs   -> suitability id "clubs" with score >= 2 (beach clubs)
 * - chill   -> vibe tags matching quiet/calm, or the "chill" activity
 * - solo    -> suitability id "solo" with score >= 2
 */
export type PlannerAudience = "family" | "friends" | "clubs" | "chill" | "solo";

export type PlannerLocation = {
  label: string;
  latitude: number;
  longitude: number;
};

/**
 * Walk/drive estimates from a haversine straight-line distance.
 *
 * Both walk and drive distance share the haversine estimate — the same model
 * as the current mapping adapter (server/providers/mapping.ts) and
 * travelFor() in src/logic.ts. Swap for Mapbox/OSRM once the mapping
 * provider is licensed.
 */
export type TravelEstimates = {
  walkDistanceKm: number;
  walkMinutes: number;
  driveDistanceKm: number;
  driveMinutes: number;
};

export type PlannedBeach = {
  beach: Beach;
  travel: TravelEstimates | null;
};

export type PlannerFilters = {
  audience: PlannerAudience | "";
  activities: string[];
};

/** SessionStorage key used to hand a planner beach pick to the App shell. */
export const PLANNER_OPEN_BEACH_KEY = "sunscout:open-beach";
