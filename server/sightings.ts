import express from "express";
import type { Pool, PoolClient } from "pg";
import { newPublicId } from "./tokens";

/**
 * Ephemeral beach-scoped Sightings.
 *
 * A sighting is the lightest-weight proof that a beach is alive right now
 * (PRD §5). Two capture forms exist and are mutually exclusive:
 *
 *  - native:  a photo/video blob uploaded through SunScout. Ephemeral by
 *             design — it expires exactly SIGHTING_TTL_DAYS after capture.
 *  - link:    an outbound TikTok/Instagram URL. Stored as reference +
 *             attribution only (never rehosted), so it persists beyond the
 *             native TTL, but its freshness weight decays monotonically.
 *
 * All time-dependent functions take `now` explicitly so the 7-day TTL can
 * be proven with fixed injected timestamps in tests.
 */

export const SIGHTING_TTL_DAYS = 7;
export const SIGHTING_TTL_MS = SIGHTING_TTL_DAYS * 24 * 60 * 60 * 1000;
export const SIGHTING_FRESHNESS_HALF_LIFE_MS = 3.5 * 24 * 60 * 60 * 1000;
export const SIGHTING_CAPTION_MAX_CHARS = 280;

export type SightingMediaForm = "native" | "link";
export type SightingModerationState = "pending" | "approved" | "rejected";
export type SightingAudience =
  | "family"
  | "friends"
  | "solo"
  | "couple"
  | "group"
  | "beach-club";
export type SightingTimeOfDay =
  | "sunrise"
  | "morning"
  | "midday"
  | "afternoon"
  | "golden-hour"
  | "dusk"
  | "night";

export const SIGHTING_AUDIENCES: readonly SightingAudience[] = [
  "family",
  "friends",
  "solo",
  "couple",
  "group",
  "beach-club",
];

export const SIGHTING_TIMES_OF_DAY: readonly SightingTimeOfDay[] = [
  "sunrise",
  "morning",
  "midday",
  "afternoon",
  "golden-hour",
  "dusk",
  "night",
];

export const SIGHTING_MODERATION_STATES: readonly SightingModerationState[] = [
  "pending",
  "approved",
  "rejected",
];

export type NativeMedia = {
  form: "native";
  url: string;
  mimeType: string;
};

export type OutboundSocialLink = {
  form: "link";
  platform: "tiktok" | "instagram";
  url: string;
  attribution: string;
};

export type SightingMedia = NativeMedia | OutboundSocialLink;

/** Recognizable-people consent. Required on every sighting. */
export type SightingConsent = {
  peopleInFrame: boolean;
  peopleConsent: boolean;
};

export type Sighting = {
  id: string;
  beachId: string;
  audience: SightingAudience;
  timeOfDay: SightingTimeOfDay | null;
  moderationState: SightingModerationState;
  consent: SightingConsent;
  media: SightingMedia;
  caption: string | null;
  capturedAt: Date;
  /** Native media only. Link sightings are references and never auto-expire. */
  expiresAt: Date | null;
};

/** Raw, unvalidated capture input. Exactly one media form must be present. */
export type NewSightingInput = {
  beachId?: unknown;
  audience?: unknown;
  timeOfDay?: unknown;
  moderationState?: unknown;
  consent?: unknown;
  caption?: unknown;
  nativeMedia?: unknown;
  socialLink?: unknown;
};

export type ValidatedSightingInput = {
  beachId: string;
  audience: SightingAudience;
  timeOfDay: SightingTimeOfDay | null;
  moderationState: SightingModerationState;
  consent: SightingConsent;
  caption: string | null;
  media: SightingMedia;
};

export type SightingValidation =
  | { ok: true; value: ValidatedSightingInput }
  | { ok: false; issues: string[] };

export type CreateSightingResult =
  | { ok: true; sighting: Sighting }
  | { ok: false; issues: string[] };

const SOCIAL_HOST_SUFFIXES: Record<string, string> = {
  tiktok: "tiktok.com",
  instagram: "instagram.com",
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

function hostMatchesPlatform(host: string, platform: string): boolean {
  const suffix = SOCIAL_HOST_SUFFIXES[platform];
  return host === suffix || host.endsWith(`.${suffix}`);
}

/**
 * Outbound social URLs are accepted only as https references on the platform
 * they claim to be. They are stored verbatim — never fetched, proxied, or
 * rehosted as media.
 */
export function isAllowedSocialUrl(platform: string, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || !SOCIAL_HOST_SUFFIXES[platform]) {
    return false;
  }
  return hostMatchesPlatform(parsed.hostname.toLowerCase(), platform);
}

