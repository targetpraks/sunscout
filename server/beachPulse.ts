/**
 * Beach Pulse — per-audience scoring core (server mirror).
 *
 * KEEP IN SYNC with src/pulse/scoring.ts — the server tree (rootDir: ".") cannot import from
 * src/ (server/tsconfig.json pins rootDir to server/), so the two modules are
 * deliberate duplicates. Any constant, weight, or formula change must be made
 * in both files; the parallel test suites assert the same fixed fixtures to
 * catch drift.
 *
 * Design contract (documented defaults and factors — tests assert these):
 *
 * 1. Conditions sub-score: weighted sum of seven per-signal range scores
 *    (0-1 each). Every signal is nullable; missing values fall back to
 *    MISSING_SIGNAL_DEFAULTS, which are chosen to be mildly positive but
 *    never perfect, and reduce confidence.
 *
 * 2. Condition staleness: a condition row older than CONDITION_STALE_HOURS
 *    (6h) — including a row with no observable age — has its conditions
 *    sub-score multiplied by STALE_CONDITION_FACTOR (0.85), i.e. a flat,
 *    documented 15% degradation. Freshness of conditions is reported in the
 *    breakdown as conditionFreshness (1 or STALE_CONDITION_FACTOR).
 *
 * 3. Community sub-score: mix of audience-MATCHING activity (check-ins in
 *    the last ACTIVITY_WINDOW_H), audience-matching vibe votes, and accuracy
 *    ratings. Missing vibe votes and accuracy ratings fall back to 50 (a
 *    documented neutral default); missing activity scores 0.
 *
 * 4. Audience-matched freshness decay: the community sub-score is multiplied
 *    by freshness(lastMatchingSignalAge). Within FRESHNESS_WINDOW_H (4h) the
 *    factor is 1.0; beyond it, it decays exponentially with the audience
 *    profile's half-life: 0.5 ^ ((age - window) / halfLifeH). A beach with no
 *    audience-matching signals decays to 0 community contribution — no
 *    matching check-ins means "not alive right now for this audience".
 *    This is strong enough that a stale-signal beach ranks below a
 *    fresh-signal beach even when the stale one's conditions are perfect.
 *
 * 5. Blend: score = blend.conditions * conditions + blend.community *
 *    community, with per-audience blend weights. Rounded and clamped to
 *    0-100 only at the very end; NaN-safe throughout (empty input yields a
 *    finite score, never NaN).
 *
 * 6. Confidence: 0.5 * (share of condition signals present) + 0.5 *
 *    freshness — an honest 0-1 estimate of how much live data backs the
 *    score.
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

export const CONDITION_STALE_HOURS = 6;
/** Documented degradation factor applied to the conditions sub-score once the row is older than 6h. */
export const STALE_CONDITION_FACTOR = 0.85;
/** Age (h) within which an audience-matching check-in/vote counts as fully fresh. */
export const FRESHNESS_WINDOW_H = 4;
/** Check-ins younger than this (h) count toward the activity sub-score. */
export const ACTIVITY_WINDOW_H = 6;
/** Documented neutral default for missing vibe votes and accuracy ratings (0-100). */
export const NEUTRAL_SIGNAL_SCORE = 50;

/** Documented, never-null fallbacks for missing condition signals — mild, never perfect. */
type ConditionDefaults = {
  [K in keyof Omit<ConditionSnapshot, "observedAt">]-?: number;
};

export const MISSING_SIGNAL_DEFAULTS: ConditionDefaults = {
  waveM: 0.6,
  windKmh: 15,
  waterTempC: 21,
  airTempC: 26,
  uvIndex: 5,
  crowdPct: 30,
  cloudPct: 25,
};

/** A per-signal scoring band: 1.0 inside [lo, hi], falling off linearly over tol outside. */
export type ScoreRange = {
  lo: number;
  hi: number;
  tol: number;
};

export type ConditionSignalWeights = {
  wave: number;
  wind: number;
  airTemp: number;
  waterTemp: number;
  uv: number;
  crowd: number;
  cloud: number;
};

export type AudienceProfile = {
  /** Per-signal scoring bands, shaped by what the audience wants. */
  ranges: {
    wave: ScoreRange;
    wind: ScoreRange;
    airTemp: ScoreRange;
    waterTemp: ScoreRange;
    uv: ScoreRange;
    crowd: ScoreRange;
    cloud: ScoreRange;
  };
  /** Per-signal weights within the conditions sub-score. Sum to 1. */
  conditionWeights: ConditionSignalWeights;
  /** Conditions vs community blend. Sums to 1. */
  blend: { conditions: number; community: number };
  /** Activity vs vibe vs accuracy mix inside the community sub-score. Sums to 1. */
  communityMix: { activity: number; vibe: number; accuracy: number };
  /** Half-life (h) of audience-matched freshness decay beyond the window. */
  freshnessHalfLifeH: number;
};

