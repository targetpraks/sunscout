import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { requireUser, resolveOptionalUser } from "./auth";
import { pool } from "./db";

export type Queryable = Pick<Pool | PoolClient, "query">;

export const ACCURACY_CONDITIONS = [
  "crowd",
  "waterQuality",
  "wind",
  "wave",
  "tide",
  "temperature",
] as const;

export type AccuracyCondition = (typeof ACCURACY_CONDITIONS)[number];

export const COOLDOWN_HOURS = 24;
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

const parsedMinSample = Number(process.env.ACCURACY_MIN_SAMPLE ?? 3);
export const DEFAULT_MIN_SAMPLE_SIZE =
  Number.isFinite(parsedMinSample) && parsedMinSample >= 1
    ? Math.floor(parsedMinSample)
    : 3;

export const accuracyRatingSchema = z.object({
  beachId: z.string().trim().min(1).max(100),
  condition: z.enum(ACCURACY_CONDITIONS),
  rating: z.number().min(0).max(1),
  userId: z.string().trim().min(1).max(80).optional(),
});

export type AccuracyRatingInput = z.infer<typeof accuracyRatingSchema>;

export type ConditionAccuracySummary = {
  condition: AccuracyCondition;
  /** Aggregate 0-1 accuracy score, or null when sample size is below the minimum. */
  score: number | null;
  sampleSize: number;
  lastRatedAt: string | null;
  yourLastRatedAt: string | null;
};

export type RecordRatingOutcome =
  | { ok: true; capturedAt: Date }
  | { ok: false; reason: "cooldown"; nextAllowedAt: Date };

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function conditionOrder(condition: AccuracyCondition): number {
  return ACCURACY_CONDITIONS.indexOf(condition);
}

/**
 * Resolves a beach by slug or public_id (uuid) to its internal id.
 * Accepts either identifier so the POST body and the GET path agree.
 */
export async function resolveBeachId(
  db: Queryable,
  identifier: string,
): Promise<number | null> {
  const result = await db.query(
    "select id from beach where slug = $1 or public_id::text = $1 limit 1",
    [identifier.trim()],
  );
  return result.rowCount ? Number(result.rows[0].id) : null;
}

/**
 * Stores a condition accuracy rating, enforcing the 24h per-user-per-condition
 * cooldown server-side (the UI cooldown is advisory only).
 */
export async function recordRating(
  db: Queryable,
  input: {
    userId: number;
    beachId: number;
    condition: AccuracyCondition;
    rating: number;
  },
): Promise<RecordRatingOutcome> {
  const recent = await db.query(
    `select captured_at from condition_accuracy_rating
     where user_id = $1 and beach_id = $2 and condition = $3
       and captured_at > now() - make_interval(hours => $4::int)`,
    [input.userId, input.beachId, input.condition, COOLDOWN_HOURS],
  );
  if (recent.rowCount) {
    const last = new Date(recent.rows[0].captured_at as string);
    return {
      ok: false,
      reason: "cooldown",
      nextAllowedAt: new Date(
        last.getTime() + COOLDOWN_HOURS * 60 * 60 * 1_000,
      ),
    };
  }
  const inserted = await db.query(
    `insert into condition_accuracy_rating(beach_id, user_id, condition, rating)
     values ($1, $2, $3, $4)
     returning captured_at`,
    [
      input.beachId,
      input.userId,
      input.condition,
      round3(Math.min(Math.max(input.rating, 0), 1)),
    ],
  );
  return {
    ok: true,
    capturedAt: new Date(inserted.rows[0].captured_at as string),
  };
}

/**
 * Aggregates per-condition accuracy for a beach. A condition with fewer
 * ratings than the minimum sample size gets a null score — never a
 * misleading low-sample average.
 */
export async function getBeachAccuracy(
  db: Queryable,
  beachId: number,
  options: { userId?: number | null; minSampleSize?: number } = {},
): Promise<ConditionAccuracySummary[]> {
  const minSample = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
  const aggregates = await db.query(
    `select condition,
       case when count(*) >= $2 then avg(rating) else null end as score,
       count(*)::int as sample_size,
       max(captured_at) as last_rated_at
     from condition_accuracy_rating
     where beach_id = $1
     group by condition`,
    [beachId, minSample],
  );

  const yourLast = new Map<string, string>();
  if (options.userId != null) {
    const yours = await db.query(
      `select condition, max(captured_at) as last_rated_at
       from condition_accuracy_rating
       where beach_id = $1 and user_id = $2
       group by condition`,
      [beachId, options.userId],
    );
    for (const row of yours.rows) {
      yourLast.set(
        row.condition as string,
        new Date(row.last_rated_at as string).toISOString(),
      );
    }
  }

  return aggregates.rows
    .map((row) => {
      const condition = row.condition as AccuracyCondition;
      const sampleSize = Number(row.sample_size);
      const raw = row.score == null ? null : Number(row.score);
      return {
        condition,
        score: sampleSize >= minSample && raw != null ? round3(raw) : null,
        sampleSize,
        lastRatedAt:
          row.last_rated_at == null
            ? null
            : new Date(row.last_rated_at as string).toISOString(),
        yourLastRatedAt: yourLast.get(condition) ?? null,
      };
    })
    .sort((a, b) => conditionOrder(a.condition) - conditionOrder(b.condition));
}

export const accuracyRouter = Router();

accuracyRouter.post("/api/accuracy", requireUser, async (request, response) => {
  const input = accuracyRatingSchema.parse(request.body ?? {});
  // The authenticated user is the source of truth; a mismatched body
  // userId is rejected so ratings cannot be credited to someone else.
  if (input.userId && input.userId !== request.userPublicId) {
    response.status(403).json({ error: "user_mismatch" });
    return;
  }
  const beachId = await resolveBeachId(pool, input.beachId);
  if (beachId == null) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const outcome = await recordRating(pool, {
    userId: request.userId as number,
    beachId,
    condition: input.condition,
    rating: input.rating,
  });
  if (!outcome.ok) {
    response.status(429).json({
      error: "cooldown_active",
      nextAllowedAt: outcome.nextAllowedAt.toISOString(),
    });
    return;
  }
  const conditions = await getBeachAccuracy(pool, beachId, {
    userId: request.userId,
  });
  response.status(201).json({
    data: {
      recorded: true,
      capturedAt: outcome.capturedAt.toISOString(),
      conditions,
    },
  });
});

accuracyRouter.get("/api/beaches/:id/accuracy", async (request, response) => {
  const beachId = await resolveBeachId(pool, request.params.id);
  if (beachId == null) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const userId = await resolveOptionalUser(request);
  const conditions = await getBeachAccuracy(pool, beachId, { userId });
  response.json({ data: { beachId: request.params.id, conditions } });
});
