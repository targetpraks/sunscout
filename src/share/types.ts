/**
 * Share card types (PRD §5.5 — outbound social handoff).
 *
 * Pure data types — no React, no browser APIs — so the share card can be
 * assembled deterministically in node tests and consumed by any surface.
 */

/**
 * Live-condition overlay. Values here win over the corresponding Beach
 * fields when present, so a caller can pass fresher data without mutating
 * the beach object. Every field is optional — data degrades honestly.
 */
export type ShareConditions = {
  seaTemp?: string | null;
  waves?: string | null;
  uv?: string | null;
  crowdPercent?: number | null;
  waterQuality?: string | null;
  goldenHour?: string | null;
  airTemp?: string | null;
  wind?: string | null;
  cloudCover?: string | null;
  /** ISO timestamp of when the conditions were observed. */
  observedAt?: string | null;
};

/** A single line on the share card, e.g. "Waves — 0.5 m". */
export type ShareCardField = {
  label: string;
  value: string;
};

/** The fully assembled share card. Deterministic: same inputs, same output. */
export type ShareCard = {
  /** Share-sheet title, e.g. "Praia da Coelha — right now". */
  title: string;
  /** One-line caption for the share sheet / clipboard text. */
  caption: string;
  /** Deep link back to the beach on SunScout. */
  url: string;
  /** Condition lines in a stable order; missing data is omitted. */
  fields: ShareCardField[];
  /** True when at least one live condition field made it onto the card. */
  hasLiveConditions: boolean;
};

/** Result of attempting to share a card through the browser. */
export type ShareOutcome =
  | "shared"
  | "copied"
  | "unavailable"
  | "cancelled"
  | "failed";

/**
 * Browser capabilities injected into the share flow so fallback selection
 * is pure and testable in node. Both are optional — the flow degrades to
 * "unavailable" when neither exists.
 */
export type ShareDeps = {
  /** Web Share API (navigator.share). */
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  /** Async clipboard write (navigator.clipboard.writeText). */
  writeText?: (text: string) => Promise<void>;
};
