import { useEffect, useState } from "react";
import type { SponsoredPlacement } from "./types";

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

async function apiRequest<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `api_${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Active placements for one beach. Public consumer surface — no auth header,
 * unlike src/events/api.ts (sponsorships are clearly-labeled paid inventory,
 * not user-private data). `at` is omitted in normal use: the server defaults
 * to the current instant.
 */
export async function fetchActivePlacements(
  beachPublicId: string,
): Promise<SponsoredPlacement[]> {
  const body = await apiRequest<{ data: SponsoredPlacement[] }>(
    `/ads?beachId=${encodeURIComponent(beachPublicId)}`,
  );
  return body.data;
}

export type ActivePlacementsState = {
  placements: SponsoredPlacement[];
  loading: boolean;
  error: string | null;
};

/**
 * Fetches the sponsored rail content for one beach. Null id (no beach to
 * scope to) resolves to the honest empty state without a request.
 */
export function useActivePlacements(
  beachPublicId: string | null,
  refreshKey = 0,
): ActivePlacementsState {
  const [state, setState] = useState<ActivePlacementsState>({
    placements: [],
    loading: beachPublicId != null,
    error: null,
  });

  useEffect(() => {
    if (beachPublicId == null) {
      setState({ placements: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchActivePlacements(beachPublicId)
      .then((placements) => {
        if (!cancelled) {
          setState({ placements, loading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            placements: [],
            loading: false,
            error: error instanceof Error ? error.message : "ads_unavailable",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [beachPublicId, refreshKey]);

  return state;
}
