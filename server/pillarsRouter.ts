/**
 * Consumer-facing routers for the burst-built pillars.
 *
 * `sightings.ts`, `beachPulse.ts` and `events.ts` are pure domain modules with
 * no Express surface — this file is the wiring layer that mounts them so the
 * built-and-tested capabilities are actually reachable by the app.
 *
 * Route ownership (checked against server/index.ts before adding, because
 * `/api/events` is already taken by the analytics endpoint):
 *   POST /api/sightings                 capture a sighting
 *   GET  /api/beaches/:id/sightings     the sighting rail
 *   GET  /api/beaches/:id/pulse         per-audience Beach Pulse leaderboard
 *   GET  /api/beach-events              consumer event calendar
 *   POST /api/beach-events              coordinator: create an event
 *   GET  /api/coordinator/events        coordinator: own events
 *   POST /api/beach-events/:id/publish  coordinator: publish
 *   POST /api/beach-events/:id/cancel   coordinator: cancel
 */
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

import { requireUser } from "./auth";
import { pool } from "./db";
import {
  createSighting,
  parseSightingRecord,
  selectRailSightings,
  toSightingRecord,
  type Sighting,
  type SightingRecord,
} from "./sightings";
import {
  computePulse,
  AUDIENCE_LABELS,
  AUDIENCE_PROFILES,
  type CommunitySignals,
  type ConditionSnapshot,
  type PulseAudience,
} from "./beachPulse";
import {
  createEvent,
  consumerVisibleEvents,
  listBeachEvents,
  listCoordinatorEvents,
  publishEvent,
  cancelEvent,
  EVENT_CATEGORIES,
} from "./events";

export const pillarsRouter = Router();

const PULSE_AUDIENCES = Object.keys(AUDIENCE_PROFILES) as PulseAudience[];

// ---------------------------------------------------------------- helpers

/** Latest live condition row for a beach, shaped for the Pulse engine. */
async function conditionSnapshot(beachId: number): Promise<ConditionSnapshot> {
  const result = await pool.query<{
    observed_at: Date | null;
    wave_height_m: number | null;
    wind_speed_kmh: number | null;
    sea_temp_c: number | null;
    air_temp_c: number | null;
    uv_index: number | null;
    crowd_percent: number | null;
    cloud_cover_percent: number | null;
  }>(
    `select observed_at, wave_height_m, wind_speed_kmh, sea_temp_c,
            air_temp_c, uv_index, crowd_percent, cloud_cover_percent
       from beach_condition
      where beach_id = $1
      order by observed_at desc nulls last
      limit 1`,
    [beachId],
  );
  const row = result.rowCount ? result.rows[0] : null;
  return {
    observedAt:
      row?.observed_at instanceof Date
        ? row.observed_at.toISOString()
        : new Date(0).toISOString(),
    waveM: row?.wave_height_m ?? null,
    windKmh: row?.wind_speed_kmh ?? null,
    waterTempC: row?.sea_temp_c ?? null,
    airTempC: row?.air_temp_c ?? null,
    uvIndex: row?.uv_index ?? null,
    crowdPct: row?.crowd_percent ?? null,
    cloudPct: row?.cloud_cover_percent ?? null,
  };
}

/**
 * Map `beach_suitability.audience` labels (families, solo, couples, friends,
 * party, clubs, chill) onto the Pulse engine's audience ids.
 */
const SUITABILITY_TO_PULSE: Record<string, PulseAudience> = {
  family: "family",
  families: "family",
  friends: "friends",
  solo: "solo",
  couple: "couples",
  couples: "couples",
  party: "party",
  clubs: "party",
  "beach-club": "party",
  chill: "chill",
};

