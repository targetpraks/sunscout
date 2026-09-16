import { useEffect, useState } from "react";
import type { AdSurface, SponsoredPlacement, SponsoredTakeover } from "./types";

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

/**
 * The active brand takeover for one beach + contextual surface, or null.
 * Server-side scope ladder: beach beats island beats region; only windows
 * containing now are served. Public consumer surface, same as placements.
 */
export async function fetchActiveTakeover(
  beachPublicId: string,
  surface: AdSurface,
): Promise<SponsoredTakeover | null> {
  const body = await apiRequest<{ data: SponsoredTakeover | null }>(
    `/ads/takeover?beachId=${encodeURIComponent(beachPublicId)}` +
      `&surface=${encodeURIComponent(surface)}`,
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

export type ActiveTakeoverState = {
  takeover: SponsoredTakeover | null;
  loading: boolean;
  error: string | null;
};

/**
 * Fetches the active brand takeover for one beach + contextual surface.
 * Mirrors useActivePlacements: null beach id resolves without a request, and
 * an error never surfaces a takeover — paid inventory is never shown on a
 * failed read.
 */
export function useActiveTakeover(
  beachPublicId: string | null,
  surface: AdSurface,
  refreshKey = 0,
): ActiveTakeoverState {
  const [state, setState] = useState<ActiveTakeoverState>({
    takeover: null,
    loading: beachPublicId != null,
    error: null,
  });

  useEffect(() => {
    if (beachPublicId == null) {
      setState({ takeover: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchActiveTakeover(beachPublicId, surface)
      .then((takeover) => {
        if (!cancelled) {
          setState({ takeover, loading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            takeover: null,
            loading: false,
            error: error instanceof Error ? error.message : "ads_unavailable",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [beachPublicId, surface, refreshKey]);

  return state;
}
