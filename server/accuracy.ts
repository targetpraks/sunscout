import express from "express";
import { z } from "zod";
import { requireUser } from "./auth";
import { pool } from "./db";

/**
 * Condition-accuracy feedback loop (PRD 6.1 community signal).
 *
 * Users rate how accurate each published live condition is for a beach,
 * on a 1-5 star scale. Exactly one rating is persisted per
 * (user, beach, condition) — the latest rating wins. The aggregated
 * per-condition accuracy signal is exposed at GET /api/accuracy?beachId=
 * and is available to the Beach Pulse community mix.
 *
 * beachId is accepted as the beach slug or its public UUID — the same
 * identifier contract the front-end uses (beach.slug ?? beach.id).
 *
 * Auth scoping: POST requires a resolved user; GET is public, matching
 * the existing rating/feedback read endpoints.
 *
 * KEEP IN SYNC with src/accuracy/types.ts — ACCURACY_CONDITIONS,
 * ACCURATE_RATING_THRESHOLD and the aggregation math are deliberate
 * duplicates (the server tree cannot import from src/). The parallel test
 * suites assert the same fixed fixtures to catch drift.
 */

export const ACCURACY_CONDITIONS = [
  "crowd",
  "water_quality",
  "wind",
  "temperature",
  "cloud_cover",
] as const;

export type AccuracyCondition = (typeof ACCURACY_CONDITIONS)[number];

export const ACCURACY_RATING_MIN = 1;
export const ACCURACY_RATING_MAX = 5;
/** Ratings at or above this count as "accurate" in the aggregate signal. */
export const ACCURATE_RATING_THRESHOLD = 4;

export function isAccuracyCondition(
  value: unknown,
): value is AccuracyCondition {
  return (
    typeof value === "string" &&
    (ACCURACY_CONDITIONS as readonly string[]).includes(value)
  );
}

function isRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= ACCURACY_RATING_MIN &&
    value <= ACCURACY_RATING_MAX
  );
}

export type AccuracyRatingRow = { condition: string; rating: number };

export type AccuracySignalEntry = {
  condition: AccuracyCondition;
  ratingCount: number;
  /** Mean rating, 2 decimals. Null when no ratings exist — no data is not bad data. */
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

/**
 * Aggregate raw (condition, rating) rows into the per-condition accuracy
 * signal. Pure: unknown conditions and out-of-range ratings are dropped
 * defensively; empty input yields the honest degraded state (every
 * condition present, zero counts, null averages) rather than pretending
 * absence means a poor score.
 */
export function buildAccuracySignal(rows: unknown): AccuracySignal {
  const sums = new Map<
    AccuracyCondition,
    { count: number; accurate: number; total: number }
  >();
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as { condition?: unknown; rating?: unknown };
    if (!isAccuracyCondition(row.condition) || !isRating(row.rating)) continue;
    const current = sums.get(row.condition) ?? {
      count: 0,
      accurate: 0,
      total: 0,
    };
    sums.set(row.condition, {
      count: current.count + 1,
      accurate:
        current.accurate + (row.rating >= ACCURATE_RATING_THRESHOLD ? 1 : 0),
      total: current.total + row.rating,
    });
  }

  let totalRatings = 0;
  const signal: AccuracySignalEntry[] = ACCURACY_CONDITIONS.map((condition) => {
    const sum = sums.get(condition);
    totalRatings += sum?.count ?? 0;
    return {
      condition,
      ratingCount: sum?.count ?? 0,
      averageRating: sum
        ? Math.round((sum.total / sum.count) * 100) / 100
        : null,
      accuratePercent: sum
        ? Math.round((100 * sum.accurate) / sum.count)
        : null,
    };
  });
  return { state: totalRatings > 0 ? "ok" : "empty", totalRatings, signal };
}

type DbClient = { query: typeof pool.query };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the beach identifier (slug or public UUID) to the internal beach
 * id. Returns null when no beach matches.
 */
async function resolveBeachId(
  db: DbClient,
  beachId: string,
): Promise<number | null> {
  const bySlug = await db.query<{ id: number }>(
    "select id from beach where slug = $1",
    [beachId],
  );
  if (bySlug.rowCount) return bySlug.rows[0].id;
  if (UUID_PATTERN.test(beachId)) {
    const byPublicId = await db.query<{ id: number }>(
      "select id from beach where public_id = $1",
      [beachId],
    );
    if (byPublicId.rowCount) return byPublicId.rows[0].id;
  }
  return null;
}

async function aggregateSignal(
  db: DbClient,
  beachRowId: number,
): Promise<AccuracySignal> {
  const result = await db.query(
    "select condition, rating from condition_accuracy where beach_id = $1",
    [beachRowId],
  );
  return buildAccuracySignal(result.rows);
}

/**
 * Persist one rating per (user, beach, condition) — latest rating wins —
 * and return the refreshed aggregate signal. Null when the beach is
 * unknown.
 */
export async function recordAccuracy(
  db: DbClient,
  input: {
    userId: number;
    beachId: string;
    condition: AccuracyCondition;
    rating: number;
  },
): Promise<AccuracySignal | null> {
  const beachRowId = await resolveBeachId(db, input.beachId);
  if (beachRowId === null) return null;
  await db.query(
    `insert into condition_accuracy(user_id, beach_id, condition, rating)
     values ($1, $2, $3, $4)
     on conflict (user_id, beach_id, condition) do update
       set rating = excluded.rating, updated_at = now()`,
    [input.userId, beachRowId, input.condition, input.rating],
  );
  return aggregateSignal(db, beachRowId);
}

/**
 * Read the aggregated per-condition accuracy signal for a beach. Null when
 * the beach is unknown.
 */
export async function readAccuracySignal(
  db: DbClient,
  beachId: string,
): Promise<AccuracySignal | null> {
  const beachRowId = await resolveBeachId(db, beachId);
  if (beachRowId === null) return null;
  return aggregateSignal(db, beachRowId);
}

const ratingInputSchema = z.object({
  beachId: z.string().trim().min(1).max(200),
  condition: z.enum(ACCURACY_CONDITIONS),
  rating: z.number().int().min(ACCURACY_RATING_MIN).max(ACCURACY_RATING_MAX),
});

export const accuracyRouter = express.Router();

// Rating a condition requires a resolved user (auth-scoped).
accuracyRouter.post("/", requireUser, async (request, response) => {
  const parsed = ratingInputSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response
      .status(400)
      .json({ error: "invalid_request", issues: parsed.error.issues });
    return;
  }
  const signal = await recordAccuracy(pool, {
    userId: request.userId!,
    beachId: parsed.data.beachId,
    condition: parsed.data.condition,
    rating: parsed.data.rating,
  });
  if (!signal) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  response.status(201).json({
    data: {
      recorded: true,
      condition: parsed.data.condition,
      rating: parsed.data.rating,
      signal,
    },
  });
});

// The aggregate is safe to show anonymously, like the existing
// rating/feedback read endpoints.
accuracyRouter.get("/", async (request, response) => {
  const beachId = String(request.query.beachId ?? "").trim();
  if (!beachId) {
    response.status(400).json({ error: "beach_id_required" });
    return;
  }
  const signal = await readAccuracySignal(pool, beachId);
  if (!signal) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  response.json({ data: { beachId, ...signal } });
});
