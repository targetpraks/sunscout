/**
 * Beach Map heat-discovery layer — shared view types.
 *
 * Pure data contracts only: no component, fetch or clock access lives here so
 * the projection/binning core in ./pulseHeat stays trivially testable in the
 * node vitest environment (no DOM).
 */

import type { Beach } from "../types";

/** Where the map is centered — the "you are here" origin. */
export type MapOrigin = {
  label: string;
  latitude: number;
  longitude: number;
};

/** Display tier for a 0-100 pulse score on the map — mirrors badgeTier(). */
export type PulseTier = "great" | "good" | "fair" | "poor";

/** One beach projected onto the map's pixel grid. */
export type MapPoint = {
  beach: Beach;
  /** East-west offset from the origin in km (positive = east). */
  xKm: number;
  /** North-south offset from the origin in km (positive = north). */
  yKm: number;
  /** Pixel offset from the map's left edge. */
  x: number;
  /** Pixel offset from the map's top edge. */
  y: number;
  /** Straight-line distance from the origin in km. */
  distanceKm: number;
};

/** A crowd-density heat cluster: all map points binned into one grid cell. */
export type HeatCluster = {
  /** Stable grid key ("col:row" integer cell indices) — deterministic per input. */
  key: string;
  /** Centroid x in pixels. */
  x: number;
  /** Centroid y in pixels. */
  y: number;
  beachIds: string[];
  /**
   * Mean live crowd percent (0-100) across member beaches that report one.
   * Null when no member has a finite crowd value — rendered as "no heat data"
   * rather than a fabricated zero.
   */
  avgCrowd: number | null;
  count: number;
  /** Beach a cluster tap resolves to (highest live crowd, lowest id tiebreak). */
  focusBeachId: string;
};
