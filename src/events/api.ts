import type { BeachEvent, EventInput } from "./types";

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
 * Consumer calendar feed for one beach: published events only. Never passes
 * a coordinator id — ownership filtering is a server-side concern.
 */
export async function fetchBeachEvents(
  beachPublicId: string,
): Promise<BeachEvent[]> {
  return apiRequest<BeachEvent[]>(
    `/events/beaches/${encodeURIComponent(beachPublicId)}`,
  );
}

/** All events owned by the signed-in coordinator, any state. */
export async function fetchCoordinatorEvents(): Promise<BeachEvent[]> {
  return apiRequest<BeachEvent[]>(`/events/mine`);
}

export async function createEvent(input: EventInput): Promise<BeachEvent> {
  return apiRequest<BeachEvent>(`/events`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function publishEvent(eventPublicId: string): Promise<BeachEvent> {
  return apiRequest<BeachEvent>(
    `/events/${encodeURIComponent(eventPublicId)}/publish`,
    { method: "POST" },
  );
}

export async function cancelEvent(eventPublicId: string): Promise<BeachEvent> {
  return apiRequest<BeachEvent>(
    `/events/${encodeURIComponent(eventPublicId)}/cancel`,
    { method: "POST" },
  );
}

/**
 * Live ("what's happening now") events for one beach at an instant. Omit
 * `at` to let the server use its own clock. Raw array, matching the rest of
 * the events client contract.
 */
export async function fetchEventsNow(
  beachPublicId: string,
  at?: Date,
): Promise<BeachEvent[]> {
  const search = new URLSearchParams({ beachId: beachPublicId });
  if (at != null) search.set("at", at.toISOString());
  return apiRequest<BeachEvent[]>(`/events/now?${search.toString()}`);
}

/**
 * Upcoming published events for one beach, soonest first. `from` defaults to
 * the server clock; `limit` caps the count (1..50, default 10).
 */
export async function fetchUpcomingEvents(
  beachPublicId: string,
  from?: Date,
  limit?: number,
): Promise<BeachEvent[]> {
  const search = new URLSearchParams();
  if (from != null) search.set("from", from.toISOString());
  if (limit != null) search.set("limit", String(limit));
  const query = search.toString();
  return apiRequest<BeachEvent[]>(
    `/events/beaches/${encodeURIComponent(beachPublicId)}/upcoming${query ? `?${query}` : ""}`,
  );
}