/** Native media must be an https URL or an absolute storage path. */
export function isAllowedNativeMediaUrl(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function validateSightingInput(
  input: NewSightingInput,
): SightingValidation {
  const issues: string[] = [];

  const beachId = input.beachId;
  if (!isNonEmptyString(beachId)) {
    issues.push("beachId is required");
  }

  const audience = input.audience;
  if (!isOneOf(audience, SIGHTING_AUDIENCES)) {
    issues.push(
      `audience is required and must be one of: ${SIGHTING_AUDIENCES.join(", ")}`,
    );
  }

  const moderationState = input.moderationState;
  if (!isOneOf(moderationState, SIGHTING_MODERATION_STATES)) {
    issues.push(
      `moderationState is required and must be one of: ${SIGHTING_MODERATION_STATES.join(", ")}`,
    );
  }

  let timeOfDay: SightingTimeOfDay | null = null;
  if (input.timeOfDay !== undefined && input.timeOfDay !== null) {
    if (!isOneOf(input.timeOfDay, SIGHTING_TIMES_OF_DAY)) {
      issues.push(
        `timeOfDay must be one of: ${SIGHTING_TIMES_OF_DAY.join(", ")}`,
      );
    } else {
      timeOfDay = input.timeOfDay;
    }
  }

  const consentRaw = input.consent;
  let consent: SightingConsent | null = null;
  if (
    typeof consentRaw !== "object" ||
    consentRaw === null ||
    typeof (consentRaw as { peopleInFrame?: unknown }).peopleInFrame !==
      "boolean" ||
    typeof (consentRaw as { peopleConsent?: unknown }).peopleConsent !==
      "boolean"
  ) {
    issues.push(
      "consent is required with boolean peopleInFrame and peopleConsent flags",
    );
  } else {
    const flags = consentRaw as SightingConsent;
    if (flags.peopleInFrame && !flags.peopleConsent) {
      issues.push(
        "consent.peopleConsent must be true when people are recognizable in frame",
      );
    }
    consent = flags;
  }

  let caption: string | null = null;
  if (input.caption !== undefined && input.caption !== null) {
    if (typeof input.caption !== "string") {
      issues.push("caption must be a string");
    } else if (input.caption.trim().length > SIGHTING_CAPTION_MAX_CHARS) {
      issues.push(
        `caption must be ${SIGHTING_CAPTION_MAX_CHARS} characters or fewer`,
      );
    } else {
      caption = input.caption.trim() || null;
    }
  }

  const hasNative =
    input.nativeMedia !== undefined && input.nativeMedia !== null;
  const hasSocial = input.socialLink !== undefined && input.socialLink !== null;
  if (hasNative && hasSocial) {
    issues.push(
      "exactly one media form is allowed: provide nativeMedia or socialLink, not both",
    );
  } else if (!hasNative && !hasSocial) {
    issues.push(
      "exactly one media form is required: provide nativeMedia or socialLink",
    );
  }

  let media: SightingMedia | null = null;
  if (hasNative) {
    const native = input.nativeMedia as {
      url?: unknown;
      mimeType?: unknown;
    };
    if (!isNonEmptyString(native.url)) {
      issues.push("nativeMedia.url is required");
    } else if (!isAllowedNativeMediaUrl(native.url.trim())) {
      issues.push(
        "nativeMedia.url must be an https URL or an absolute storage path",
      );
    }
    if (!isNonEmptyString(native.mimeType)) {
      issues.push("nativeMedia.mimeType is required");
    } else {
      const mimeType = (native.mimeType as string).trim().toLowerCase();
      if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
        issues.push("nativeMedia.mimeType must be an image/* or video/* type");
      }
    }
    if (isNonEmptyString(native.url) && isNonEmptyString(native.mimeType)) {
      media = {
        form: "native",
        url: (native.url as string).trim(),
        mimeType: (native.mimeType as string).trim().toLowerCase(),
      };
    }
  } else if (hasSocial) {
    const social = input.socialLink as {
      platform?: unknown;
      url?: unknown;
      attribution?: unknown;
    };
    const platform = social.platform;
    if (!isOneOf(platform, ["tiktok", "instagram"] as const)) {
      issues.push("socialLink.platform must be tiktok or instagram");
    }
    if (!isNonEmptyString(social.url)) {
      issues.push("socialLink.url is required");
    } else if (
      isOneOf(platform, ["tiktok", "instagram"] as const) &&
      !isAllowedSocialUrl(platform, (social.url as string).trim())
    ) {
      issues.push(
        "socialLink.url must be an https URL on the tiktok.com or instagram.com domain matching the platform",
      );
    }
    if (!isNonEmptyString(social.attribution)) {
      issues.push("socialLink.attribution is required");
    }
    if (
      isOneOf(platform, ["tiktok", "instagram"] as const) &&
      isNonEmptyString(social.url) &&
      isNonEmptyString(social.attribution)
    ) {
      media = {
        form: "link",
        platform,
        url: (social.url as string).trim(),
        attribution: (social.attribution as string).trim(),
      };
    }
  }

  if (issues.length > 0 || media === null) {
    return { ok: false, issues };
  }
  if (!isNonEmptyString(beachId)) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      beachId: beachId.trim(),
      audience: audience as SightingAudience,
      timeOfDay,
      moderationState: moderationState as SightingModerationState,
      consent: consent as SightingConsent,
      caption,
      media,
    },
  };
}