/** Audience-tagged community signals the Pulse engine consumes. */
async function communitySignals(
  beachId: number,
  now: Date,
): Promise<CommunitySignals> {
  // Check-ins carry no audience of their own; the beach's top-suitability
  // audiences are the honest proxy for "who this beach is for".
  const suitability = await pool.query<{ audience: string }>(
    `select audience from beach_suitability
      where beach_id = $1 and score >= 2
      order by score desc`,
    [beachId],
  );
  const beachAudiences = [
    ...new Set(
      suitability.rows
        .map((r) => SUITABILITY_TO_PULSE[r.audience])
        .filter((a): a is PulseAudience => Boolean(a)),
    ),
  ];

  const checkIns = await pool.query<{ checked_in_at: Date }>(
    `select checked_in_at
       from beach_check_in
      where beach_id = $1 and checked_in_at > now() - interval '48 hours'`,
    [beachId],
  );

  const vibes = await pool.query<{
    audience_tag: string;
    vibe: string;
    created_at: Date;
  }>(
    `select audience_tag, vibe, created_at
       from beach_vibe_vote
      where beach_id = $1 and created_at > now() - interval '7 days'`,
    [beachId],
  );

  // PR #11's canonical accuracy table (1-5 stars, one row per user/beach/
  // condition, updated_at on the latest rating). Supersedes the stripped
  // 0-1 condition_accuracy_rating design from this branch's original burst.
  const accuracy = await pool.query<{ rating: string; updated_at: Date }>(
    `select rating, updated_at
       from condition_accuracy
      where beach_id = $1 and updated_at > now() - interval '7 days'`,
    [beachId],
  );

  const asAudience = (value: string | null): PulseAudience | null =>
    value ? (SUITABILITY_TO_PULSE[value] ?? null) : null;

  return {
    checkIns: checkIns.rows.flatMap((row) =>
      (beachAudiences.length ? beachAudiences : []).map((audience) => ({
        audience,
        at: new Date(row.checked_in_at).toISOString(),
        kind: "check-in" as const,
      })),
    ),
    vibeVotes: vibes.rows.flatMap((row) => {
      const audience = asAudience(row.audience_tag);
      return audience
        ? [
            {
              audience,
              at: new Date(row.created_at).toISOString(),
              score: VIBE_SCORES[row.vibe] ?? 60,
            },
          ]
        : [];
    }),
    accuracyRatings: accuracy.rows.map((row) => ({
      at: new Date(row.updated_at).toISOString(),
      // 1-5 star scale: ratings at or above 4 count as accurate.
      accurate: Number(row.rating) >= 4,
    })),
  };
}

/** Map a stored vibe tag onto the Pulse 0-100 mood score. */
const VIBE_SCORES: Record<string, number> = {
  chill: 70,
  party: 90,
  family: 75,
  romantic: 80,
  "hidden-gem": 65,
  "beach-club": 85,
};

// ---------------------------------------------------------------- sightings

const newSightingSchema = z.object({
  beachId: z.string().uuid(),
  audience: z.enum([
    "family",
    "friends",
    "solo",
    "couple",
    "group",
    "beach-club",
  ]),
  timeOfDay: z
    .enum([
      "sunrise",
      "morning",
      "midday",
      "afternoon",
      "golden-hour",
      "dusk",
      "night",
    ])
    .optional(),
  caption: z.string().trim().max(280).optional(),
  mediaForm: z.enum(["native", "link"]),
  mediaUrl: z.string().trim().url(),
  mediaMimeType: z.string().trim().optional(),
  mediaPlatform: z.enum(["tiktok", "instagram"]).optional(),
  mediaAttribution: z.string().trim().max(200).optional(),
  peopleInFrame: z.boolean().default(false),
  peopleConsent: z.boolean().default(false),
});

