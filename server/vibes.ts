import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { requireUser, resolveOptionalUser } from "./auth";
import { pool } from "./db";

type Queryable = Pick<Pool | PoolClient, "query">;

export const VIBE_TAGS = [
  "chill",
  "party",
  "family",
  "romantic",
  "hidden-gem",
  "beach-club",
] as const;

// Superset of the beach_suitability audience ids (families, solo, couples,
// party, clubs) and the per-audience leaderboard scopes from the product
// direction (friends, chill, beach-club) so every Pulse leaderboard bucket
// can be keyed from a vote.
export const AUDIENCE_TAGS = [
  "families",
  "friends",
  "solo",
  "couples",
  "party",
  "clubs",
  "chill",
  "beach-club",
] as const;

export type VibeTag = (typeof VIBE_TAGS)[number];
export type AudienceTag = (typeof AUDIENCE_TAGS)[number];

export const COOLDOWN_MS = 24 * 60 * 60 * 1_000;
export const VOTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

const round3 = (value: number) => Math.round(value * 1_000) / 1_000;

// ---------------------------------------------------------------------------
// Pure logic (clock-injected so unit tests never need a database)
// ---------------------------------------------------------------------------

export type WeightedVibeVote = {
  vibe: string;
  audienceTag: string;
  createdAtMs: number;
};

export type VibeTally = {
  tag: string;
  votes: number;
  weight: number;
  share: number;
};

export type BeachVibesAggregate = {
  beachId: string;
  totalVotes: number;
  windowStartMs: number;
  computedAtMs: number;
  vibes: VibeTally[];
  audiences: VibeTally[];
};

/** Linear time decay: weight 1.0 when just cast, 0.0 at the 7-day window edge. */
export function decayWeight(voteCreatedAtMs: number, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - voteCreatedAtMs);
  const remaining = 1 - ageMs / VOTE_WINDOW_MS;
  return round3(Math.min(1, Math.max(0, remaining)));
}

/** Milliseconds until the 24h per-user-per-beach cooldown lifts (>= 0). */
export function cooldownRemainingMs(
  lastVotedAtMs: number,
  nowMs: number,
): number {
  return Math.max(0, lastVotedAtMs + COOLDOWN_MS - nowMs);
}

export type CooldownEvaluation = {
  allowed: boolean;
  cooldownRemainingMs: number;
  nextAllowedAtMs: number;
};

export function evaluateVibeVote(
  lastVotedAtMs: number,
  nowMs: number,
): CooldownEvaluation {
  const remaining = cooldownRemainingMs(lastVotedAtMs, nowMs);
  return {
    allowed: remaining === 0,
    cooldownRemainingMs: remaining,
    nextAllowedAtMs: lastVotedAtMs + COOLDOWN_MS,
  };
}

function tally(
  entries: Map<string, { votes: number; weight: number }>,
  totalWeight: number,
): VibeTally[] {
  // Accumulate raw, round once — per-step rounding is order-sensitive and
  // would make aggregates non-deterministic for identical vote sets.
  return [...entries.entries()]
    .map(([tag, { votes, weight }]) => ({
      tag,
      votes,
      weight: round3(weight),
      share: totalWeight > 0 ? round3(weight / totalWeight) : 0,
    }))
    .sort((a, b) => b.weight - a.weight || a.tag.localeCompare(b.tag, "en"));
}

/**
 * Deterministic aggregation: every vote decays linearly over the 7-day
 * window, buckets per vibe and per audience tag, and shares are rounded so
 * output is stable for Pulse consumption.
 */
export function aggregateVibes(
  beachId: string,
  votes: WeightedVibeVote[],
  nowMs: number,
): BeachVibesAggregate {
  const byVibe = new Map<string, { votes: number; weight: number }>();
  const byAudience = new Map<string, { votes: number; weight: number }>();
  let totalWeight = 0;
  for (const vote of votes) {
    // Vote weighting: linear 7-day time decay — 1.0 at cast, 0.0 at the
    // window edge, applied identically to the vibe and audience buckets.
    const weight = decayWeight(vote.createdAtMs, nowMs);
    totalWeight += weight;
    const vibe = byVibe.get(vote.vibe) ?? { votes: 0, weight: 0 };
    vibe.votes += 1;
    vibe.weight += weight;
    byVibe.set(vote.vibe, vibe);
    const audience = byAudience.get(vote.audienceTag) ?? {
      votes: 0,
      weight: 0,
    };
    audience.votes += 1;
    audience.weight += weight;
    byAudience.set(vote.audienceTag, audience);
  }
  return {
    beachId,
    totalVotes: votes.length,
    windowStartMs: nowMs - VOTE_WINDOW_MS,
    computedAtMs: nowMs,
    vibes: tally(byVibe, totalWeight),
    audiences: tally(byAudience, totalWeight),
  };
}