const range = (lo: number, hi: number, tol: number): ScoreRange => ({
  lo,
  hi,
  tol,
});

/**
 * Per-audience weight profiles. Family trades crowd and surf energy for calm
 * water, low wind, gentle sun; party/clubs trades calm for heat, sun and a
 * busy scene. All rows sum to 1 for both conditionWeights and blend.
 */
export const AUDIENCE_PROFILES: Record<PulseAudience, AudienceProfile> = {
  family: {
    ranges: {
      wave: range(0.15, 0.7, 1),
      wind: range(0, 16, 24),
      airTemp: range(22, 30, 10),
      waterTemp: range(20, 28, 8),
      uv: range(2, 6, 4),
      crowd: range(0, 45, 40),
      cloud: range(0, 35, 60),
    },
    conditionWeights: {
      wave: 0.25,
      wind: 0.2,
      airTemp: 0.15,
      waterTemp: 0.1,
      uv: 0.1,
      crowd: 0.1,
      cloud: 0.1,
    },
    blend: { conditions: 0.55, community: 0.45 },
    communityMix: { activity: 0.5, vibe: 0.35, accuracy: 0.15 },
    freshnessHalfLifeH: 12,
  },
  friends: {
    ranges: {
      wave: range(0.2, 1.1, 1.1),
      wind: range(0, 20, 24),
      airTemp: range(22, 32, 10),
      waterTemp: range(19, 27, 8),
      uv: range(2, 7, 4),
      crowd: range(40, 90, 45),
      cloud: range(0, 40, 60),
    },
    conditionWeights: {
      wave: 0.15,
      wind: 0.15,
      airTemp: 0.15,
      waterTemp: 0.1,
      uv: 0.1,
      crowd: 0.25,
      cloud: 0.1,
    },
    blend: { conditions: 0.5, community: 0.5 },
    communityMix: { activity: 0.5, vibe: 0.35, accuracy: 0.15 },
    freshnessHalfLifeH: 10,
  },
  solo: {
    ranges: {
      wave: range(0.2, 1, 1),
      wind: range(0, 18, 24),
      airTemp: range(21, 30, 10),
      waterTemp: range(19, 27, 8),
      uv: range(2, 6, 4),
      crowd: range(0, 40, 40),
      cloud: range(0, 40, 60),
    },
    conditionWeights: {
      wave: 0.15,
      wind: 0.25,
      airTemp: 0.15,
      waterTemp: 0.1,
      uv: 0.1,
      crowd: 0.15,
      cloud: 0.1,
    },
    blend: { conditions: 0.55, community: 0.45 },
    communityMix: { activity: 0.5, vibe: 0.35, accuracy: 0.15 },
    freshnessHalfLifeH: 12,
  },
  couples: {
    ranges: {
      wave: range(0.2, 0.9, 1),
      wind: range(0, 18, 24),
      airTemp: range(22, 31, 10),
      waterTemp: range(20, 28, 8),
      uv: range(2, 6, 4),
      crowd: range(10, 55, 45),
      cloud: range(0, 45, 60),
    },
    conditionWeights: {
      wave: 0.2,
      wind: 0.2,
      airTemp: 0.15,
      waterTemp: 0.15,
      uv: 0.1,
      crowd: 0.1,
      cloud: 0.1,
    },
    blend: { conditions: 0.6, community: 0.4 },
    communityMix: { activity: 0.5, vibe: 0.35, accuracy: 0.15 },
    freshnessHalfLifeH: 12,
  },
  party: {
    ranges: {
      wave: range(0.3, 1.3, 1.2),
      wind: range(0, 22, 24),
      airTemp: range(24, 33, 10),
      waterTemp: range(19, 28, 8),
      uv: range(3, 8, 4),
      crowd: range(55, 100, 45),
      cloud: range(0, 40, 60),
    },
    conditionWeights: {
      wave: 0.1,
      wind: 0.1,
      airTemp: 0.2,
      waterTemp: 0.1,
      uv: 0.1,
      crowd: 0.3,
      cloud: 0.1,
    },
    blend: { conditions: 0.4, community: 0.6 },
    communityMix: { activity: 0.5, vibe: 0.35, accuracy: 0.15 },
    freshnessHalfLifeH: 8,
  },
  chill: {
    ranges: {
      wave: range(0.1, 0.6, 0.8),
      wind: range(0, 14, 20),
      airTemp: range(21, 29, 10),
      waterTemp: range(19, 27, 8),
      uv: range(2, 6, 4),
      crowd: range(0, 35, 40),
      cloud: range(0, 45, 60),
    },
    conditionWeights: {
      wave: 0.25,
      wind: 0.25,
      airTemp: 0.15,
      waterTemp: 0.1,
      uv: 0.05,
      crowd: 0.1,
      cloud: 0.1,
    },
    blend: { conditions: 0.6, community: 0.4 },
    communityMix: { activity: 0.5, vibe: 0.35, accuracy: 0.15 },
    freshnessHalfLifeH: 16,
  },
};

