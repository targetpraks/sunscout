/**
 * Day Outlook wire contract (client mirror of server/dayQuality.ts).
 *
 * KEEP IN SYNC with server/dayQuality.ts — the server tree cannot import
 * from src/ (server/tsconfig.json pins rootDir to server/), so the type and
 * the tier constants are deliberate duplicates. dayOutlook.test.ts asserts
 * the constants match the server module to catch drift.
 */

export type DayOutlookAudience =
  | "family"
  | "friends"
  | "solo"
  | "couples"
  | "party"
  | "chill";

export type DayTier = "go" | "wait" | "skip";

export const DAY_TIER_GO_MIN = 70;
export const DAY_TIER_WAIT_MIN = 45;

export const DAY_OUTLOOK_AUDIENCES: readonly DayOutlookAudience[] = [
  "family",
  "friends",
  "solo",
  "couples",
  "party",
  "chill",
];

export const DAY_TIER_LABELS: Record<DayTier, string> = {
  go: "Go",
  wait: "Wait",
  skip: "Skip",
};

/** Display labels per audience — mirrors AUDIENCE_LABELS in beachPulse.ts. */
export const DAY_AUDIENCE_LABELS: Record<DayOutlookAudience, string> = {
  family: "Families",
  friends: "Friends",
  solo: "Solo",
  couples: "Couples",
  party: "Party & clubs",
  chill: "Chill",
};

export type AudienceDayScore = {
  audience: DayOutlookAudience;
  score: number;
  tier: DayTier;
  confidence: number;
  staleConditions: boolean;
  breakdown: {
    conditions: number;
    community: number;
    activity: number;
    vibe: number;
    freshness: number;
    conditionFreshness: number;
  };
};

export type DayScoreCrowdPoint = {
  hour: number;
  crowd: number;
  eventBoost: boolean;
};

export type DayScore = {
  score: number;
  tier: DayTier;
  audience: DayOutlookAudience;
  audienceScores: AudienceDayScore[];
  crowdForecast: DayScoreCrowdPoint[];
  observedAt: string | null;
  computedAt: string;
  stale: boolean;
  activeEvents: string[];
};

/**
 * Honest staleness check for the UI: a score is only as fresh as the
 * condition row behind it. The server flags `stale` via the pulse 6h
 * threshold; the client additionally guards against a missing/unparsable
 * observedAt — never present unverifiable data as fresh.
 */
export function isStaleObservation(
  dayScore: Pick<DayScore, "stale" | "observedAt">,
): boolean {
  if (dayScore.stale) return true;
  if (!dayScore.observedAt) return true;
  const t = Date.parse(dayScore.observedAt);
  return !Number.isFinite(t);
}

export function tierFor(score: number): DayTier {
  const s = Math.min(100, Math.max(0, Number.isFinite(score) ? score : 0));
  if (s >= DAY_TIER_GO_MIN) return "go";
  if (s >= DAY_TIER_WAIT_MIN) return "wait";
  return "skip";
}