/** The Beach Pulse community-signal shape consumed by per-audience rankings. */
export type PulseVibeSignal = {
  kind: "vibe_votes";
  beachId: string;
  computedAt: string;
  windowStart: string;
  totalVotes: number;
  dominantVibe: string | null;
  dominantAudience: string | null;
  perVibe: Record<string, number>;
  perAudience: Record<string, number>;
};

export function toPulseSignal(aggregate: BeachVibesAggregate): PulseVibeSignal {
  const dominantVibe =
    aggregate.vibes[0] && aggregate.vibes[0].weight > 0
      ? aggregate.vibes[0].tag
      : null;
  const dominantAudience =
    aggregate.audiences[0] && aggregate.audiences[0].weight > 0
      ? aggregate.audiences[0].tag
      : null;
  return {
    kind: "vibe_votes",
    beachId: aggregate.beachId,
    computedAt: new Date(aggregate.computedAtMs).toISOString(),
    windowStart: new Date(aggregate.windowStartMs).toISOString(),
    totalVotes: aggregate.totalVotes,
    dominantVibe,
    dominantAudience,
    perVibe: Object.fromEntries(
      aggregate.vibes.map((entry) => [entry.tag, entry.weight]),
    ),
    perAudience: Object.fromEntries(
      aggregate.audiences.map((entry) => [entry.tag, entry.weight]),
    ),
  };
}

export type BeachVibesResponse = {
  beachId: string;
  totalVotes: number;
  windowStart: string;
  computedAt: string;
  vibes: VibeTally[];
  audiences: VibeTally[];
  pulse: PulseVibeSignal;
};

export function serializeVibes(
  aggregate: BeachVibesAggregate,
): BeachVibesResponse {
  return {
    beachId: aggregate.beachId,
    totalVotes: aggregate.totalVotes,
    windowStart: new Date(aggregate.windowStartMs).toISOString(),
    computedAt: new Date(aggregate.computedAtMs).toISOString(),
    vibes: aggregate.vibes,
    audiences: aggregate.audiences,
    pulse: toPulseSignal(aggregate),
  };
}

// ---------------------------------------------------------------------------
// Database access
// ---------------------------------------------------------------------------

export async function getBeachVibes(
  db: Queryable,
  beachPublicId: string,
  nowMs: number = Date.now(),
): Promise<BeachVibesAggregate | null> {
  const beach = await db.query<{ id: number }>(
    "select id from beach where public_id = $1",
    [beachPublicId],
  );
  if (!beach.rowCount) return null;
  const votes = await db.query<{
    vibe: string;
    audience_tag: string;
    created_at: Date;
  }>(
    `select vibe, audience_tag, created_at
     from beach_vibe_vote
     where beach_id = $1 and created_at >= $2
     order by created_at asc, id asc`,
    [beach.rows[0].id, new Date(nowMs - VOTE_WINDOW_MS)],
  );
  return aggregateVibes(
    beachPublicId,
    votes.rows.map((row) => ({
      vibe: row.vibe,
      audienceTag: row.audience_tag,
      createdAtMs: new Date(row.created_at).getTime(),
    })),
    nowMs,
  );
}

export type VibeVoteOutcome =
  | { outcome: "beach_not_found" }
  | {
      outcome: "cooldown";
      nextAllowedAtMs: number;
      cooldownRemainingMs: number;
    }
  | {
      outcome: "duplicate";
      nextAllowedAtMs: number;
      cooldownRemainingMs: number;
    }
  | {
      outcome: "cast";
      votePublicId: string;
      votedAtMs: number;
      cooldownUntilMs: number;
    };

/**
 * Cast one vibe vote per user per beach per local day, gated by a 24h
 * cooldown. The unique (user_id, beach_id, local_day) constraint is the
 * backstop for same-day races; both paths surface as a cooldown rejection.
 */
