import type { Pool, PoolClient } from "pg";
import express from "express";
import { z } from "zod";

/**
 * Brand sponsorship & takeover surfaces (Pillar 7, PRD §4.6).
 *
 * Earned-vs-paid integrity rule: rows served from this module own ONLY the
 * visual/branding/curated layer of a beach surface. Nothing here may be read
 * by, feed into, or influence Beach Pulse scoring, day quality, match scores,
 * or any earned ranking. ads.test.ts pins that invariant: the Beach Pulse
 * output must be identical with and without active sponsorships.
 *
 * Window semantics are half-open, matching the events calendar: a placement
 * is active while start_at <= now < end_at.
 */

type Queryable = Pick<Pool | PoolClient, "query">;

/** Exported so tests and callers can type fake/connection-scoped DB handles. */
export type AdsDb = Queryable;

export const AD_PLACEMENT_KINDS = [
  "placement",
  "beach_takeover",
  "event_takeover",
] as const;

export type AdPlacementKind = (typeof AD_PLACEMENT_KINDS)[number];

export type SponsoredPlacement = {
  id: number;
  publicId: string;
  beachPublicId: string;
  kind: AdPlacementKind;
  brandName: string;
  label: string;
  headline: string | null;
  body: string | null;
  imageUrl: string | null;
  targetUrl: string | null;
  eventPublicId: string | null;
  weight: number;
  /** Literal true: every record served from this module is paid inventory. */
  sponsored: true;
  startsAt: string;
  endsAt: string;
};

const KIND_PRIORITY: Record<AdPlacementKind, number> = {
  beach_takeover: 0,
  event_takeover: 1,
  placement: 2,
};

// uuid, not free text: beach_public_id is a uuid column, so a non-uuid value
// must fail validation here (400) rather than reach Postgres (500).
export const adsQuerySchema = z.object({
  beachId: z.string().uuid(),
  at: z.coerce.date().optional(),
});

export type AdsQuery = z.infer<typeof adsQuerySchema>;

/**
 * Pure window filter + ordering. Half-open interval: a placement whose window
 * starts exactly at `now` is active; one whose window ends exactly at `now`
 * is not. Takeovers outrank plain placements, then weight desc, then start
 * asc. Never reads or mutates any ranking signal — paid inventory is ordered
 * among itself only, never against organic results.
 */
export function activePlacementsAt(
  placements: SponsoredPlacement[],
  now: Date,
): SponsoredPlacement[] {
  const ref = now.getTime();
  const active = placements.filter((placement) => {
    const start = new Date(placement.startsAt).getTime();
    const end = new Date(placement.endsAt).getTime();
    return start <= ref && ref < end;
  });
  return active.sort((a, b) => {
    const kind = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    if (kind !== 0) return kind;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  });
}

type AdPlacementRow = {
  id: number;
  public_id: string;
  beach_public_id: string;
  kind: AdPlacementKind;
  brand_name: string;
  label: string;
  headline: string | null;
  body: string | null;
  image_url: string | null;
  target_url: string | null;
  event_public_id: string | null;
  weight: number;
  sponsored: boolean;
  start_at: Date;
  end_at: Date;
};

function serializePlacement(row: AdPlacementRow): SponsoredPlacement {
  return {
    id: row.id,
    publicId: row.public_id,
    beachPublicId: row.beach_public_id,
    kind: row.kind,
    brandName: row.brand_name,
    label: row.label,
    headline: row.headline,
    body: row.body,
    imageUrl: row.image_url,
    targetUrl: row.target_url,
    eventPublicId: row.event_public_id,
    weight: row.weight,
    // Forced literal, never read from the row: anything served by this
    // module is paid inventory and must be labeled as such.
    sponsored: true,
    startsAt: new Date(row.start_at).toISOString(),
    endsAt: new Date(row.end_at).toISOString(),
  };
}

/**
 * Active placements for one beach at a given instant (defaults to now).
 * The SQL narrows by beach + window; activePlacementsAt re-applies the same
 * half-open window as the drift-checked invariant.
 */
