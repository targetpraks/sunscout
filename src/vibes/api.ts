// Client for the per-audience vibe vote API (server/vibes.ts).
// Mirrors the fetch conventions of ../api.ts (base URL, default user
// header, error envelope) because its apiRequest helper is not exported.

import type {
  BeachVibesResponse,
  CastVibeVoteResult,
  VibeVoteInput,
} from "./types";

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

/** GET /api/beaches/:id/vibes — per-vibe and per-audience aggregates. */
export async function fetchBeachVibes(
  beachId: string,
): Promise<BeachVibesResponse> {
  const body = await apiRequest<{ data: BeachVibesResponse }>(
    `/beaches/${encodeURIComponent(beachId)}/vibes`,
  );
  return body.data;
}

/**
 * POST /api/vibes — cast one vibe vote for a beach. Rejects (409) while the
 * 24h per-user-per-beach cooldown is active; the resolved value carries the
 * fresh aggregate plus the viewer's cooldown window.
 */
export async function castVibeVote(
  input: VibeVoteInput,
): Promise<CastVibeVoteResult> {
  const body = await apiRequest<{ data: CastVibeVoteResult }>("/vibes", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.data;
}
