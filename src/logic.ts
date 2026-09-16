import type { Beach } from "./types";
import {
  CONDITION_STALE_HOURS,
  STALE_CONDITION_FACTOR,
  computePulse,
} from "./pulse/scoring";
import type { PulseAudience, PulseInput } from "./pulse/types";

export const FREE_RESULT_LIMIT = 3;
export const SAVED_LIMIT_FREE = 50;
export const SUNBED_UNIT_CENTS = 1200;
export const UMBRELLA_UNIT_CENTS = 800;
export const SERVICE_FEE_CENTS = 300;

export type RankingFilter =
  | "Family"
  | "Quiet"
  | "Party"
  | "Beach clubs"
  | "Low crowd";

/**
 * Audience vocabulary parsed from free-text queries. The string values match
 * the Beach Pulse audiences (src/pulse/types.ts PulseAudience) exactly, so a
 * parsed audience can be passed to computePulse unchanged.
 */
export type QueryAudience =
  | "family"
  | "friends"
  | "solo"
  | "couples"
  | "party"
  | "chill";

/**
 * Activity vocabulary parsed from free-text queries. Values are the
 * ACTIVITY_OPTIONS slugs below (the Discovery screen's activity chips), so a
 * parsed activity can be passed back through RankOptions.activities unchanged.
 * "nudist" is reachable only via the chips / RankOptions — nudist phrasing in
 * a query routes to the clothingOptional flag instead (see parseQuery).
 */
export type QueryActivity =
  | "water_sports"
  | "beach_park"
  | "beach_club"
  | "chill"
  | "snorkeling"
  | "nightlife"
  | "walking"
  | "photography"
  | "nudist";

/** Structured result of parsing a discovery query into filters. */
export type ParsedQuery = {
  /** Audience the query implies, if any. */
  audience: QueryAudience | null;
  /** Activities the query implies, in first-seen order, deduped. */
  activities: QueryActivity[];
  /** True for nudist / clothing-optional phrasing. */
  clothingOptional: boolean;
};

/** Vocabulary tables are ordered: first matching term wins the primary audience. */
const AUDIENCE_VOCAB: Array<[string, QueryAudience]> = [
  ["families", "family"],
  ["family", "family"],
  ["kids", "family"],
  ["children", "family"],
  ["friends", "friends"],
  ["group", "friends"],
  ["solo", "solo"],
  ["alone", "solo"],
  ["couples", "couples"],
  ["couple", "couples"],
  ["romantic", "couples"],
  ["date", "couples"],
  ["clubs", "party"],
  ["club", "party"],
  ["nightlife", "party"],
  ["party", "party"],
  ["chill", "chill"],
  ["relax", "chill"],
  ["quiet", "chill"],
];

const ACTIVITY_VOCAB: Array<[string, QueryActivity]> = [
  ["snorkeling", "snorkeling"],
  ["snorkel", "snorkeling"],
  ["surfing", "water_sports"],
  ["surf", "water_sports"],
  ["water sports", "water_sports"],
  ["beach park", "beach_park"],
  ["playground", "beach_park"],
  ["play", "beach_park"],
  ["beach clubs", "beach_club"],
  ["beach club", "beach_club"],
  ["clubs", "beach_club"],
  ["club", "beach_club"],
];

const CLOTHING_OPTIONAL_VOCAB = [
  "nudist",
  "nude",
  "naturist",
  "clothing optional",
  "clothing-optional",
  "topless",
  "fkk",
];

/** Word-boundary match so "date" does not hit "update", "play" not "display". */
function mentionsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

/**
 * Parse a discovery query into structured audience, activity and
 * clothing-optional filters. Plain queries containing none of the vocabulary
 * return { audience: null, activities: [], clothingOptional: false } and the
 * legacy ranking path applies unchanged.
 */
export function parseQuery(query: string): ParsedQuery {
  const raw = query.toLowerCase();
  const audiences = AUDIENCE_VOCAB.filter(([term]) =>
    mentionsTerm(raw, term),
  ).map(([, audience]) => audience);
  const activities = ACTIVITY_VOCAB.filter(([term]) => mentionsTerm(raw, term))
    .map(([, activity]) => activity)
    .filter((activity, index, all) => all.indexOf(activity) === index);
  const clothingOptional = CLOTHING_OPTIONAL_VOCAB.some((term) =>
    mentionsTerm(raw, term),
  );
  return {
    audience: audiences.length ? audiences[0] : null,
    activities,
    clothingOptional,
  };
}

