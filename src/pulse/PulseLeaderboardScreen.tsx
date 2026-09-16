/**
 * Beach Pulse leaderboard — consumer route wrapper.
 *
 * The wiring layer: it fetches the beach catalog once through ./api
 * (GET /api/beaches — the same endpoint the Discovery screen consumes),
 * then re-ranks it client-side with rankByPulse on every audience
 * switch — no reload, no refetch — so per-audience weights from
 * ./scoring drive the reshuffle. The chosen audience persists across
 * visits via the /pulse?audience= URL (shareable) and localStorage
 * (session-less default), using the route helpers from ../routes.
 *
 * `PulseLeaderboard` stays pure presentational: rows, loading, error and
 * empty states all flow into it as props.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import AudiencePicker from "./AudiencePicker";
import PulseLeaderboard from "./PulseLeaderboard";
import { rankByPulse } from "./scoring";
import {
  catalogToPulseInputs,
  fetchBeachCatalog,
  type PulseBeachRow,
} from "./api";
import type { PulseAudience } from "./types";
import { isPulseAudience, pulseRoutePath } from "../routes";

const AUDIENCE_STORAGE_KEY = "sunscout.pulse.audience";

/**
 * Initial audience: /pulse?audience=<x> wins, then the persisted
 * localStorage choice, then "family". Window-guarded so the component
 * stays SSR-safe.
 */
function readInitialAudience(): PulseAudience {
  if (typeof window !== "undefined") {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get(
        "audience",
      );
      if (isPulseAudience(fromUrl)) return fromUrl;
      const stored = window.localStorage.getItem(AUDIENCE_STORAGE_KEY);
      if (isPulseAudience(stored)) return stored;
    } catch {
      // Private mode / blocked storage — fall through to the default.
    }
  }
  return "family";
}

/** Persist the audience to localStorage and the shareable /pulse URL. */
function persistAudience(audience: PulseAudience) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUDIENCE_STORAGE_KEY, audience);
  } catch {
    // Storage unavailable — the in-memory selection still works.
  }
  try {
    window.history.replaceState(null, "", pulseRoutePath(audience));
  } catch {
    // replaceState is best-effort decoration, never a failure.
  }
}

export default function PulseLeaderboardScreen({
  onSelectBeach,
  beachNames,
}: {
  onSelectBeach?: (beachId: string) => void;
  /** id → display name, so rows can be labelled without a second fetch. */
  beachNames?: Record<string, string>;
}) {
  const [audience, setAudience] = useState<PulseAudience>(readInitialAudience);
  const [rows, setRows] = useState<PulseBeachRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // One clock per mount — re-ranking stays deterministic across audience
  // switches without re-reading the system clock mid-session.
  const [now] = useState(() => new Date());

  // The catalog is audience-independent: fetched once, never refetched
  // on an audience switch — switching re-ranks in place.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchBeachCatalog());
    } catch (cause) {
      setRows(null);
      setError(cause instanceof Error ? cause.message : "pulse_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onAudienceChange = useCallback((next: PulseAudience) => {
    setAudience(next);
    persistAudience(next);
  }, []);

  // Ranked rows for the selected audience — pure re-computation per
  // switch, exactly the scoring core's per-audience weights.
  const items = useMemo(() => {
    if (rows == null) return [];
    const names = new Map(
      rows.map((row) => [
        row.id,
        {
          name: beachNames?.[row.id] ?? row.name,
          region: row.location,
        },
      ]),
    );
    return rankByPulse(catalogToPulseInputs(rows), {
      audience,
      now,
    }).map((result) => ({
      id: result.id,
      name: names.get(result.id)?.name ?? result.id,
      region: names.get(result.id)?.region,
      score: result.score,
      staleConditions: result.staleConditions,
    }));
  }, [rows, audience, now, beachNames]);

  return (
    <div
      style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <AudiencePicker
        value={audience}
        onChange={onAudienceChange}
        label="Beach Pulse audience"
      />
      <PulseLeaderboard
        items={items}
        audience={audience}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        onSelect={onSelectBeach}
      />
    </div>
  );
}
