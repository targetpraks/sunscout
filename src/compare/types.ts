/**
 * Beach compare — shared types and pure helpers.
 *
 * Pure data + logic only — no React imports — so node tests can exercise
 * every selection/scoring rule directly. The compare screen composes these
 * with `computePulse` (imported, never modified) from ../pulse and the
 * shared beach DTO from ../types.
 */

import { haversineKm, travelFor } from "../logic";
import type { Beach } from "../types";
import type { ConditionSnapshot, PulseInput } from "../pulse/types";

/** The compare surface supports 2–3 beaches side by side. */
export const MIN_COMPARE_BEACHES = 2;
export const MAX_COMPARE_BEACHES = 3;

/**
 * Client-side "current trip" draft. The server exposes no append endpoint —
 * `POST /api/me/trips` is create-with-beaches only — so compare rows upsert
 * into this draft (one tap, idempotent) and the draft is committed through
 * the existing create endpoint once, producing exactly one trip.
 */
export type TripDraft = {
  name: string;
  beachIds: string[];
};

/** Where the user is staying — drives the drive-distance row. */
export type Origin = {
  label: string;
  latitude: number;
  longitude: number;
};

/** The four amenity rows the compare surface always shows. */
export type CompareAmenityFlags = {
  parking: boolean;
  lifeguard: boolean;
  shade: boolean;
  beachClub: boolean;
};

export const COMPARE_AMENITY_LABELS: Record<keyof CompareAmenityFlags, string> =
  {
    parking: "Parking",
    lifeguard: "Lifeguard",
    shade: "Shade",
    beachClub: "Beach club",
  };

/**
 * Parse the leading number out of a display string the beaches API emits
 * ("22°C", "0.8 m", "30%", "5 Moderate"). Missing, "—" or non-numeric
 * values fall back to null — never NaN.
 */
export function parseDisplayNumber(
  value: string | null | undefined,
): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Build the numeric ConditionSnapshot computePulse needs from the display
 * strings on the Beach DTO. Every signal is nullable; missing values flow
 * into the documented MISSING_SIGNAL_DEFAULTS inside the scoring core.
 * observedAt comes from the condition provenance — an empty/missing value
 * is treated as stale by the scoring core, which is the honest default.
 */
export function toConditionSnapshot(beach: Beach): ConditionSnapshot {
  return {
    observedAt: beach.provenance?.observedAt ?? "",
    airTempC: parseDisplayNumber(beach.airTemp),
    waterTempC: parseDisplayNumber(beach.seaTemp),
    windKmh: parseDisplayNumber(beach.windSpeed),
    waveM: parseDisplayNumber(beach.waves),
    uvIndex: parseDisplayNumber(beach.uv),
    cloudPct: parseDisplayNumber(beach.cloudCover),
    crowdPct:
      typeof beach.crowd === "number" && Number.isFinite(beach.crowd)
        ? beach.crowd
        : null,
  };
}

/**
 * Pulse input for one beach. Community signals (audience-matched check-ins,
 * vibe votes with timestamps) are not part of the beaches DTO, so they are
 * passed as null: compare scores reflect live conditions only, and the
 * freshness decay zeroes the community contribution exactly as designed.
 */
export function toPulseInput(beach: Beach): PulseInput {
  return {
    id: beach.id,
    name: beach.name,
    conditions: toConditionSnapshot(beach),
    community: null,
  };
}

function hasAmenity(amenities: string[], pattern: RegExp): boolean {
  return amenities.some((amenity) => pattern.test(amenity));
}

/**
 * Tolerant amenity mapping for the four compare rows. The seed vocabulary
 * carries "Parking" and "Lifeguard" literally; "Shade" and "Beach club" are
 * derived (umbrella rentals / vibes / activities) because the seed never
 * spells them as amenities. Never throws on missing optional fields.
 */
export function amenityFlags(beach: Beach): CompareAmenityFlags {
  const amenities = (beach.amenities ?? []).map((amenity) =>
    amenity.toLowerCase(),
  );
  const vibes = (beach.vibes ?? []).map((vibe) => vibe.toLowerCase());
  const activities = beach.activities ?? [];
  return {
    parking: hasAmenity(amenities, /parking/),
    lifeguard: hasAmenity(amenities, /lifeguard/),
    shade:
      hasAmenity(amenities, /shade|umbrella|parasol/) ||
      (beach.available?.umbrellas ?? 0) > 0,
    beachClub:
      hasAmenity(amenities, /beach\s*club/) ||
      vibes.includes("beach clubs") ||
      activities.includes("beach_club"),
  };
}

export type DriveEstimate = {
  distanceKm: number;
  driveMinutes: number;
};

/**
 * Drive estimate from the user's origin. Prefers the server-populated
 * `travel` (present when the beaches were fetched with lat/lng) and falls
 * back to the same haversine + travelFor estimate the rest of the app uses.
 */
export function driveEstimate(
  origin: Origin | null,
  beach: Beach,
): DriveEstimate | null {
  if (origin == null) return null;
  if (beach.latitude == null || beach.longitude == null) return null;
  if (beach.travel) {
    return {
      distanceKm: beach.travel.distanceKm,
      driveMinutes: beach.travel.driveMinutes,
    };
  }
  const travel = travelFor(
    haversineKm(
      origin.latitude,
      origin.longitude,
      beach.latitude,
      beach.longitude,
    ),
  );
  return {
    distanceKm: travel.distanceKm,
    driveMinutes: travel.driveMinutes,
  };
}

export type ScoredId = { id: string; score: number };

/**
 * Ids tied at the highest finite score — every tied leader is highlighted.
 * Empty input (or no finite scores) highlights nothing.
 */
export function topScoreIds(scored: ScoredId[]): string[] {
  const finite = scored.filter((item) => Number.isFinite(item.score));
  if (finite.length === 0) return [];
  const max = Math.max(...finite.map((item) => item.score));
  return finite.filter((item) => item.score === max).map((item) => item.id);
}

/** Upsert a beach into the current-trip draft. Pure, idempotent, immutable. */
export function upsertBeachInDraft(
  draft: TripDraft,
  beachId: string,
): TripDraft {
  if (draft.beachIds.includes(beachId)) return draft;
  return { ...draft, beachIds: [...draft.beachIds, beachId] };
}

/** Name + location search used by the compare picker. Empty query returns all. */
export function filterByQuery(beaches: Beach[], query: string): Beach[] {
  const q = query.trim().toLowerCase();
  if (!q) return beaches;
  return beaches.filter((beach) => {
    const haystack = [beach.name, beach.location, ...(beach.vibes ?? [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
