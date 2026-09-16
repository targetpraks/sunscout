/**
 * Near Me Now — types for the geospatial beach picker rendered from BeachMap.
 *
 * Standalone by convention (mirrors src/pulse): nearme files import only from
 * this folder, ../pulse/scoring (read-only), ../pulse/types and ../types —
 * never from shared shell files (src/logic.ts, src/api.ts, src/App.tsx).
 */

import type { Beach } from "../types";
import type { PulseAudience } from "../pulse/types";

/** A lat/lng the near-me list is ranked against. */
export type NearMeOrigin = {
  latitude: number;
  longitude: number;
  /** How the origin was obtained — browser geolocation or manual entry. */
  source: "geolocation" | "manual";
};

/** Lifecycle of the browser geolocation request powering the panel. */
export type GeolocationStatus =
  | "idle"
  | "locating"
  | "ready"
  | "denied"
  | "unavailable"
  | "error";

/** Walk/drive estimates derived from a haversine straight-line distance. */
export type NearMeTravel = {
  /** Straight-line distance in km, rounded to 0.1 km. */
  distanceKm: number;
  walkMinutes: number;
  driveMinutes: number;
};

/** One ranked beach in the near-me list — pure data, consumed by the rows. */
export type NearMeBeach = {
  beach: Beach;
  /** Haversine distance from the origin in km. */
  distanceKm: number;
  travel: NearMeTravel;
  /** Beach Pulse right-now score (0-100) computed from the live condition fields. */
  pulseScore: number;
  /** True when the condition row is older than the pulse 6h staleness window. */
  staleConditions: boolean;
  /**
   * Blended 0-100 ordering score: pulse score weighted against distance decay
   * inside NEAR_ME_RADIUS_KM. See nearMeRankScore() for the documented blend.
   */
  rankScore: number;
};

/** Audience the right-now score is computed for. */
export type NearMeAudience = PulseAudience;
