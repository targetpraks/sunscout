/**
 * Beach Pulse leaderboard — consumer route wrapper.
 *
 * `PulseLeaderboard` is a pure presentational component (props in, no I/O).
 * This wrapper is the wiring: it fetches the per-audience Pulse from the API,
 * lets the viewer switch audience, and hands ranked rows to the component.
 * Without this the leaderboard — the product's stated ranking moat — was
 * unreachable in the app.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import PulseLeaderboard from "./PulseLeaderboard";
import { AUDIENCE_LABELS } from "./scoring";
import type { PulseAudience } from "./types";

type ApiPulseEntry = {
  id: string;
  audience: PulseAudience;
  score: number;
  confidence: number;
  staleConditions: boolean;
  label: string;
};

type ApiBeach = {
  id: string;
  name: string;
  region?: string;
};

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

/** Audiences the engine scores, in the order shown in the switcher. */
const AUDIENCES = Object.keys(AUDIENCE_LABELS) as PulseAudience[];

export default function PulseLeaderboardScreen({
  onSelectBeach,
  beachNames,
}: {
  onSelectBeach?: (beachId: string) => void;
  /** id → display name, so rows can be labelled without a second fetch. */
  beachNames?: Record<string, string>;
}) {
  const [audience, setAudience] = useState<PulseAudience>("family");
  const [entries, setEntries] = useState<ApiPulseEntry[]>([]);
  const [beaches, setBeaches] = useState<ApiBeach[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/beaches`);
      if (!response.ok) throw new Error(`beaches_${response.status}`);
      const payload = (await response.json()) as { data: ApiBeach[] };
      setBeaches(payload.data);

      // Score every beach for the selected audience, then rank across beaches.
      const results = await Promise.all(
        payload.data.map(async (beach) => {
          const pulseResponse = await fetch(
            `${API_BASE}/beaches/${beach.id}/pulse`,
          );
          if (!pulseResponse.ok) return null;
          const pulse = (await pulseResponse.json()) as {
            data: ApiPulseEntry[];
          };
          const match = pulse.data.find((entry) => entry.audience === audience);
          return match ?? null;
        }),
      );

      setEntries(
        results.filter((entry): entry is ApiPulseEntry => entry !== null),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "pulse_unavailable");
    } finally {
      setLoading(false);
    }
  }, [audience]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameFor = useCallback(
    (id: string) =>
      beachNames?.[id] ?? beaches.find((beach) => beach.id === id)?.name ?? id,
    [beaches, beachNames],
  );

  const items = useMemo(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        name: nameFor(entry.id),
        score: entry.score,
        staleConditions: entry.staleConditions,
      })),
    [entries, nameFor],
  );

  return (
    <div style={{ padding: 16 }}>
      <div
        role="tablist"
        aria-label="Audience"
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          paddingBottom: 12,
        }}
      >
        {AUDIENCES.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={audience === id}
            onClick={() => setAudience(id)}
            style={{
              flex: "0 0 auto",
              padding: "8px 14px",
              borderRadius: 999,
              border: "1px solid rgba(15,30,46,0.12)",
              background: audience === id ? "#0A6E78" : "#FFFFFF",
              color: audience === id ? "#FFFFFF" : "#0F1E2E",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {AUDIENCE_LABELS[id]}
          </button>
        ))}
      </div>

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
