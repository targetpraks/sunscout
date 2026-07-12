import type { Pool } from "pg";
import { listBeaches } from "./beaches";

type ConciergeResult = {
  beach: Record<string, unknown>;
  score: number;
  reasons: string[];
};

const KEYWORDS: Record<string, string[]> = {
  families: ["family", "kid", "child", "toddler", "stroller", "safe", "calm"],
  solo: ["solo", "alone", "quiet", "peaceful", "meditate", "read"],
  couples: ["couple", "romantic", "date", "partner", "anniversary"],
  party: ["party", "club", "social", "drink", "nightlife", "lively"],
  friends: ["friend", "group", "crew", "mates", "buddies"],
  water_sports: ["water sport", "surf", "kayak", "paddle", "snorkel", "dive"],
  beach_park: ["play", "park", "kids play", "sandbox", "playground"],
  beach_club: ["club", "lounge", "sunbed", "vip", "service"],
  chill: ["chill", "relax", "lazy", "sunbathe", "peaceful"],
  nudist: ["nudist", "clothing", "clothing-optional", "nude", "bare"],
  snorkeling: ["snorkel", "fish", "underwater", "clear water"],
  nightlife: ["night", "bar", "drink", "party", "club"],
  walking: ["walk", "hike", "long", "stroll", "promenade"],
  photography: ["photo", "scenic", "view", "cliff", "iconic"],
  low_crowd: ["quiet", "empty", "uncrowded", "secluded", "hidden", "deserted"],
  accessible: ["wheelchair", "accessible", "disability", "ramp", "mobility"],
  pet: ["dog", "pet", "pet-friendly"],
};

export async function concierge(
  pool: Pool,
  query: string,
  origin?: { latitude: number; longitude: number } | null,
  userId?: number | null,
): Promise<ConciergeResult[]> {
  const q = query.toLowerCase();
  const matchedAudiences: string[] = [];
  const matchedActivities: string[] = [];
  let wantsLowCrowd = false;
  let wantsNudist = false;

  for (const [key, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => q.includes(w))) {
      if (["families", "solo", "couples", "party", "friends"].includes(key)) {
        matchedAudiences.push(key);
      } else if (key === "low_crowd") {
        wantsLowCrowd = true;
      } else if (key === "nudist") {
        wantsNudist = true;
      } else {
        matchedActivities.push(key);
      }
    }
  }

  const beaches = await listBeaches(pool, userId, origin);

  const results: ConciergeResult[] = beaches
    .map((beach: Record<string, unknown>) => {
      let score = Number(beach.match ?? 0);
      const reasons: string[] = [];

      const suitability = (beach.suitability ?? []) as Array<{
        id: string;
        score?: number;
      }>;
      for (const audience of matchedAudiences) {
        const s = suitability.find((item) => item.id === audience);
        if (s && Number(s.score ?? 0) >= 2) {
          score += 12;
          reasons.push(`Great for ${audience}`);
        }
      }

      const activities = (beach.activities ?? []) as string[];
      for (const activity of matchedActivities) {
        if (activities.includes(activity)) {
          score += 10;
          reasons.push(`Has ${activity.replace(/_/g, " ")}`);
        }
      }

      if (wantsLowCrowd && Number(beach.crowd ?? 0) < 50) {
        score += 8;
        reasons.push(`Low crowd (${beach.crowd}%)`);
      }

      if (wantsNudist && beach.allowsNudism) {
        score += 15;
        reasons.push("Clothing-optional");
      }

      if (origin && beach.travel) {
        const travel = beach.travel as {
          distanceKm: number;
          walkMinutes: number;
          driveMinutes: number;
        };
        score += Math.max(0, 15 - travel.distanceKm);
        if (travel.walkMinutes <= 30) {
          reasons.push(`Walking distance (${travel.walkMinutes} min walk)`);
        } else if (travel.driveMinutes <= 20) {
          reasons.push(`Short drive (${travel.driveMinutes} min)`);
        }
      }

      if (beach.waterQuality === "Excellent" || beach.waterQuality === "Good") {
        score += 3;
        if (matchedActivities.includes("snorkeling")) {
          reasons.push(`${beach.waterQuality} water quality`);
        }
      }

      if (
        beach.blueFlag &&
        (beach.provenance as { blueFlag?: boolean })?.blueFlag
      ) {
        score += 2;
      }

      return { beach, score: Math.min(score, 99), reasons };
    })
    .filter((r) => r.reasons.length > 0 || r.score > 70)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return results;
}