/** How much the per-audience pulse score blends into the final rank (0-1). */
export const PULSE_BLEND_WEIGHT = 0.35;

/** Boost when the beach's suitability row for the parsed audience scores 3 (Excellent). */
const AUDIENCE_SUITABILITY_BOOST = 8;

/** Suitability row id per audience. Beaches without the row simply get no boost. */
const AUDIENCE_SUITABILITY_ID: Record<QueryAudience, string> = {
  family: "families",
  friends: "friends",
  solo: "solo",
  couples: "couples",
  party: "party",
  chill: "chill",
};

/**
 * Normalize a Discovery-screen audience slug (AUDIENCE_OPTIONS, e.g.
 * "families") to a QueryAudience pulse audience ("family"). Returns null for
 * unknown/empty slugs so callers can pass the result straight into
 * RankOptions.audience without a type mismatch at the UI boundary.
 */
const UI_SLUG_TO_AUDIENCE: Record<string, QueryAudience> = {
  families: "family",
  family: "family",
  friends: "friends",
  solo: "solo",
  couples: "couples",
  party: "party",
  chill: "chill",
};

export function toQueryAudience(uiSlug: string): QueryAudience | null {
  return UI_SLUG_TO_AUDIENCE[uiSlug.toLowerCase()] ?? null;
}

/**
 * Match-freshness decay for the match-score portion of the ranking. Reuses the
 * pulse contract: older than CONDITION_STALE_HOURS (or unverifiable) decays by
 * STALE_CONDITION_FACTOR. This is the ONLY decay applied here — the pulse term
 * applies its own condition-staleness factor internally (src/pulse/scoring.ts),
 * so staleness is never double-counted.
 */
function matchFreshnessFactor(beach: Beach, now: Date): number {
  const at = beach.conditionsUpdatedAt ?? beach.provenance?.observedAt;
  if (!at) return STALE_CONDITION_FACTOR;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return STALE_CONDITION_FACTOR;
  const ageH = Math.max(0, (now.getTime() - t) / 3_600_000);
  return ageH <= CONDITION_STALE_HOURS ? 1 : STALE_CONDITION_FACTOR;
}

/** Extract the leading numeric value from a display string like "0.5 m", "19°C", "6 High". */
function numFromDisplay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Map a Beach onto a PulseInput — condition display strings are parsed; community signals are left to the pulse owner (not part of the match loop). */
function toPulseInput(beach: Beach): PulseInput {
  return {
    id: beach.id,
    name: beach.name,
    conditions: {
      observedAt:
        beach.conditionsUpdatedAt ?? beach.provenance?.observedAt ?? "",
      waveM: numFromDisplay(beach.waves),
      windKmh: numFromDisplay(beach.windSpeed ?? beach.wind),
      waterTempC: numFromDisplay(beach.seaTemp),
      airTempC: numFromDisplay(beach.airTemp),
      uvIndex: numFromDisplay(beach.uv),
      crowdPct: beach.crowd,
      cloudPct: numFromDisplay(beach.cloudCover),
    },
  };
}

type Scored = { beach: Beach; score: number };

export type RankOptions = {
  /** Injected clock for freshness + pulse. Defaults to the current time. */
  now?: Date;
  /** Explicit audience override (e.g. from the Discovery screen's audience toggle). */
  audience?: QueryAudience | null;
  /** Explicit activity filter (e.g. from the Discovery screen's activity chips). */
  activities?: QueryActivity[];
  /** Explicit clothing-optional-only switch (e.g. from the Discovery screen's nudist toggle). */
  clothingOptionalOnly?: boolean;
};