export async function listActivePlacements(
  db: AdsDb,
  options: { beachPublicId: string; now?: Date },
): Promise<SponsoredPlacement[]> {
  const now = options.now ?? new Date();
  const result = await db.query<AdPlacementRow>(
    `select id, public_id, beach_public_id, kind, brand_name, label,
       headline, body, image_url, target_url, event_public_id, weight,
       sponsored, start_at, end_at
     from ad_placement
     where beach_public_id = $1
       and start_at <= $2
       and end_at > $2`,
    [options.beachPublicId, now],
  );
  return activePlacementsAt(result.rows.map(serializePlacement), now);
}

// ---------------------------------------------------------------- takeovers

/**
 * Contextual surfaces a brand takeover can own (2026-06-24 advertising
 * direction): conditions=sunblock, sightings=swimwear, golden-hour=watch,
 * beach-detail=beach club. Kebab-case ids, matching the events convention.
 */
export const AD_SURFACES = [
  "conditions",
  "sightings",
  "golden-hour",
  "beach-detail",
] as const;

export type AdSurface = (typeof AD_SURFACES)[number];

export const AD_SURFACE_LABELS: Record<AdSurface, string> = {
  conditions: "Conditions",
  sightings: "Sightings",
  "golden-hour": "Golden Hour",
  "beach-detail": "Beach Detail",
};

/** Scope ladder: a beach takeover beats an island takeover beats a region. */
export const TAKEOVER_SCOPE_KINDS = ["beach", "island", "region"] as const;

export type TakeoverScopeKind = (typeof TAKEOVER_SCOPE_KINDS)[number];

/**
 * A resolved takeover, structurally compatible with SponsoredPlacement so the
 * existing SponsoredRail/SponsoredSlot render it unchanged — plus the
 * takeover-specific surface and scope. beachPublicId is the beach the
 * takeover was resolved FOR (a region/island takeover has no single beach id
 * of its own).
 */
export type SponsoredTakeover = SponsoredPlacement & {
  surface: AdSurface;
  scopeKind: TakeoverScopeKind;
};

const TAKEOVER_SCOPE_PRIORITY: Record<TakeoverScopeKind, number> = {
  beach: 0,
  island: 1,
  region: 2,
};

/**
 * Pure takeover resolution: window filter + surface match + scope ladder
 * (beach > island > region), tie-broken by weight desc then start asc. The
 * SQL in resolveTakeover narrows by surface/window/scope as a performance
 * filter; this re-applies the same rules as the drift-checked invariant —
 * the exact pattern activePlacementsAt uses for placements. Never reads or
 * mutates any ranking signal.
 */
export function resolveActiveTakeover(
  takeovers: SponsoredTakeover[],
  options: { surface: AdSurface; now: Date },
): SponsoredTakeover | null {
  const ref = options.now.getTime();
  const active = takeovers.filter((takeover) => {
    if (takeover.surface !== options.surface) return false;
    const start = new Date(takeover.startsAt).getTime();
    const end = new Date(takeover.endsAt).getTime();
    return start <= ref && ref < end;
  });
  if (active.length === 0) return null;
  active.sort((a, b) => {
    const scope =
      TAKEOVER_SCOPE_PRIORITY[a.scopeKind] -
      TAKEOVER_SCOPE_PRIORITY[b.scopeKind];
    if (scope !== 0) return scope;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  });
  return active[0] ?? null;
}

type AdTakeoverRow = {
  id: number;
  public_id: string;
  surface: AdSurface;
  scope_kind: TakeoverScopeKind;
  scope_beach_public_id: string | null;
  scope_island: string | null;
  scope_min_lat: string | null;
  scope_max_lat: string | null;
  scope_min_lng: string | null;
  scope_max_lng: string | null;
  brand_name: string;
  label: string;
  headline: string | null;
  body: string | null;
  image_url: string | null;
  target_url: string | null;
  weight: number;
  sponsored: boolean;
  start_at: Date;
  end_at: Date;
};

