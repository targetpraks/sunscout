/**
 * Share card assembly + share flow (PRD §5.5 — outbound social handoff).
 *
 * Pure, client-safe logic: no React, no window/navigator access at module
 * level, no network calls, no wall-clock reads. Everything that varies
 * (browser capabilities) is injected, so assembly is deterministic and
 * node-testable. Missing data degrades honestly (PRD §4.3) — fields are
 * omitted, never fabricated.
 */

import type { Beach } from "../types";
import type {
  ShareCard,
  ShareCardField,
  ShareConditions,
  ShareDeps,
  ShareOutcome,
} from "./types";

/**
 * Public web base for share deep links. The app has no router to resolve
 * this from, so it is a stable constant; callers can inject the real origin.
 */
export const SHARE_BASE_URL = "https://sunscout.app";

/** Stable deep link back to the beach page. */
export function beachDeepLink(
  beach: Pick<Beach, "slug" | "id">,
  baseUrl: string = SHARE_BASE_URL,
): string {
  const key = beach.slug ?? beach.id;
  return `${baseUrl}/beach/${encodeURIComponent(key)}`;
}

/** Crowds the same buckets the Beach Detail conditions grid uses. Kept local
 * (not imported from App.tsx) so this module stays client-pure. */
export function crowdLabel(percent: number): string {
  if (percent < 40) return "Low";
  if (percent < 70) return "Medium";
  if (percent < 90) return "High";
  return "Full";
}

const nonEmpty = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

type FieldSource = { label: string; value: string | null | undefined };

const toField = (source: FieldSource): ShareCardField | null =>
  nonEmpty(source.value) ? { label: source.label, value: source.value } : null;

/**
 * Deterministically assemble the "right now" share card for a beach.
 *
 * Overlay semantics: values supplied in `conditions` win over the beach's own
 * fields when present (callers can pass fresher data without mutating the
 * beach). Missing data is omitted from the card — it degrades honestly,
 * never fabricated. Same inputs always produce the same card.
 */
export function buildShareCard(
  beach: Beach,
  conditions: ShareConditions = {},
  baseUrl: string = SHARE_BASE_URL,
): ShareCard {
  const overlay = <T>(
    live: T | null | undefined,
    base: T | null | undefined,
  ) => (live != null ? live : (base ?? null));

  const rawCrowd = overlay(conditions.crowdPercent, beach.crowd);
  const crowd =
    typeof rawCrowd === "number" &&
    Number.isFinite(rawCrowd) &&
    rawCrowd >= 0 &&
    rawCrowd <= 100
      ? `${crowdLabel(rawCrowd)} (${rawCrowd}%)`
      : null;

  const candidateFields: FieldSource[] = [
    { label: "Sea temp", value: overlay(conditions.seaTemp, beach.seaTemp) },
    { label: "Waves", value: overlay(conditions.waves, beach.waves) },
    { label: "UV", value: overlay(conditions.uv, beach.uv) },
    { label: "Crowd", value: crowd },
    {
      label: "Water",
      value: overlay(conditions.waterQuality, beach.waterQuality),
    },
    { label: "Air", value: overlay(conditions.airTemp, beach.airTemp) },
    { label: "Wind", value: overlay(conditions.wind, beach.wind) },
    {
      label: "Cloud",
      value: overlay(conditions.cloudCover, beach.cloudCover),
    },
    {
      label: "Golden hour",
      value: overlay(conditions.goldenHour, beach.goldenHour),
    },
  ];

  const fields = candidateFields
    .map(toField)
    .filter((field): field is ShareCardField => field != null);

  const url = beachDeepLink(beach, baseUrl);
  const hasLiveConditions = fields.length > 0;
  const observedAt =
    conditions.observedAt ?? beach.provenance?.receivedAt ?? null;
  const freshness = observedAt ? ` (as of ${observedAt})` : "";
  const caption = hasLiveConditions
    ? `${beach.name} right now${freshness} — ${beach.decision}`
    : `Live conditions for ${beach.name} are temporarily unavailable — open the beach page for the latest.`;

  return {
    title: `${beach.name} — right now`,
    caption,
    url,
    fields,
    hasLiveConditions,
  };
}

/**
 * Serialize the card to a single clipboard-friendly text block. The deep
 * link is appended here (the clipboard path has no separate url field),
 * while the native share sheet receives caption and url separately.
 */
export function shareCardText(card: ShareCard): string {
  const lines = card.fields.map((field) => `${field.label}: ${field.value}`);
  return [card.title, ...lines, "", `${card.caption} ${card.url}`].join("\n");
}

/**
 * Push a card out through the browser: Web Share API first, async clipboard
 * fallback, "unavailable" when neither exists. Capability functions are
 * injected (`deps`) so path selection is pure and testable.
 *
 * A user cancelling the native share sheet (AbortError) is a normal outcome,
 * not an error: it resolves to "cancelled" without touching the clipboard.
 * Other native-share failures fall through to the clipboard instead of
 * erroring the whole flow.
 */
export async function shareCard(
  card: ShareCard,
  deps: ShareDeps = {},
): Promise<ShareOutcome> {
  if (typeof deps.share === "function") {
    try {
      await deps.share({
        title: card.title,
        text: card.caption,
        url: card.url,
      });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return "cancelled";
      }
      // fall through to the clipboard fallback below
    }
  }
  if (typeof deps.writeText === "function") {
    try {
      await deps.writeText(shareCardText(card));
      return "copied";
    } catch {
      return "failed";
    }
  }
  return "unavailable";
}

/**
 * Collect the browser share capabilities once, for injection into
 * shareCard. Safe in non-browser contexts (returns empty deps).
 */
export function browserShareDeps(
  nav: Navigator | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): ShareDeps {
  const deps: ShareDeps = {};
  if (!nav) return deps;
  // Bind before the guards: TS does not keep property narrowing inside
  // the closures below.
  const share = typeof nav.share === "function" ? nav.share.bind(nav) : null;
  const writeText =
    nav.clipboard && typeof nav.clipboard.writeText === "function"
      ? nav.clipboard.writeText.bind(nav.clipboard)
      : null;
  if (share) deps.share = (data) => share(data);
  if (writeText) deps.writeText = (text) => writeText(text);
  return deps;
}
