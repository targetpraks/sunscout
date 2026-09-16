// Client for the Beach Pulse API surface. Mirrors the fetch conventions of
// ../api.ts (base URL, default user header, error envelope) because its
// apiRequest helper is not exported. Both endpoints are mounted in the
// server today:
//   GET /api/beaches            the consumer beach catalog (server/routes/beaches.ts)
//   GET /api/beaches/:id/pulse  per-audience Beach Pulse (server/pillarsRouter.ts)
//
// The pulse folder is deliberately standalone: types and row mapping live
// here rather than being imported from the shared ../api.ts.

import type { PulseInput, PulseResult } from "./types";

/**
 * One scored audience row served by GET /api/beaches/:id/pulse — the
 * server's PulseResult plus the display label for its audience.
 */
export type BeachPulseEntry = PulseResult & { label: string };

/**
 * Minimal catalog row shape the leaderboard consumes — a subset of the
 * GET /api/beaches payload (just the fields the Pulse scorer reads),
 * typed locally so the pulse folder stays standalone.
 */
export type PulseBeachRow = {
  id: string;
  name: string;
  location?: string;
  /** Live-condition display strings, e.g. "0.4m", "19°C", "6 High". */
  waves?: string | null;
  windSpeed?: string | null;
  seaTemp?: string | null;
  airTemp?: string | null;
  uv?: string | null;
  cloudCover?: string | null;
  /** How busy the beach is right now, 0-100 (numeric in the payload). */
  crowd?: number | null;
  provenance?: { observedAt?: string | null } | null;
};

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-sunscout-user-id": "00000000-0000-7000-8000-000000000001",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `api_${response.status}`);
  }
  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/**
 * GET /api/beaches/:id/pulse — the live Beach Pulse for one beach, one
 * entry per audience, scored server-side against the current condition
 * and community snapshot. Rejected on transport or server errors; callers
 * own the loading/error surface.
 */
export async function fetchBeachPulse(
  beachId: string,
): Promise<BeachPulseEntry[]> {
  const body = await apiRequest<{
    data: BeachPulseEntry[];
    meta?: { now: string };
  }>(`/beaches/${encodeURIComponent(beachId)}/pulse`);
  return body.data;
}

/** GET /api/beaches — the consumer beach catalog, for client-side ranking. */
export async function fetchBeachCatalog(): Promise<PulseBeachRow[]> {
  const body = await apiRequest<{ data: PulseBeachRow[] }>("/beaches");
  return body.data;
}

/**
 * Parse the leading number out of a display string ("19°C", "6 High",
 * "8 km/h"). Null when absent or unparseable — never NaN, which would
 * poison the scorer; missing signals fall back to the scorer's documented
 * defaults instead.
 */
export function parseDisplayNumber(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value == null) return null;
  const match = /-?\d+(?:\.\d+)?/.exec(value);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Map one catalog row (display strings) onto a PulseInput condition
 * snapshot. Unparseable signals stay null so the scorer's documented
 * MISSING_SIGNAL_DEFAULTS apply. The catalog carries no community
 * signals, so the community side is left unset — the scorer treats that
 * as "no matching signals" and conditions drive the ordering.
 */
export function pulseInputFromCatalogRow(row: PulseBeachRow): PulseInput {
  return {
    id: row.id,
    name: row.name,
    conditions: {
      observedAt: row.provenance?.observedAt ?? "",
      waveM: parseDisplayNumber(row.waves),
      windKmh: parseDisplayNumber(row.windSpeed),
      waterTempC: parseDisplayNumber(row.seaTemp),
      airTempC: parseDisplayNumber(row.airTemp),
      uvIndex: parseDisplayNumber(row.uv),
      crowdPct:
        typeof row.crowd === "number" && Number.isFinite(row.crowd)
          ? row.crowd
          : null,
      cloudPct: parseDisplayNumber(row.cloudCover),
    },
  };
}

/** Catalog rows → scorer inputs, preserving row order. */
export function catalogToPulseInputs(rows: PulseBeachRow[]): PulseInput[] {
  return rows.map(pulseInputFromCatalogRow);
}
