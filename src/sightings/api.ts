import type { NewSightingInput, Sighting } from "./types";

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
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      issues?: string[];
    };
    const detail =
      body.error ?? body.issues?.join(" ") ?? `api_${response.status}`;
    throw new Error(detail);
  }
  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/** Capture a new sighting (native media or attributed outbound link). */
export async function submitSighting(input: NewSightingInput) {
  const result = await apiRequest<{ data: Sighting }>("/sightings", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.data;
}

/**
 * Fetch sightings for a beach, most recent first. Pass `limit` to cap the
 * count (the rail uses a small N) — the server selector is
 * expiry/moderation-aware.
 */
export async function fetchSightings(
  beachId?: string,
  limit?: number,
): Promise<Sighting[]> {
  const search = new URLSearchParams();
  if (beachId) search.set("beachId", beachId);
  if (limit != null) search.set("limit", String(limit));
  const query = search.toString();
  const result = await apiRequest<{ data: Sighting[] }>(
    `/sightings${query ? `?${query}` : ""}`,
  );
  return result.data;
}
