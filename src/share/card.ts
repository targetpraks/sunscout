/**
 * Outbound share-card assembly — the PRD 5.5 growth loop.
 *
 * Pure and deterministic: every function takes its inputs (including `now`)
 * explicitly and produces byte-identical output for identical input — no
 * wall clock, no randomness, no locale-dependent formatting. Safe to call
 * during render and in node tests.
 *
 * Deep-link shape (the app shell has no canonical beach URL yet, so this
 * module defines it): `${DEEP_LINK_BASE}/b/{slug|id}?${SHARE_UTM_QUERY}`.
 * If the app later defines its own beach route, change DEEP_LINK_BASE (or
 * pass `options.base`) — the tests here assert the documented shape.
 */

import type {
  ShareBeachIdentity,
  ShareCardLine,
  ShareCardPayload,
  ShareConditionSnapshot,
} from "./types";

/** Canonical public base for share deep links. */
export const DEEP_LINK_BASE = "https://sunscout.app";

/** Fixed attribution query, kept literal so URLs stay stable. */
export const SHARE_UTM_QUERY =
  "utm_source=share_card&utm_medium=social&utm_campaign=organic_share";

/** Placeholder shown when a live value is missing. */
export const MISSING_VALUE = "—";

/** Conditions older than this stop counting as "right now". */
export const SHARE_CONDITION_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * Stable deep link to a beach. Uses the slug when present, falls back to
 * the id, and always carries the fixed share attribution query.
 */
export function buildDeepLink(
  beach: { id: string; slug?: string | null },
  options: { base?: string } = {},
): string {
  const base = (options.base ?? DEEP_LINK_BASE).replace(/\/+$/, "");
  const slug = beach.slug?.trim();
  const key = slug ? slug : beach.id;
  return `${base}/b/${encodeURIComponent(key)}?${SHARE_UTM_QUERY}`;
}

function normalizeScore(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function normalizePercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildCaption(
  beachName: string,
  score: number | null,
  waterQuality: string | null,
  crowdPct: number | null,
  goldenHour: string | null,
): string {
  const parts: string[] = [];
  if (score != null) parts.push(`Pulse ${score}/100`);
  if (waterQuality != null) parts.push(`${waterQuality} water`);
  if (crowdPct != null) parts.push(`${crowdPct}% full`);
  if (goldenHour != null) parts.push(`golden hour ${goldenHour}`);
  const detail = parts.length > 0 ? `: ${parts.join(" · ")}` : "";
  return `${beachName} right now${detail} — live data on SunScout`;
}

function buildLines(
  score: number | null,
  waterQuality: string | null,
  crowdPct: number | null,
  goldenHour: string | null,
): ShareCardLine[] {
  return [
    {
      label: "Beach Pulse",
      value: score != null ? `${score}/100` : MISSING_VALUE,
    },
    { label: "Water quality", value: waterQuality ?? MISSING_VALUE },
    {
      label: "Crowd",
      value: crowdPct != null ? `${crowdPct}% full` : MISSING_VALUE,
    },
    { label: "Golden hour", value: goldenHour ?? MISSING_VALUE },
  ];
}

/**
 * Assemble the share-card payload from a beach identity and its condition
 * snapshot. Never throws: missing conditions degrade the card (placeholders
 * + a note) but the deep link still points at the beach, because the link
 * outlives any single condition reading.
 */
export function assembleShareCard(
  input: {
    beach: ShareBeachIdentity;
    conditions?: ShareConditionSnapshot | null;
  },
  now: Date,
): ShareCardPayload {
  const { beach, conditions = null } = input;
  const deepLink = buildDeepLink(beach);

  const observedAt = conditions ? normalizeText(conditions.observedAt) : null;
  const score = conditions ? normalizeScore(conditions.score) : null;
  const waterQuality = conditions
    ? normalizeText(conditions.waterQuality)
    : null;
  const crowdPct = conditions ? normalizePercent(conditions.crowdPct) : null;
  const goldenHour = conditions ? normalizeText(conditions.goldenHour) : null;

  const hasAnyMetric =
    score != null ||
    waterQuality != null ||
    crowdPct != null ||
    goldenHour != null;
  const observedMs = observedAt != null ? new Date(observedAt).getTime() : NaN;
  const staleConditions =
    !Number.isFinite(observedMs) ||
    now.getTime() - observedMs > SHARE_CONDITION_STALE_MS;

  return {
    beachId: beach.id,
    beachName: beach.name,
    region: beach.region ?? null,
    deepLink,
    observedAt,
    degraded: !hasAnyMetric || observedAt == null,
    staleConditions,
    score,
    waterQuality,
    crowdPct,
    goldenHour,
    caption: buildCaption(
      beach.name,
      score,
      waterQuality,
      crowdPct,
      goldenHour,
    ),
    lines: buildLines(score, waterQuality, crowdPct, goldenHour),
  };
}
