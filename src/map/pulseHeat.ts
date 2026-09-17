/**
 * Beach Map heat-discovery core — pure projection, binning and scaling.
 *
 * Every function here is pure: no clock reads, no I/O, no randomness, so the
 * map layer is deterministic for a fixed input and unit-testable in the node
 * vitest environment (no DOM). The 75/55/35 tier ladder mirrors
 * badgeTier()/pulseLabel() in src/pulse/scoring.ts so map colors and the
 * Pulse leaderboard never disagree about what a score means.
 *
 * Tap dispatch (emitBeachTap) lives here too: node-env vitest cannot fire
 * DOM events, so the "a tap emits onSelect + onBeachSelect" contract is
 * asserted by calling this pure function with spies.
 */

import type { Beach } from "../types";
import type { HeatCluster, MapOrigin, MapPoint, PulseTier } from "./types";

/** Brand palette (AGENTS.md): Ocean Teal, Sea Glass Green, Sunset Coral; amber for the middle tier. */
export const PULSE_TIER_COLORS: Record<PulseTier, string> = {
  great: "#0A6E78",
  good: "#2E8B6B",
  fair: "#D98E4A",
  poor: "#FF6B5C",
};

export const PULSE_TIER_LABELS: Record<PulseTier, string> = {
  great: "Excellent 75+",
  good: "Good 55–74",
  fair: "Fair 35–54",
  poor: "Poor <35",
};

/** Display order for the legend. */
export const PULSE_TIER_ORDER: PulseTier[] = ["great", "good", "fair", "poor"];

/** Same boundaries as badgeTier() in src/pulse/scoring.ts. */
export function pulseTier(score: number): PulseTier {
  if (score >= 75) return "great";
  if (score >= 55) return "good";
  if (score >= 35) return "fair";
  return "poor";
}

/**
 * Deterministic pin fill for a 0-100 pulse score — the unit-test contract:
 * same score in, same hex out; a score crossing a tier boundary changes it.
 */
export function pulseColor(score: number): string {
  return PULSE_TIER_COLORS[pulseTier(score)];
}

/** Heat-disc opacity floor at 0% crowd. */
export const HEAT_MIN_OPACITY = 0.12;
/** Heat-disc opacity ceiling at 100% crowd. */
export const HEAT_MAX_OPACITY = 0.5;

/** Crowd density -> heat-disc opacity. Monotonic, clamped on both ends. */
export function crowdOpacity(crowdPct: number): number {
  const t = Math.min(1, Math.max(0, crowdPct / 100));
  return HEAT_MIN_OPACITY + (HEAT_MAX_OPACITY - HEAT_MIN_OPACITY) * t;
}

/** Heat-disc radius (px) grows with cluster size, capped so one busy cell cannot swallow the map. */
export function heatRadius(count: number): number {
  return Math.min(34, 12 + 4 * Math.max(1, Math.round(count)));
}

/**
 * Offset from the origin in km (equirectangular with a cos(lat) correction —
 * accurate at city scale, the same estimate the trip-planner distances use
 * until the licensed mapping provider lands, per AGENTS.md).
 */
export function kmBetween(
  origin: MapOrigin,
  lat: number,
  lng: number,
): { xKm: number; yKm: number } {
  const cosLat = Math.cos((origin.latitude * Math.PI) / 180);
  return {
    xKm: (lng - origin.longitude) * cosLat * 111,
    yKm: (lat - origin.latitude) * 111,
  };
}

export type ProjectOptions = {
  /** SVG viewBox size in px (square). */
  size: number;
  /** Padding between the view edge and the outermost ring in px. */
  padding: number;
  /** Km span from center to the view edge — the projection scale. */
  viewRadiusKm: number;
};

/** Pixels per km for a projection — one source of truth for pins, rings and clusters. */
export function viewScale(options: ProjectOptions): number {
  return (options.size / 2 - options.padding) / options.viewRadiusKm;
}

/**
 * Project geocoded beaches onto the map's pixel grid. Beaches without
 * coordinates are skipped (the catalog still has a few unverified rows);
 * no radius cut happens here — that is the RadiusFilter's job.
 */
