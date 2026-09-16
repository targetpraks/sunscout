/**
 * Brand sponsorship & takeover surfaces — client types.
 *
 * Deliberate mirror of the server's SponsoredPlacement (server/ads.ts). The
 * server tree cannot import from src/ (rootDir pin) so the two type sets are
 * duplicated by the same convention as the Beach Pulse mirror; keep in sync.
 *
 * Every record served by /api/ads carries sponsored:true and a human-facing
 * label — paid inventory is never rendered unlabeled (PRD §4.6).
 */

/** Disclosure label shown on every sponsored surface. */
export const SPONSORED_LABEL = "Sponsored";

export const AD_PLACEMENT_KINDS = [
  "placement",
  "beach_takeover",
  "event_takeover",
] as const;

export type AdPlacementKind = (typeof AD_PLACEMENT_KINDS)[number];

export const AD_KIND_LABELS: Record<AdPlacementKind, string> = {
  placement: "Sponsored placement",
  beach_takeover: "Beach takeover",
  event_takeover: "Event takeover",
};

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
  /** Literal true — the API contract forbids unlabeled paid inventory. */
  sponsored: true;
  startsAt: string;
  endsAt: string;
};

/**
 * Contextual surfaces a brand takeover can own (2026-06-24 advertising
 * direction): conditions=sunblock, sightings=swimwear, golden-hour=watch,
 * beach-detail=beach club. Deliberate mirror of server/ads.ts.
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
 * A resolved brand takeover. Structurally a SponsoredPlacement (plus the
 * surface/scope it was resolved on) so SponsoredRail/SponsoredSlot render it
 * through the same labeled slot — it never enters organic ordering, which
 * only consumes earned signals.
 */
export type SponsoredTakeover = SponsoredPlacement & {
  surface: AdSurface;
  scopeKind: TakeoverScopeKind;
};

const KIND_PRIORITY: Record<AdPlacementKind, number> = {
  beach_takeover: 0,
  event_takeover: 1,
  placement: 2,
};

/**
 * Client mirror of the server's window filter (server/ads.ts): a placement
 * is active while start <= now < end (half-open). The rail re-applies this
 * client-side so a cached response can never render expired inventory.
 * Takeovers outrank placements, then weight desc, then start asc — paid
 * inventory is ordered among itself only, never against organic results.
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
