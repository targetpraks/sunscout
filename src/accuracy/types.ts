export const ACCURACY_CONDITIONS = [
  "crowd",
  "waterQuality",
  "wind",
  "wave",
  "tide",
  "temperature",
] as const;

export type AccuracyCondition = (typeof ACCURACY_CONDITIONS)[number];

/** Below this per-condition aggregate score the UI shows a low-confidence badge. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Per-user-per-condition re-rating cooldown, in hours. */
export const RATING_COOLDOWN_HOURS = 24;

export type ConditionAccuracy = {
  condition: AccuracyCondition;
  /** Aggregate 0-1 accuracy score, or null when sample size is below the minimum. */
  score: number | null;
  sampleSize: number;
  lastRatedAt: string | null;
  /** The calling user's last rating time, used to drive the re-rating cooldown. */
  yourLastRatedAt: string | null;
};

export type BeachAccuracy = {
  beachId: string;
  conditions: ConditionAccuracy[];
};