export const AUDIENCE_LABELS: AudienceLabels = {
  family: "Families",
  friends: "Friends",
  solo: "Solo",
  couples: "Couples",
  party: "Party & clubs",
  chill: "Chill",
};

export type PulseOptions = {
  audience: PulseAudience;
  /** Injected clock — the module never reads the system clock, so tests are deterministic. */
  now: Date;
};

function num(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function rangeScore(x: number, r: ScoreRange): number {
  if (x < r.lo) return clamp01(1 - (r.lo - x) / r.tol);
  if (x > r.hi) return clamp01(1 - (x - r.hi) / r.tol);
  return 1;
}

/** Age in hours from `now` to an ISO timestamp. Null when missing or unparsable. */
function ageHours(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now.getTime() - t) / 3_600_000);
}

/**
 * Condition staleness factor: 1.0 within CONDITION_STALE_HOURS, else the
 * documented STALE_CONDITION_FACTOR. Unknown age (missing/unparsable
 * observedAt) is treated as stale — we never present unverifiable data as
 * fresh.
 */
export function conditionFreshnessFactor(ageH: number | null): number {
  if (ageH === null) return STALE_CONDITION_FACTOR;
  return ageH <= CONDITION_STALE_HOURS ? 1 : STALE_CONDITION_FACTOR;
}

/**
 * Audience-matched freshness factor (0-1). 1.0 within FRESHNESS_WINDOW_H,
 * then exponential decay with the profile's half-life. No matching signals
 * (null) decays to 0.
 */
export function freshnessFactor(
  ageH: number | null,
  halfLifeH: number,
): number {
  if (ageH === null) return 0;
  if (ageH <= FRESHNESS_WINDOW_H) return 1;
  return Math.pow(0.5, (ageH - FRESHNESS_WINDOW_H) / halfLifeH);
}

type ConditionScore = {
  /** Weighted 0-100 sub-score BEFORE the staleness factor. */
  raw: number;
  /** Staleness-factor-adjusted 0-100 sub-score. */
  adjusted: number;
  present: number;
  stale: boolean;
  ageH: number | null;
};

function scoreConditions(
  conditions: ConditionSnapshot | null | undefined,
  profile: AudienceProfile,
  now: Date,
): ConditionScore {
  const c = conditions ?? ({} as Partial<ConditionSnapshot>);
  const d = MISSING_SIGNAL_DEFAULTS;
  const present = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? 1 : 0;

  const w = profile.conditionWeights;
  const r = profile.ranges;
  const raw =
    100 *
    (w.wave * rangeScore(num(c.waveM, d.waveM), r.wave) +
      w.wind * rangeScore(num(c.windKmh, d.windKmh), r.wind) +
      w.airTemp * rangeScore(num(c.airTempC, d.airTempC), r.airTemp) +
      w.waterTemp * rangeScore(num(c.waterTempC, d.waterTempC), r.waterTemp) +
      w.uv * rangeScore(num(c.uvIndex, d.uvIndex), r.uv) +
      w.crowd * rangeScore(num(c.crowdPct, d.crowdPct), r.crowd) +
      w.cloud * rangeScore(num(c.cloudPct, d.cloudPct), r.cloud));

  const ageH = ageHours(c.observedAt, now);
  const stale = ageH === null || ageH > CONDITION_STALE_HOURS;
  const factor = conditionFreshnessFactor(ageH);
  return {
    raw,
    adjusted: raw * factor,
    present:
      present(c.waveM) +
      present(c.windKmh) +
      present(c.airTempC) +
      present(c.waterTempC) +
      present(c.uvIndex) +
      present(c.crowdPct) +
      present(c.cloudPct),
    stale,
    ageH,
  };
}

type CommunityScore = {
  /** 0-100 mix of activity, vibe and accuracy, BEFORE freshness decay. */
  raw: number;
  /** Freshness-decayed 0-100 sub-score. */
  adjusted: number;
  activity: number;
  vibe: number;
  accuracy: number;
  freshness: number;
  lastSignalAgeH: number | null;
};

