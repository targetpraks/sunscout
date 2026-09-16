import type { AccuracyCondition, AccuracySignal } from "./types";

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

async function accuracyRequest<T>(
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
  return response.json() as Promise<T>;
}

/** Fetch the aggregated per-condition accuracy signal for a beach. */
export async function fetchAccuracySignal(
  beachId: string,
): Promise<AccuracySignal> {
  const result = await accuracyRequest<{
    data: AccuracySignal & { beachId: string };
  }>(`/accuracy?beachId=${encodeURIComponent(beachId)}`);
  return {
    state: result.data.state,
    totalRatings: result.data.totalRatings,
    signal: result.data.signal,
  };
}

/**
 * Submit one rating for a single condition. The response carries the
 * refreshed aggregate signal so the UI updates without a page reload or a
 * second fetch.
 */
export async function submitAccuracyRating(
  beachId: string,
  condition: AccuracyCondition,
  rating: number,
): Promise<AccuracySignal> {
  const result = await accuracyRequest<{
    data: { recorded: boolean; signal: AccuracySignal };
  }>("/accuracy", {
    method: "POST",
    body: JSON.stringify({ beachId, condition, rating }),
  });
  return result.data.signal;
}