function serializeTakeover(
  row: AdTakeoverRow,
  beachPublicId: string,
): SponsoredTakeover {
  return {
    id: row.id,
    publicId: row.public_id,
    // The beach surface this takeover was resolved for — a region or island
    // takeover owns no single beach, so this is the request's id, not the row's.
    beachPublicId,
    // Every takeover is a scoped beach takeover from the consumer's point of
    // view; the SponsoredSlot kind label reflects that.
    kind: "beach_takeover",
    brandName: row.brand_name,
    label: row.label,
    headline: row.headline,
    body: row.body,
    imageUrl: row.image_url,
    targetUrl: row.target_url,
    eventPublicId: null,
    weight: row.weight,
    // Forced literal, never read from the row — same rule as placements.
    sponsored: true,
    startsAt: new Date(row.start_at).toISOString(),
    endsAt: new Date(row.end_at).toISOString(),
    surface: row.surface,
    scopeKind: row.scope_kind,
  };
}

/**
 * The active takeover for one beach + contextual surface, or null. Beach
 * scope matches the exact beach; island scope matches the beach's
 * island_code; region scope matches a bounding box containing the beach's
 * coordinates. An unknown beach resolves to null — advertising is never a
 * beach-existence oracle.
 */
export async function resolveTakeover(
  db: AdsDb,
  options: {
    beachPublicId: string;
    surface: AdSurface;
    now?: Date;
  },
): Promise<SponsoredTakeover | null> {
  const now = options.now ?? new Date();
  const beach = await db.query<{
    island_code: string | null;
    latitude: string;
    longitude: string;
  }>(
    `select island_code, latitude, longitude
       from beach
      where public_id = $1`,
    [options.beachPublicId],
  );
  if (!beach.rowCount) return null;
  const target = beach.rows[0];
  const result = await db.query<AdTakeoverRow>(
    `select id, public_id, surface, scope_kind, scope_beach_public_id,
            scope_island, scope_min_lat, scope_max_lat, scope_min_lng,
            scope_max_lng, brand_name, label, headline, body, image_url,
            target_url, weight, sponsored, start_at, end_at
       from ad_takeover
      where surface = $1
        and start_at <= $2
        and end_at > $2
        and (
          (scope_kind = 'beach' and scope_beach_public_id = $3)
          or (scope_kind = 'island' and $4::text is not null and scope_island = $4)
          or (scope_kind = 'region'
              and scope_min_lat <= $5::numeric and $5::numeric <= scope_max_lat
              and scope_min_lng <= $6::numeric and $6::numeric <= scope_max_lng)
        )`,
    [
      options.surface,
      now,
      options.beachPublicId,
      target.island_code,
      target.latitude,
      target.longitude,
    ],
  );
  return resolveActiveTakeover(
    result.rows.map((row) => serializeTakeover(row, options.beachPublicId)),
    { surface: options.surface, now },
  );
}

export const takeoverQuerySchema = z.object({
  beachId: z.string().uuid(),
  surface: z.enum(AD_SURFACES),
  at: z.coerce.date().optional(),
});

export type TakeoverQuery = z.infer<typeof takeoverQuerySchema>;

/**
 * GET /          → list of active placements for ?beachId=<beachPublicId>[&at=iso].
 * GET /takeover  → the single active takeover for ?beachId=&surface=[&at=].
 *
 * Mounted under /api/ads (public — sponsorships are consumer-visible, clearly
 * labeled paid inventory, not user-private data). Parse errors surface as
 * 400 invalid_request; data-layer errors propagate to the app error handler.
 */
export function createAdsRouter(db: AdsDb): express.Router {
  const router = express.Router();
  router.get("/", async (request, response, next) => {
    let input: AdsQuery;
    try {
      input = adsQuerySchema.parse(request.query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        response
          .status(400)
          .json({ error: "invalid_request", issues: error.issues });
        return;
      }
      next(error);
      return;
    }
    try {
      const placements = await listActivePlacements(db, {
        beachPublicId: input.beachId,
        now: input.at ?? new Date(),
      });
      response.json({ data: placements });
    } catch (error) {
      next(error);
    }
  });
  router.get("/takeover", async (request, response, next) => {
    let input: TakeoverQuery;
    try {
      input = takeoverQuerySchema.parse(request.query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        response
          .status(400)
          .json({ error: "invalid_request", issues: error.issues });
        return;
      }
      next(error);
      return;
    }
    try {
      const takeover = await resolveTakeover(db, {
        beachPublicId: input.beachId,
        surface: input.surface,
        now: input.at ?? new Date(),
      });
      response.json({ data: takeover });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
