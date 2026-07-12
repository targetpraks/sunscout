import type { Beach } from "./types";

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

type Scored = { beach: Beach; score: number };

export function rankBeaches(
  beachCatalog: Beach[],
  query: string,
  filters: string[],
): Scored[] {
  const deferredQuery = query.toLowerCase();
  return beachCatalog
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
      let score = beach.match;
      if (deferredQuery && haystack.includes(deferredQuery)) score += 6;
      if (deferredQuery.includes("family") && haystack.includes("famil"))
        score += 8;
      if (deferredQuery.includes("party") && haystack.includes("party"))
        score += 10;
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
      return { beach, score: Math.min(score, 99) };
    })
    .sort((a, b) => b.score - a.score);
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