export async function castVibeVote(
  db: Queryable,
  input: {
    userId: number;
    beachPublicId: string;
    vibe: VibeTag;
    audienceTag: AudienceTag;
  },
  nowMs: number = Date.now(),
): Promise<VibeVoteOutcome> {
  const beach = await db.query<{ id: number }>(
    "select id from beach where public_id = $1",
    [input.beachPublicId],
  );
  if (!beach.rowCount) return { outcome: "beach_not_found" };
  const beachId = beach.rows[0].id;

  const last = await db.query<{ created_at: Date }>(
    `select created_at from beach_vibe_vote
     where user_id = $1 and beach_id = $2
     order by created_at desc limit 1`,
    [input.userId, beachId],
  );
  const lastVotedAtMs = last.rowCount
    ? new Date(last.rows[0].created_at).getTime()
    : null;
  if (lastVotedAtMs != null) {
    const evaluation = evaluateVibeVote(lastVotedAtMs, nowMs);
    if (!evaluation.allowed) {
      return {
        outcome: "cooldown",
        nextAllowedAtMs: evaluation.nextAllowedAtMs,
        cooldownRemainingMs: evaluation.cooldownRemainingMs,
      };
    }
  }

  const inserted = await db.query<{ public_id: string; created_at: Date }>(
    `insert into beach_vibe_vote(beach_id, user_id, vibe, audience_tag, local_day)
     select b.id, $2, $3, $4, (now() at time zone b.timezone)::date
     from beach b where b.id = $1
     on conflict (user_id, beach_id, local_day) do nothing
     returning public_id, created_at`,
    [beachId, input.userId, input.vibe, input.audienceTag],
  );
  if (!inserted.rowCount) {
    const blockedAtMs = lastVotedAtMs ?? nowMs;
    const remaining = cooldownRemainingMs(blockedAtMs, nowMs);
    return {
      outcome: "duplicate",
      nextAllowedAtMs: blockedAtMs + COOLDOWN_MS,
      cooldownRemainingMs: remaining === 0 ? COOLDOWN_MS : remaining,
    };
  }

  const votedAtMs = new Date(inserted.rows[0].created_at).getTime();
  await db.query(
    `insert into audit_log(actor_user_id, action, target, properties)
     values ($1, 'vibe_vote_cast', $2, $3)`,
    [
      input.userId,
      input.beachPublicId,
      JSON.stringify({ vibe: input.vibe, audienceTag: input.audienceTag }),
    ],
  );
  return {
    outcome: "cast",
    votePublicId: inserted.rows[0].public_id,
    votedAtMs,
    cooldownUntilMs: votedAtMs + COOLDOWN_MS,
  };
}

// ---------------------------------------------------------------------------
// Routes (mounted under /api by server/index.ts)
// ---------------------------------------------------------------------------

const vibeVoteSchema = z.object({
  beachId: z.string().uuid(),
  vibe: z.enum(VIBE_TAGS),
  audienceTag: z.enum(AUDIENCE_TAGS),
});

export const vibesRouter = Router();

// POST /api/vibes — cast a per-audience vibe vote (one per user per beach
// per day with a 24h cooldown).
vibesRouter.post(
  "/vibes",
  requireUser,
  async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = vibeVoteSchema.parse(request.body);
      if (request.userId == null) {
        response.status(401).json({ error: "unauthorized" });
        return;
      }
      const outcome = await castVibeVote(pool, {
        userId: request.userId,
        beachPublicId: input.beachId,
        vibe: input.vibe,
        audienceTag: input.audienceTag,
      });
      if (outcome.outcome === "beach_not_found") {
        response.status(404).json({ error: "beach_not_found" });
        return;
      }
      if (outcome.outcome !== "cast") {
        response.status(409).json({
          error: "duplicate_vibe_vote",
          nextAllowedAt: new Date(outcome.nextAllowedAtMs).toISOString(),
          cooldownRemainingMs: outcome.cooldownRemainingMs,
        });
        return;
      }
      const aggregate = await getBeachVibes(pool, input.beachId);
      if (!aggregate) {
        response.status(404).json({ error: "beach_not_found" });
        return;
      }
      response.status(201).json({
        data: {
          ...serializeVibes(aggregate),
          cooldownUntil: new Date(outcome.cooldownUntilMs).toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/beaches/:id/vibes — per-vibe and per-audience aggregates with a
// freshness timestamp, shaped for Beach Pulse consumption. Public; when the
// caller identifies themselves the response also carries their cooldown.
vibesRouter.get(
  "/beaches/:id/vibes",
  async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const nowMs = Date.now();
      const beachPublicId = String(request.params.id);
      const aggregate = await getBeachVibes(pool, beachPublicId, nowMs);
      if (!aggregate) {
        response.status(404).json({ error: "beach_not_found" });
        return;
      }
      const viewer: {
        voted: boolean;
        cooldownUntil: string | null;
        cooldownRemainingMs: number;
      } = { voted: false, cooldownUntil: null, cooldownRemainingMs: 0 };
      const viewerId = await resolveOptionalUser(request);
      if (viewerId != null) {
        const last = await pool.query<{ created_at: Date }>(
          `select v.created_at from beach_vibe_vote v
           join beach b on b.id = v.beach_id
           where v.user_id = $1 and b.public_id = $2
           order by v.created_at desc limit 1`,
          [viewerId, beachPublicId],
        );
        if (last.rowCount) {
          const lastVotedAtMs = new Date(last.rows[0].created_at).getTime();
          const remaining = cooldownRemainingMs(lastVotedAtMs, nowMs);
          viewer.voted = true;
          viewer.cooldownUntil = new Date(
            lastVotedAtMs + COOLDOWN_MS,
          ).toISOString();
          viewer.cooldownRemainingMs = remaining;
        }
      }
      response.json({ data: { ...serializeVibes(aggregate), viewer } });
    } catch (error) {
      next(error);
    }
  },
);
