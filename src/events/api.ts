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

export type BeachEventsFanOut = {
  /** Merged published events across all requested beaches, deduped by publicId. */
  events: BeachEvent[];
  /** Beach ids whose feed could not be reached (offline/4xx/5xx). */
  failedBeachIds: string[];
};

/**
 * Consumer screen fan-out: fetch the published feed for every beach in the
 * catalog via the existing GET /api/events/beaches/:id handler — no new
 * server endpoint. Per-beach failures never fail the screen: successes
 * merge (deduped by event publicId) and failures are reported back so the
 * UI can show an honest partial-outage note.
 */
export async function fetchAllBeachEvents(
  beachPublicIds: readonly string[],
): Promise<BeachEventsFanOut> {
  const results = await Promise.allSettled(
    beachPublicIds.map((beachPublicId) => fetchBeachEvents(beachPublicId)),
  );
  const byPublicId = new Map<string, BeachEvent>();
  const failedBeachIds: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      for (const event of result.value) byPublicId.set(event.publicId, event);
    } else {
      failedBeachIds.push(beachPublicIds[index]);
    }
  });
  return { events: [...byPublicId.values()], failedBeachIds };
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
