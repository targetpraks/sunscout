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

/**
 * GET /  → list of active placements for ?beachId=<beachPublicId>[&at=iso].
 * Mounted under /ads (public — sponsorships are consumer-visible, clearly
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
  return router;
}