function scoreCommunity(
  input: PulseInput,
  audience: PulseAudience,
  profile: AudienceProfile,
  now: Date,
): CommunityScore {
  const community = input.community ?? {};
  const checkIns = community.checkIns ?? [];
  const vibeVotes = community.vibeVotes ?? [];
  const accuracyRatings = community.accuracyRatings ?? [];

  const matchingCheckIns = checkIns.filter((s) => s.audience === audience);
  const matchingVotes = vibeVotes.filter((v) => v.audience === audience);

  // Activity: audience-matching check-ins within the activity window.
  // 1 recent check-in = 55, +15 per extra, capped at 100.
  const recent = matchingCheckIns.filter((s) => {
    const age = ageHours(s.at, now);
    return age !== null && age <= ACTIVITY_WINDOW_H;
  }).length;
  const activity = recent === 0 ? 0 : Math.min(100, 55 + 15 * (recent - 1));

  // Vibe: average of audience-matching votes, neutral default when absent.
  const vibe =
    matchingVotes.length > 0
      ? clampScore(
          matchingVotes.reduce(
            (sum, v) => sum + num(v.score, NEUTRAL_SIGNAL_SCORE),
            0,
          ) / matchingVotes.length,
        )
      : NEUTRAL_SIGNAL_SCORE;

  // Accuracy: share of "accurate" ratings, neutral default when absent.
  const accuracy =
    accuracyRatings.length > 0
      ? (100 * accuracyRatings.filter((r) => r.accurate).length) /
        accuracyRatings.length
      : NEUTRAL_SIGNAL_SCORE;

  // Freshness: age of the most recent audience-matching signal (check-in or vote).
  const signalAges = [...matchingCheckIns, ...matchingVotes]
    .map((s) => ageHours(s.at, now))
    .filter((a): a is number => a !== null);
  const lastSignalAgeH = signalAges.length > 0 ? Math.min(...signalAges) : null;
  const freshness = freshnessFactor(lastSignalAgeH, profile.freshnessHalfLifeH);

  const mix = profile.communityMix;
  const raw =
    mix.activity * activity + mix.vibe * vibe + mix.accuracy * accuracy;

  return {
    raw,
    adjusted: raw * freshness,
    activity,
    vibe,
    accuracy,
    freshness,
    lastSignalAgeH,
  };
}

function clampScore(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(100, Math.max(0, x));
}

/**
 * Compute the Beach Pulse for one beach, for one audience.
 * Pure: no I/O, no clock reads — pass `now`. Always returns a finite,
 * clamped 0-100 score.
 */
export function computePulse(
  input: PulseInput,
  opts: PulseOptions,
): PulseResult {
  const profile = AUDIENCE_PROFILES[opts.audience];
  const cond = scoreConditions(input.conditions, profile, opts.now);
  const comm = scoreCommunity(input, opts.audience, profile, opts.now);

  const breakdown: PulseBreakdown = {
    conditions: cond.adjusted,
    community: comm.adjusted,
    activity: comm.activity,
    vibe: comm.vibe,
    freshness: comm.freshness,
    conditionFreshness: cond.stale ? STALE_CONDITION_FACTOR : 1,
  };

  const raw =
    profile.blend.conditions * breakdown.conditions +
    profile.blend.community * breakdown.community;
  const score = clampScore(Math.round(raw));

  const confidence = clamp01(0.5 * (cond.present / 7) + 0.5 * comm.freshness);

  return {
    id: input.id,
    audience: opts.audience,
    score,
    confidence,
    staleConditions: cond.stale,
    conditionAgeH: cond.ageH,
    lastSignalAgeH: comm.lastSignalAgeH,
    breakdown,
  };
}

/**
 * Rank beaches for one audience: score desc, id asc as a stable tiebreak.
 * Never mutates the input array.
 */
export function rankByPulse(
  inputs: PulseInput[],
  opts: PulseOptions,
): PulseResult[] {
  return inputs
    .map((input) => computePulse(input, opts))
    .sort(
      (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** Display tier for a 0-100 Pulse score. */
export function badgeTier(score: number): "great" | "good" | "fair" | "poor" {
  const s = clampScore(score);
  if (s >= 75) return "great";
  if (s >= 55) return "good";
  if (s >= 35) return "fair";
  return "poor";
}

/** Human label for a 0-100 Pulse score. */
export function pulseLabel(score: number): string {
  const s = clampScore(score);
  if (s >= 75) return "Excellent";
  if (s >= 55) return "Good";
  if (s >= 35) return "Fair";
  return "Poor";
}
