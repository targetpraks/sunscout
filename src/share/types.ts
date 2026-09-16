/**
 * Outbound share-card + deep-link types — the PRD 5.5 social handoff.
 *
 * Standalone like the Pulse module: no imports from the app shell. The
 * live-condition shape extends the Pulse `ConditionSnapshot` (reused, not
 * duplicated) with the display fields a share card adds: the Pulse score,
 * the water-quality label and the golden-hour window. Every signal stays
 * nullable — missing values fall back to documented defaults in card.ts.
 */

import type { ConditionSnapshot } from "../pulse/types";

/** Beach identity as the share system needs it: deep-link key + labels. */
export type ShareBeachIdentity = {
  id: string;
  /** Preferred deep-link key; falls back to `id` when missing. */
  slug?: string | null;
  name: string;
  region?: string | null;
};

/**
 * Live-condition snapshot for one beach at one moment. Extends the Pulse
 * condition row; all extra fields are nullable so a card can render from
 * partial data (degraded, never broken).
 */
export type ShareConditionSnapshot = ConditionSnapshot & {
  /** Beach Pulse score 0-100, if computed. */
  score?: number | null;
  /** Human water-quality label, e.g. "Good". */
  waterQuality?: string | null;
  /** Human golden-hour window, e.g. "19:42–20:24". */
  goldenHour?: string | null;
};

/** Everything a surface needs to hand a beach off to TikTok/Instagram. */
export type ShareTarget = {
  beach: ShareBeachIdentity;
  conditions: ShareConditionSnapshot | null;
};

/** One display row on the card; rows render in fixed order. */
export type ShareCardLine = {
  label: string;
  value: string;
};

/**
 * Deterministic card payload produced by card.ts. Pure data, no React —
 * components render it, tests assert on it byte-for-byte.
 */
export type ShareCardPayload = {
  beachId: string;
  beachName: string;
  region: string | null;
  /** Stable deep link to the beach (plain https URL, copyable). */
  deepLink: string;
  /** ISO timestamp backing the values, null when unknown. */
  observedAt: string | null;
  /** True when no real metric (or no timestamp) backs the card. */
  degraded: boolean;
  /** True when the snapshot is missing or older than the staleness window. */
  staleConditions: boolean;
  /** Clamped 0-100 integer, or null when unknown. */
  score: number | null;
  waterQuality: string | null;
  /** Clamped 0-100 integer, or null when unknown. */
  crowdPct: number | null;
  goldenHour: string | null;
  /** Ready-to-paste caption for TikTok/IG, ending in the SunScout handoff. */
  caption: string;
  /** Display rows in fixed order; missing values render as "—". */
  lines: ShareCardLine[];
};
