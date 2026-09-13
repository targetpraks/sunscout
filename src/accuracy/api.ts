import type {
  AccuracyCondition,
  BeachAccuracy,
  ConditionAccuracy,
} from "./types";
import { LOW_CONFIDENCE_THRESHOLD, RATING_COOLDOWN_HOURS } from "./types";

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

/** Conditions whose aggregate score is meaningfully low (null = insufficient data, never low). */
export function hasLowConfidence(
  conditions: ConditionAccuracy[],
): ConditionAccuracy[] {
  return conditions.filter(
    (condition) =>
      condition.score != null && condition.score < LOW_CONFIDENCE_THRESHOLD,
  );
}

/** Milliseconds left in the 24h re-rating cooldown; 0 when rating is allowed. */
export function cooldownRemainingMs(
  yourLastRatedAt: string | null,
  now: number,
): number {
  if (!yourLastRatedAt) return 0;
  const last = Date.parse(yourLastRatedAt);
  if (Number.isNaN(last)) return 0;
  const cooldownMs = RATING_COOLDOWN_HOURS * 60 * 60 * 1_000;
  return Math.max(0, last + cooldownMs - now);
}

export function isRateDisabled(
  yourLastRatedAt: string | null,
  now: number,
): boolean {
  return cooldownRemainingMs(yourLastRatedAt, now) > 0;
}

export async function fetchBeachAccuracy(
  beachId: string,
): Promise<BeachAccuracy | null> {
  try {
    const result = await apiRequest<{ data: BeachAccuracy }>(
      `/beaches/${encodeURIComponent(beachId)}/accuracy`,
    );
    return result.data;
  } catch {
    return null;
  }
}

export async function submitAccuracyRating(input: {
  beachId: string;
  condition: AccuracyCondition;
  rating: number;
}): Promise<{
  data: {
    recorded: boolean;
    capturedAt: string;
    conditions: ConditionAccuracy[];
  };
}> {
  return apiRequest("/accuracy", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
