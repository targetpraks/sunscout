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