/**
 * Capture a sighting at `now`. Native media expires exactly
 * SIGHTING_TTL_DAYS later; outbound links never auto-expire (they are
 * references, not hosted content).
 */
export function createSighting(
  input: NewSightingInput,
  now: Date,
  id: string = newPublicId(),
): CreateSightingResult {
  const validated = validateSightingInput(input);
  if (!validated.ok) {
    return { ok: false, issues: validated.issues };
  }
  const value = validated.value;
  const expiresAt =
    value.media.form === "native"
      ? new Date(now.getTime() + SIGHTING_TTL_MS)
      : null;
  return {
    ok: true,
    sighting: {
      id,
      beachId: value.beachId,
      audience: value.audience,
      timeOfDay: value.timeOfDay,
      moderationState: value.moderationState,
      consent: value.consent,
      media: value.media,
      caption: value.caption,
      capturedAt: now,
      expiresAt,
    },
  };
}

/** A sighting is expired once `now` reaches its TTL boundary (native only). */
export function isExpired(sighting: Sighting, now: Date): boolean {
  if (sighting.expiresAt === null) return false;
  return now.getTime() >= sighting.expiresAt.getTime();
}

/**
 * Freshness weight in [0, 1] for Pulse recency. Native media drops to 0 at
 * expiry; link sightings persist but their weight decays monotonically
 * (exponentially, half-life SIGHTING_FRESHNESS_HALF_LIFE_MS) with age.
 */
export function freshnessWeight(sighting: Sighting, now: Date): number {
  if (isExpired(sighting, now)) return 0;
  const ageMs = Math.max(0, now.getTime() - sighting.capturedAt.getTime());
  return Math.pow(0.5, ageMs / SIGHTING_FRESHNESS_HALF_LIFE_MS);
}

export type RailSelectorOptions = {
  now: Date;
  /** Maximum number of sightings returned. */
  limit: number;
  /** Restrict to a single beach when provided. */
  beachId?: string;
  /** Restrict to a single audience tag when provided. */
  audience?: SightingAudience;
};

/**
 * Expiry- and moderation-aware rail selector with deterministic freshness
 * ordering (PRD §5.2 / §6.1):
 *
 *  1. freshness weight desc — recency dominates; expired rows are already
 *     excluded, and link sightings persist but decay below fresh native
 *     ones of the same age;
 *  2. per-beach sighting volume desc — computed over the *visible candidate
 *     set* (never the whole table, so zombie beaches cannot over-rank),
 *     breaks ties between equal-freshness beaches;
 *  3. capturedAt desc — newer capture wins the next tie;
 *  4. native before link — at full ties a fresh native upload outranks an
 *     outbound reference;
 *  5. id asc — final stable tiebreak so the order is always deterministic.
 */