export function projectBeaches(
  origin: MapOrigin,
  beaches: Beach[],
  options: ProjectOptions,
): MapPoint[] {
  const center = options.size / 2;
  const scale = viewScale(options);
  return beaches
    .filter((beach) => beach.latitude != null && beach.longitude != null)
    .map((beach) => {
      const { xKm, yKm } = kmBetween(
        origin,
        beach.latitude as number,
        beach.longitude as number,
      );
      return {
        beach,
        xKm,
        yKm,
        x: center + xKm * scale,
        y: center - yKm * scale,
        distanceKm: Math.sqrt(xKm * xKm + yKm * yKm),
      };
    });
}

/**
 * Points within radiusKm of the origin. Null keeps everything (no filter).
 */
export function filterByRadius(
  points: MapPoint[],
  radiusKm: number | null,
): MapPoint[] {
  if (radiusKm == null) return points;
  return points.filter((point) => point.distanceKm <= radiusKm);
}

export type ClusterOptions = {
  /** Grid cell size in km — beaches in the same cell form one heat cluster. */
  cellKm: number;
};

/**
 * Bin projected points into crowd-density heat clusters on a stable integer
 * km grid ("col:row"). Deterministic for a fixed input: cells are keyed by
 * integer indices (never floats), members keep input order, and clusters
 * are emitted sorted by key. Cells with no finite crowd value report
 * avgCrowd null — the heat layer renders "no data" rather than a fake zero.
 */
export function buildHeatClusters(
  points: MapPoint[],
  options: ClusterOptions,
): HeatCluster[] {
  const cells = new Map<string, MapPoint[]>();
  for (const point of points) {
    const col = Math.floor(point.xKm / options.cellKm);
    const row = Math.floor(point.yKm / options.cellKm);
    const key = `${col}:${row}`;
    const cell = cells.get(key);
    if (cell) {
      cell.push(point);
    } else {
      cells.set(key, [point]);
    }
  }

  const clusters: HeatCluster[] = [];
  for (const key of [...cells.keys()].sort()) {
    const members = cells.get(key) as MapPoint[];
    const crowds = members
      .map((member) => member.beach.crowd)
      .filter((crowd) => Number.isFinite(crowd));
    const avgCrowd =
      crowds.length > 0
        ? Math.round(
            (crowds.reduce((sum, crowd) => sum + crowd, 0) / crowds.length) *
              10,
          ) / 10
        : null;
    clusters.push({
      key,
      x: members.reduce((sum, member) => sum + member.x, 0) / members.length,
      y: members.reduce((sum, member) => sum + member.y, 0) / members.length,
      beachIds: members.map((member) => member.beach.id),
      avgCrowd,
      count: members.length,
      focusBeachId: focusPointOf(members).beach.id,
    });
  }
  return clusters;
}

/**
 * The beach a heat-cluster tap resolves to: the member with the highest
 * finite live crowd (lowest id breaks ties); the lowest id when no member
 * reports a usable crowd value. Pure so tests pin the contract.
 */
function focusPointOf(members: MapPoint[]): MapPoint {
  const sorted = [...members].sort((a, b) =>
    a.beach.id < b.beach.id ? -1 : 1,
  );
  const withCrowd = sorted.filter((member) =>
    Number.isFinite(member.beach.crowd),
  );
  const pool = withCrowd.length > 0 ? withCrowd : sorted;
  return pool.reduce(
    (best, member) => (member.beach.crowd > best.beach.crowd ? member : best),
    pool[0],
  );
}

/** Look up the focus beach of a cluster among the projected points. */
export function clusterFocusBeach(
  cluster: HeatCluster,
  points: MapPoint[],
): Beach | null {
  return (
    points.find((point) => point.beach.id === cluster.focusBeachId)?.beach ??
    null
  );
}

/**
 * Single tap-dispatch contract for pins and heat clusters: the existing
 * onSelect always fires (both App.tsx call sites depend on it), and the
 * optional onBeachSelect — the heat-discovery "open beach detail"
 * emission — fires in addition when provided. Pure, so the emission is
 * unit-tested without a DOM.
 */
export function emitBeachTap(
  beach: Beach,
  onSelect: (beach: Beach) => void,
  onBeachSelect?: (beach: Beach) => void,
): void {
  onSelect(beach);
  onBeachSelect?.(beach);
}
