/**
 * Near Me Now — pure geospatial ranking core.
 *
 * Standalone by convention (mirrors src/pulse): this module imports only
 * ../pulse/scoring (read-only, as the workstream brief allows), ../pulse/types
 * and ../types — never from shared shell files (src/logic.ts, src/api.ts,
 * src/App.tsx).
 *
 * Deliberate duplicates (same constants and formulas, kept locally so the
 * near-me surface owns its source of truth, exactly like src/pulse/scoring.ts
 * duplicates server/beachPulse.ts for the same reason):
 *   - haversineKm mirrors src/trip/distance.ts and src/logic.ts.
 *   - walk/drive estimates mirror travelEstimates() (src/trip/distance.ts)
 *     and travelFor() (src/logic.ts): walk 4.5 km/h, drive 0.55 km/min with
 *     a 5-minute floor.
 *   - beachToPulseInput mirrors beachToPulseInput() in src/api.ts: the Beach
 *     payload carries conditions as display strings ("0.6 m", "12 km/h"),
 *     which must be parsed into the numeric ConditionSnapshot the pulse
 *     scorer consumes. Missing/unparsable signals stay null so the scorer's
 *     documented MISSING_SIGNAL_DEFAULTS apply — never coerced to 0.
 */

import { computePulse } from "../pulse/scoring";
import type { PulseAudience, PulseInput } from "../pulse/types";
import type { Beach } from "../types";
import type { NearMeBeach, NearMeOrigin, NearMeTravel } from "./types";

const EARTH_RADIUS_KM = 6371;
/** Average walking speed in km/h — mirrors travelFor() in src/logic.ts. */
const WALK_SPEED_KMH = 4.5;
/** Kilometres per driving minute — mirrors server/providers/mapping.ts. */
const DRIVE_KM_PER_MINUTE = 0.55;
/** Minimum driving time in minutes — mirrors server/providers/mapping.ts. */
const MIN_DRIVE_MINUTES = 5;

/** Distance horizon of the near-me picker; matches the map's 60 km view. */
export const NEAR_ME_RADIUS_KM = 60;

/** Audience the right-now score is computed for unless the caller chooses one. */
export const DEFAULT_NEAR_ME_AUDIENCE: PulseAudience = "family";

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Haversine great-circle distance in kilometres. */
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
 * Walk and drive estimates from a straight-line haversine distance — same
 * model as the mapping adapter, so near-me rows stay consistent with
 * discovery and the trip planner until a real routing provider lands.
 */
export function nearMeTravel(distanceKm: number): NearMeTravel {
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    walkMinutes: Math.round((distanceKm / WALK_SPEED_KMH) * 60),
    driveMinutes: Math.max(
      MIN_DRIVE_MINUTES,
      Math.round(distanceKm / DRIVE_KM_PER_MINUTE),
    ),
  };
}

/**
 * Parse the leading number out of a display string ("19°C", "6 High",
 * "8 km/h"). Null when absent or unparsable — never NaN, which would poison
 * the scorer. Mirrors parseDisplayNumber in src/api.ts.
 */
function parseDisplayNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const match = /-?\d+(?:\.\d+)?/.exec(value);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Map one Beach row (display strings) onto a PulseInput condition snapshot.
 * Unparsable signals stay null so the scorer's documented defaults apply.
 * Mirrors beachToPulseInput in src/api.ts (deliberate duplicate).
 */
export function beachToPulseInput(beach: Beach): PulseInput {
  return {
    id: beach.id,
    name: beach.name,
    conditions: {
      observedAt: beach.provenance?.observedAt ?? "",
      waveM: parseDisplayNumber(beach.waves),
      windKmh: parseDisplayNumber(beach.windSpeed),
      waterTempC: parseDisplayNumber(beach.seaTemp),
      airTempC: parseDisplayNumber(beach.airTemp),
      uvIndex: parseDisplayNumber(beach.uv),
      crowdPct: Number.isFinite(beach.crowd) ? beach.crowd : null,
      cloudPct: parseDisplayNumber(beach.cloudCover),
    },
  };
}

/**
 * Blended ordering score: the right-now pulse weighted by a linear distance
 * decay inside NEAR_ME_RADIUS_KM — full weight at the doorstep, zero at the
 * horizon. A beach that is slightly farther but clearly better right now
 * outranks a near dud; a near dud never outranks a near gem.
 */
export function nearMeRankScore(
  pulseScore: number,
  distanceKm: number,
): number {
  const decay = 1 - Math.min(1, Math.max(0, distanceKm / NEAR_ME_RADIUS_KM));
  return pulseScore * decay;
}

/**
 * Rank the beach catalog around one origin for the Near Me Now list:
 * haversine distance, walk/drive estimates and the right-now Beach Pulse,
 * blended via nearMeRankScore. Beaches without coordinates or beyond
 * NEAR_ME_RADIUS_KM are left out (a geospatial picker cannot honestly place
 * them); an empty result is the panel's documented empty state, never a
 * crash. Ordering: rankScore desc, then distanceKm asc, then id asc as a
 * stable tiebreak (same convention as rankByPulse). Pure: deterministic for
 * a fixed (beaches, origin, audience, now); never mutates the input.
 */
export function rankNearMeBeaches(
  beaches: Beach[],
  origin: NearMeOrigin,
  audience: PulseAudience = DEFAULT_NEAR_ME_AUDIENCE,
  now: Date = new Date(),
): NearMeBeach[] {
  return beaches
    .filter(
      (beach) =>
        beach.latitude != null &&
        beach.longitude != null &&
        Number.isFinite(beach.latitude) &&
        Number.isFinite(beach.longitude),
    )
    .map((beach) => {
      const distanceKm = haversineKm(
        origin.latitude,
        origin.longitude,
        beach.latitude as number,
        beach.longitude as number,
      );
      const pulse = computePulse(beachToPulseInput(beach), {
        audience,
        now,
      });
      return {
        beach,
        distanceKm,
        travel: nearMeTravel(distanceKm),
        pulseScore: pulse.score,
        staleConditions: pulse.staleConditions,
        rankScore: nearMeRankScore(pulse.score, distanceKm),
      } satisfies NearMeBeach;
    })
    .filter((item) => item.distanceKm <= NEAR_ME_RADIUS_KM)
    .sort(
      (a, b) =>
        b.rankScore - a.rankScore ||
        a.distanceKm - b.distanceKm ||
        (a.beach.id < b.beach.id ? -1 : a.beach.id > b.beach.id ? 1 : 0),
    );
}
