/**
 * Beach Pulse — per-audience ranking types (client).
 *
 * This module is intentionally standalone: Pulse components must not import
 * from shared shell files (src/types.ts, src/logic.ts, src/App.tsx, ...).
 * The server mirror lives in server/beachPulse.ts and duplicates these types
 * because server/tsconfig.json (rootDir: "server") forbids cross-tree imports.
 */

export type PulseAudience =
  | "family"
  | "friends"
  | "solo"
  | "couples"
  | "party"
  | "chill";

/** Display label per audience, e.g. "family" -> "Families". */
export type AudienceLabels = Record<PulseAudience, string>;

/** One live-condition row. Every signal is nullable — missing values fall back to documented defaults. */
export type ConditionSnapshot = {
  /** ISO timestamp of when this row was observed. */
  observedAt: string;
  waveM?: number | null;
  windKmh?: number | null;
  waterTempC?: number | null;
  airTempC?: number | null;
  uvIndex?: number | null;
  /** How busy the beach is right now, 0-100. */
  crowdPct?: number | null;
  cloudPct?: number | null;
};

/** A check-in or sighting at the beach, tagged with the audience it belongs to. */
export type CheckInSignal = {
  audience: PulseAudience;
  at: string;
  kind?: "check-in" | "sighting";
};

/** A "what's the vibe like" vote for a given audience, scored 0-100. */
export type VibeVote = {
  audience: PulseAudience;
  at: string;
  score: number;
};

/** A user accuracy rating of a published condition row. */
export type AccuracyRating = {
  at: string;
  accurate: boolean;
};

export type CommunitySignals = {
  checkIns?: CheckInSignal[];
  vibeVotes?: VibeVote[];
  accuracyRatings?: AccuracyRating[];
};

/** Everything one beach contributes to a Pulse computation. */
export type PulseInput = {
  id: string;
  name?: string;
  conditions?: ConditionSnapshot | null;
  community?: CommunitySignals | null;
};

export type PulseBreakdown = {
  /** Condition sub-score after staleness degradation, 0-100. */
  conditions: number;
  /** Community sub-score after audience-matched freshness decay, 0-100. */
  community: number;
  /** Audience-matching check-in activity in the activity window, 0-100. */
  activity: number;
  /** Average audience-matching vibe vote, 0-100. */
  vibe: number;
  /** Audience-matched freshness multiplier, 0-1 (0 when no matching signals). */
  freshness: number;
  /** Condition staleness multiplier, 0-1. */
  conditionFreshness: number;
  /**
   * Live-now multiplier applied to the blended score, 0.8-1.05. Boosted
   * (>= 1.05) while any sighting or check-in is younger than 2h; decays to
   * 0.8 once the newest signal is 24h old or older (or there are none).
   */
  liveNow: number;
};

export type PulseResult = {
  id: string;
  audience: PulseAudience;
  /** Bounded, clamped 0-100 integer. Always finite. */
  score: number;
  /** 0-1 estimate of how much real data backs the score. */
  confidence: number;
  staleConditions: boolean;
  conditionAgeH: number | null;
  lastSignalAgeH: number | null;
  /** Age (h) of the most recent sighting/check-in from ANY audience, null when none. */
  lastLiveSignalAgeH: number | null;
  breakdown: PulseBreakdown;
};

/** Flat display item consumed by PulseLeaderboard / PulseBadge — pure props, no scoring import needed. */
export type PulseRankedItem = {
  id: string;
  name: string;
  region?: string;
  score: number;
  staleConditions?: boolean;
};