pillarsRouter.post(
  "/api/sightings",
  requireUser,
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = newSightingSchema.parse(request.body ?? {});

      const outcome = createSighting(
        {
          beachId: input.beachId,
          audience: input.audience,
          timeOfDay: input.timeOfDay,
          moderationState: "approved",
          consent: {
            peopleInFrame: input.peopleInFrame,
            peopleConsent: input.peopleConsent,
          },
          caption: input.caption,
          ...(input.mediaForm === "native"
            ? {
                nativeMedia: {
                  url: input.mediaUrl,
                  mimeType: input.mediaMimeType ?? "image/jpeg",
                },
              }
            : {
                socialLink: {
                  url: input.mediaUrl,
                  platform: input.mediaPlatform ?? "tiktok",
                  attribution: input.mediaAttribution ?? "",
                },
              }),
        },
        new Date(),
      );

      if (!outcome.ok) {
        response
          .status(422)
          .json({ error: "invalid_sighting", issues: outcome.issues });
        return;
      }

      const record = toSightingRecord(outcome.sighting);
      await pool.query(
        `insert into beach_sighting (
           id, beach_id, audience, time_of_day, moderation_state,
           people_in_frame, people_consent, media_form, media_url,
           media_mime_type, media_platform, media_attribution, caption,
           captured_at, expires_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          record.id,
          record.beach_id,
          record.audience,
          record.time_of_day,
          record.moderation_state,
          record.people_in_frame,
          record.people_consent,
          record.media_form,
          record.media_url,
          record.media_mime_type,
          record.media_platform,
          record.media_attribution,
          record.caption,
          record.captured_at,
          record.expires_at,
        ],
      );

      response.status(201).json({ data: record });
    } catch (error) {
      next(error);
    }
  },
);

pillarsRouter.get(
  "/api/beaches/:id/sightings",
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const now = new Date();
      const beachId = String(request.params.id);
      const result = await pool.query(
        `select id, beach_id, audience, time_of_day, moderation_state,
                people_in_frame, people_consent, media_form, media_url,
                media_mime_type, media_platform, media_attribution, caption,
                captured_at, expires_at
           from beach_sighting
          where beach_id = $1 and moderation_state = 'approved'
          order by captured_at desc
          limit 100`,
        [beachId],
      );

      const sightings: Sighting[] = result.rows.map((row) =>
        parseSightingRecord({
          ...row,
          captured_at:
            row.captured_at instanceof Date
              ? row.captured_at.toISOString()
              : String(row.captured_at),
          expires_at:
            row.expires_at instanceof Date
              ? row.expires_at.toISOString()
              : (row.expires_at as string | null),
        } as SightingRecord),
      );

      response.json({
        data: selectRailSightings(sightings, { now, limit: 20, beachId }),
        meta: { now: now.toISOString() },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------- pulse

pillarsRouter.get(
  "/api/beaches/:id/pulse",
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const now = new Date();
      const beachId = String(request.params.id);
      const beach = await pool.query<{ id: number; name: string }>(
        `select id, name from beach where public_id = $1`,
        [beachId],
      );
      if (!beach.rowCount) {
        response.status(404).json({ error: "beach_not_found" });
        return;
      }

      const row = beach.rows[0];
      const conditions = await conditionSnapshot(row.id);
      const community = await communitySignals(row.id, now);

      const data = PULSE_AUDIENCES.map((audience) =>
        computePulse(
          { id: beachId, name: row.name, conditions, community },
          { audience, now },
        ),
      ).sort((a, b) => b.score - a.score);

      response.json({
        data: data.map((entry) => ({
          ...entry,
          label: AUDIENCE_LABELS[entry.audience],
        })),
        meta: { now: now.toISOString() },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------- beach events

const newBeachEventSchema = z.object({
  beachId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional(),
  category: z.enum(EVENT_CATEGORIES),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  isPaidTakeover: z.boolean().default(false),
  sponsorName: z.string().trim().max(120).optional(),
});

/** Consumer calendar — published beach events (public). */
pillarsRouter.get(
  "/api/beach-events",
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const beachId =
        typeof request.query.beachId === "string"
          ? request.query.beachId
          : null;
      if (!beachId) {
        response.json({ data: [], meta: { beachId: null } });
        return;
      }
      const events = await listBeachEvents(pool, beachId);
      response.json({ data: consumerVisibleEvents(events) });
    } catch (error) {
      next(error);
    }
  },
);

pillarsRouter.post(
  "/api/beach-events",
  requireUser,
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (request.userId == null) {
        response.status(401).json({ error: "unauthorized" });
        return;
      }
      const input = newBeachEventSchema.parse(request.body ?? {});
      const event = await createEvent(
        pool,
        {
          beachPublicId: input.beachId,
          title: input.title,
          description: input.description,
          category: input.category,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          isPaidTakeover: input.isPaidTakeover,
          sponsorName: input.sponsorName,
        },
        request.userId,
      );
      response.status(201).json({ data: event });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "beach_not_found") {
        response.status(404).json({ error: "beach_not_found" });
        return;
      }
      next(error);
    }
  },
);

pillarsRouter.get(
  "/api/coordinator/events",
  requireUser,
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (request.userId == null) {
        response.status(401).json({ error: "unauthorized" });
        return;
      }
      response.json({
        data: await listCoordinatorEvents(pool, request.userId),
      });
    } catch (error) {
      next(error);
    }
  },
);

function coordinatorTransition(
  run: (
    db: typeof pool,
    eventPublicId: string,
    coordinatorId: number,
  ) => Promise<unknown>,
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (request.userId == null) {
        response.status(401).json({ error: "unauthorized" });
        return;
      }
      const event = await run(pool, String(request.params.id), request.userId);
      response.json({ data: event });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "event_not_found") {
        response.status(404).json({ error: "event_not_found" });
        return;
      }
      if (message === "not_event_coordinator" || message === "forbidden") {
        response.status(403).json({ error: "not_coordinator" });
        return;
      }
      if (message === "event_cancelled") {
        response.status(409).json({ error: "event_cancelled" });
        return;
      }
      next(error);
    }
  };
}

pillarsRouter.post(
  "/api/beach-events/:id/publish",
  requireUser,
  coordinatorTransition(publishEvent),
);

pillarsRouter.post(
  "/api/beach-events/:id/cancel",
  requireUser,
  coordinatorTransition(cancelEvent),
);