export function rankBeaches(
  beachCatalog: Beach[],
  query: string,
  filters: string[],
  options: RankOptions = {},
): Scored[] {
  const deferredQuery = query.toLowerCase();
  const parsed = parseQuery(query);
  const now = options.now ?? new Date();
  const audience = options.audience ?? parsed.audience;
  const activities = options.activities ?? parsed.activities;
  const clothingOptionalOnly =
    options.clothingOptionalOnly ?? parsed.clothingOptional;

  return beachCatalog
    .filter((beach) => {
      if (clothingOptionalOnly && !beach.allowsNudism) return false;
      if (activities.length > 0) {
        const beachActivities = beach.activities ?? [];
        return activities.every((activity) =>
          beachActivities.includes(activity),
        );
      }
      return true;
    })
    .map((beach) => {
      const haystack = [
        beach.name,
        beach.decision,
        beach.vibes.join(" "),
        beach.suitability
          .map((item) => `${item.label} ${item.value}`)
          .join(" "),
      ]
        .join(" ")
        .toLowerCase();
      let score = beach.match * matchFreshnessFactor(beach, now);
      if (deferredQuery && haystack.includes(deferredQuery)) score += 6;
      if (deferredQuery.includes("family") && haystack.includes("famil"))
        score += 8;
      if (deferredQuery.includes("party") && haystack.includes("party"))
        score += 10;

      // Per-audience blend with the Beach Pulse. QueryAudience values equal
      // PulseAudience values, so the parsed audience passes straight through.
      // The pulse applies its own condition-staleness decay internally; the
      // match-freshness factor above covers only the match-score portion.
      if (audience) {
        const pulse = computePulse(toPulseInput(beach), {
          audience: audience as PulseAudience,
          now,
        });
        score =
          score * (1 - PULSE_BLEND_WEIGHT) + pulse.score * PULSE_BLEND_WEIGHT;
        const suit = beach.suitability.find(
          (item) => item.id === AUDIENCE_SUITABILITY_ID[audience],
        );
        if (suit && suit.score === 3) score += AUDIENCE_SUITABILITY_BOOST;
      }

      if (filters.includes("Low crowd") && beach.crowd < 50) score += 9;
      if (filters.includes("Beach clubs")) score += beach.available.clubs * 2;
      if (filters.includes("Quiet") && beach.vibes.includes("Quiet"))
        score += 8;
      if (
        filters.includes("Family") &&
        beach.suitability.find((item) => item.id === "families")?.score === 3
      )
        score += 8;
      if (
        filters.includes("Party") &&
        beach.suitability.find((item) => item.id === "party")?.score === 3
      )
        score += 8;

      // Round to 2 decimals so equal-valued fixtures tie exactly and the id
      // tie-break below is exercised; the sort stays deterministic.
      return { beach, score: Math.min(Math.round(score * 100) / 100, 99) };
    })
    .sort((a, b) => b.score - a.score || (a.beach.id < b.beach.id ? -1 : 1));
}

export function bookingTotalCents(sunbeds: number, umbrellas: number): number {
  return (
    sunbeds * SUNBED_UNIT_CENTS +
    umbrellas * UMBRELLA_UNIT_CENTS +
    SERVICE_FEE_CENTS
  );
}

export function bookingTotalEuros(sunbeds: number, umbrellas: number): number {
  return bookingTotalCents(sunbeds, umbrellas) / 100;
}

export type EntitlementResult = { ok: boolean; reason?: string };

export function canSaveBeach(
  savedCount: number,
  isPremium: boolean,
): EntitlementResult {
  if (!isPremium && savedCount >= SAVED_LIMIT_FREE) {
    return { ok: false, reason: `saved_limit_${SAVED_LIMIT_FREE}` };
  }
  return { ok: true };
}

export function canCreateTrip(
  activeTripCount: number,
  isPremium: boolean,
): EntitlementResult {
  if (!isPremium && activeTripCount >= 1) {
    return { ok: false, reason: "active_trip_limit_1" };
  }
  return { ok: true };
}

export function discoveryFreeResults<T>(results: T[], isPremium: boolean): T[] {
  return isPremium ? results : results.slice(0, FREE_RESULT_LIMIT);
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const radiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

export function travelFor(distanceKm: number): {
  distanceKm: number;
  walkMinutes: number;
  driveMinutes: number;
} {
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    walkMinutes: Math.round((distanceKm / 4.5) * 60),
    driveMinutes: Math.max(5, Math.round(distanceKm / 0.55)),
  };
}

export const AUDIENCE_OPTIONS = [
  "families",
  "friends",
  "solo",
  "couples",
  "party",
] as const;

export const ACTIVITY_OPTIONS = [
  "water_sports",
  "beach_park",
  "beach_club",
  "chill",
  "snorkeling",
  "nightlife",
  "walking",
  "photography",
  "nudist",
] as const;

export const PRESET_LOCATIONS: Array<{
  label: string;
  latitude: number;
  longitude: number;
}> = [
  { label: "Lagos", latitude: 37.103, longitude: -8.674 },
  { label: "Albufeira", latitude: 37.089, longitude: -8.25 },
  { label: "Portimão", latitude: 37.139, longitude: -8.538 },
  { label: "Sagres", latitude: 37.0, longitude: -8.94 },
  { label: "Faro", latitude: 37.019, longitude: -7.93 },
];