export function selectRailSightings(
  sightings: Sighting[],
  options: RailSelectorOptions,
): Sighting[] {
  const { now, limit } = options;
  const candidates = sightings
    .filter((sighting) => sighting.moderationState === "approved")
    .filter((sighting) => !isExpired(sighting, now))
    .filter(
      (sighting) =>
        options.beachId === undefined || sighting.beachId === options.beachId,
    )
    .filter(
      (sighting) =>
        options.audience === undefined ||
        sighting.audience === options.audience,
    );

  const volumeByBeach = new Map<string, number>();
  for (const sighting of candidates) {
    volumeByBeach.set(
      sighting.beachId,
      (volumeByBeach.get(sighting.beachId) ?? 0) + 1,
    );
  }

  return candidates
    .sort((a, b) => {
      const freshnessDiff = freshnessWeight(b, now) - freshnessWeight(a, now);
      if (freshnessDiff !== 0) return freshnessDiff;
      const volumeDiff =
        (volumeByBeach.get(b.beachId) ?? 0) -
        (volumeByBeach.get(a.beachId) ?? 0);
      if (volumeDiff !== 0) return volumeDiff;
      const timeDiff = b.capturedAt.getTime() - a.capturedAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      if (a.media.form !== b.media.form) {
        return a.media.form === "native" ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, Math.max(0, limit));
}

/** Wire/DB record shape (snake_case, ISO timestamps). */
export type SightingRecord = {
  id: string;
  beach_id: string;
  audience: string;
  time_of_day: string | null;
  moderation_state: string;
  people_in_frame: boolean;
  people_consent: boolean;
  media_form: SightingMediaForm;
  media_url: string;
  media_mime_type: string | null;
  media_platform: string | null;
  media_attribution: string | null;
  caption: string | null;
  captured_at: string;
  expires_at: string | null;
};

export function toSightingRecord(sighting: Sighting): SightingRecord {
  return {
    id: sighting.id,
    beach_id: sighting.beachId,
    audience: sighting.audience,
    time_of_day: sighting.timeOfDay,
    moderation_state: sighting.moderationState,
    people_in_frame: sighting.consent.peopleInFrame,
    people_consent: sighting.consent.peopleConsent,
    media_form: sighting.media.form,
    media_url: sighting.media.url,
    media_mime_type:
      sighting.media.form === "native" ? sighting.media.mimeType : null,
    media_platform:
      sighting.media.form === "link" ? sighting.media.platform : null,
    media_attribution:
      sighting.media.form === "link" ? sighting.media.attribution : null,
    caption: sighting.caption,
    captured_at: sighting.capturedAt.toISOString(),
    expires_at: sighting.expiresAt ? sighting.expiresAt.toISOString() : null,
  };
}

export function parseSightingRecord(record: SightingRecord): Sighting {
  const consent: SightingConsent = {
    peopleInFrame: record.people_in_frame,
    peopleConsent: record.people_consent,
  };
  const media: SightingMedia =
    record.media_form === "native"
      ? {
          form: "native",
          url: record.media_url,
          mimeType: record.media_mime_type ?? "",
        }
      : {
          form: "link",
          platform:
            (record.media_platform as "tiktok" | "instagram") ?? "tiktok",
          url: record.media_url,
          attribution: record.media_attribution ?? "",
        };
  return {
    id: record.id,
    beachId: record.beach_id,
    audience: record.audience as SightingAudience,
    timeOfDay: record.time_of_day as SightingTimeOfDay | null,
    moderationState: record.moderation_state as SightingModerationState,
    consent,
    media,
    caption: record.caption,
    capturedAt: new Date(record.captured_at),
    expiresAt: record.expires_at ? new Date(record.expires_at) : null,
  };
}

/* ------------------------------------------------------------------ *
 * Persistence + HTTP layer.                                           *
 *                                                                    *
 * server/index.ts is owned by pending branches, so this module does   *
 * NOT import the pool and does NOT mount itself. It exports a router  *
 * factory taking an injected queryable handle (same pattern as        *
 * events.ts) — the host app mounts it with:                           *
 *   app.use("/api/sightings", createSightingsRouter(pool));           *
 * Auth is deliberately not applied here (requireUser pulls in ./db);  *
 * the mounting branch can wrap the router with its own middleware.    *
 * ------------------------------------------------------------------ */

export type SightingsDb = Pick<Pool | PoolClient, "query">;

/**
 * CamelCase wire shape (ISO string timestamps) — matches the client
 * mirror's `Sighting` in src/sightings/types.ts.
 */
export type WireSighting = {
  id: string;
  beachId: string;
  audience: SightingAudience;
  timeOfDay: SightingTimeOfDay | null;
  moderationState: SightingModerationState;
  consent: SightingConsent;
  media: SightingMedia;
  caption: string | null;
  capturedAt: string;
  expiresAt: string | null;
};

export function toWireSighting(sighting: Sighting): WireSighting {
  return {
    id: sighting.id,
    beachId: sighting.beachId,
    audience: sighting.audience,
    timeOfDay: sighting.timeOfDay,
    moderationState: sighting.moderationState,
    consent: sighting.consent,
    media: sighting.media,
    caption: sighting.caption,
    capturedAt: sighting.capturedAt.toISOString(),
    expiresAt: sighting.expiresAt ? sighting.expiresAt.toISOString() : null,
  };
}

export type ListSightingsOptions = {
  now: Date;
  limit: number;
  beachId?: string;
  audience?: SightingAudience;
};

const SIGHTING_SELECT_COLUMNS = `id, beach_id, audience, time_of_day,
  moderation_state, people_in_frame, people_consent, media_form, media_url,
  media_mime_type, media_platform, media_attribution, caption, captured_at,
  expires_at`;

/**
 * Active, moderation-cleared sightings for the rail. The SQL narrows the
 * scan; the pure, unit-tested `selectRailSightings` is then re-applied to
 * the rows so expiry exclusion, the moderation gate, and the deterministic
 * freshness ordering are enforced even if a stale row slips past the query.
 */
export async function listSightings(
  db: SightingsDb,
  options: ListSightingsOptions,
): Promise<WireSighting[]> {
  const params: unknown[] = [options.now.toISOString()];
  let sql = `select ${SIGHTING_SELECT_COLUMNS} from beach_sighting
    where moderation_state = 'approved'
      and (expires_at is null or expires_at > $1)`;
  if (options.beachId) {
    params.push(options.beachId);
    sql += ` and beach_id = $${params.length}`;
  }
  if (options.audience) {
    params.push(options.audience);
    sql += ` and audience = $${params.length}`;
  }
  const result = await db.query<SightingRecord>(sql, params);
  const sightings = result.rows.map((row) => parseSightingRecord(row));
  return selectRailSightings(sightings, {
    now: options.now,
    limit: options.limit,
    beachId: options.beachId,
    audience: options.audience,
  }).map(toWireSighting);
}

/** Persist a validated sighting. `createSighting` already set its TTL. */
export async function insertSighting(
  db: SightingsDb,
  sighting: Sighting,
): Promise<Sighting> {
  const record = toSightingRecord(sighting);
  await db.query(
    `insert into beach_sighting (
       id, beach_id, audience, time_of_day, moderation_state,
       people_in_frame, people_consent, media_form, media_url,
       media_mime_type, media_platform, media_attribution, caption,
       captured_at, expires_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
  return sighting;
}

/**
 * Idempotent expiry sweep: flips `swept_at` on native rows whose TTL
 * boundary has passed. The `swept_at is null` guard makes a second run a
 * no-op; link sightings (null expires_at) are never touched. Rows are
 * marked, not deleted — read-time exclusion remains the source of truth.
 */
export async function sweepExpiredSightings(
  db: SightingsDb,
  now: Date,
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `update beach_sighting set swept_at = $1
     where expires_at is not null and expires_at <= $1 and swept_at is null
     returning id`,
    [now.toISOString()],
  );
  return result.rowCount ?? 0;
}

const DEFAULT_SIGHTINGS_LIMIT = 50;
const MAX_SIGHTINGS_LIMIT = 100;

/**
 * Sightings router: GET / (list), POST / (capture), POST /sweep.
 * Mount at /api/sightings from the host app.
 */
export function createSightingsRouter(db: SightingsDb) {
  const router = express.Router();

  router.get("/", async (request, response) => {
    const now = new Date();
    let limit = DEFAULT_SIGHTINGS_LIMIT;
    if (request.query.limit !== undefined) {
      const parsed = Number(request.query.limit);
      if (
        !Number.isInteger(parsed) ||
        parsed < 1 ||
        parsed > MAX_SIGHTINGS_LIMIT
      ) {
        response.status(400).json({ error: "invalid_limit" });
        return;
      }
      limit = parsed;
    }
    const beachId = request.query.beachId
      ? String(request.query.beachId).trim()
      : undefined;
    let audience: SightingAudience | undefined;
    const rawAudience = request.query.audience
      ? String(request.query.audience).trim().toLowerCase()
      : "";
    if (rawAudience) {
      if (!SIGHTING_AUDIENCES.includes(rawAudience as SightingAudience)) {
        response.status(400).json({ error: "invalid_audience" });
        return;
      }
      audience = rawAudience as SightingAudience;
    }
    const data = await listSightings(db, {
      now,
      limit,
      beachId: beachId || undefined,
      audience,
    });
    response.json({ data });
  });

  router.post("/", async (request, response) => {
    const created = createSighting(
      request.body as NewSightingInput,
      new Date(),
    );
    if (!created.ok) {
      response
        .status(422)
        .json({ error: "invalid_sighting", issues: created.issues });
      return;
    }
    await insertSighting(db, created.sighting);
    response.status(201).json({ data: toWireSighting(created.sighting) });
  });

  router.post("/sweep", async (_request, response) => {
    const swept = await sweepExpiredSightings(db, new Date());
    response.json({ data: { swept } });
  });

  return router;
}
