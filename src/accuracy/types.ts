/**
 * Condition-accuracy feedback loop — front-end types and pure helpers.
 *
 * KEEP IN SYNC with server/accuracy.ts: ACCURACY_CONDITIONS,
 * ACCURATE_RATING_THRESHOLD, the rating bounds and the aggregation math
 * are deliberate duplicates (the server tree cannot import from src/).
 * The parallel test suites assert the same fixed fixtures to catch drift.
 */

export const ACCURACY_CONDITIONS = [
  "crowd",
  "water_quality",
  "wind",
  "temperature",
  "cloud_cover",
] as const;

export type AccuracyCondition = (typeof ACCURACY_CONDITIONS)[number];

export const ACCURACY_CONDITION_LABELS: Record<AccuracyCondition, string> = {
  crowd: "Crowd",
  water_quality: "Water quality",
  wind: "Wind",
  temperature: "Temperature",
  cloud_cover: "Cloud cover",
};

export const ACCURACY_RATING_MIN = 1;
export const ACCURACY_RATING_MAX = 5;
/** Ratings at or above this count as "accurate". */
export const ACCURATE_RATING_THRESHOLD = 4;

export type AccuracySignalEntry = {
  condition: AccuracyCondition;
  ratingCount: number;
  /** Mean rating, 2 decimals. Null when no ratings exist. */
  averageRating: number | null;
  /** Share of ratings at/above ACCURATE_RATING_THRESHOLD, 0-100. Null when no ratings. */
  accuratePercent: number | null;
};

export type AccuracySignal = {
  state: "ok" | "empty";
  totalRatings: number;
  /** One entry per known condition, in canonical order — never sparse. */
  signal: AccuracySignalEntry[];
};

/** The honest degraded state: every condition present, zero counts, null averages. */
export function emptyAccuracySignal(): AccuracySignal {
  return {
    state: "empty",
    totalRatings: 0,
    signal: ACCURACY_CONDITIONS.map((condition) => ({
      condition,
      ratingCount: 0,
      averageRating: null,
      accuratePercent: null,
    })),
  };
}

/** Entry for a condition, defaulting to the honest zeroed shape when missing. */
export function entryFor(
  signal: AccuracySignal,
  condition: AccuracyCondition,
): AccuracySignalEntry {
  return (
    signal.signal.find((entry) => entry.condition === condition) ?? {
      condition,
      ratingCount: 0,
      averageRating: null,
      accuratePercent: null,
    }
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Optimistically merge one newly submitted rating into the displayed
 * aggregate. Display-only: the server response returned by the submit is
 * authoritative and replaces this merge once it lands.
 */
export function applyRatingToSignal(
  signal: AccuracySignal,
  condition: AccuracyCondition,
  rating: number,
): AccuracySignal {
  if (
    !Number.isInteger(rating) ||
    rating < ACCURACY_RATING_MIN ||
    rating > ACCURACY_RATING_MAX
  ) {
    return signal;
  }
  const signalEntries = ACCURACY_CONDITIONS.map((key) => {
    const entry = entryFor(signal, key);
    if (key !== condition) return entry;
    const count = entry.ratingCount;
    const accurateCount =
      Math.round(((entry.accuratePercent ?? 0) * count) / 100) +
      (rating >= ACCURATE_RATING_THRESHOLD ? 1 : 0);
    const newCount = count + 1;
    return {
      condition: key,
      ratingCount: newCount,
      averageRating: round2(
        ((entry.averageRating ?? 0) * count + rating) / newCount,
      ),
      accuratePercent: Math.round((100 * accurateCount) / newCount),
    };
  });
  return {
    state: "ok",
    totalRatings: signal.totalRatings + 1,
    signal: signalEntries,
  };
}

/** Short aggregate description for one condition, e.g. "3.7 avg · 67% accurate · 3 ratings". */
export function metaLine(entry: AccuracySignalEntry): string {
  if (entry.ratingCount === 0 || entry.averageRating == null) {
    return "Not rated yet";
  }
  const ratings = `${entry.ratingCount} ${entry.ratingCount === 1 ? "rating" : "ratings"}`;
  if (entry.accuratePercent == null) {
    return `${entry.averageRating.toFixed(1)} avg · ${ratings}`;
  }
  return `${entry.averageRating.toFixed(1)} avg · ${entry.accuratePercent}% accurate · ${ratings}`;
}
