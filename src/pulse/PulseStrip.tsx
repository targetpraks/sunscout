/**
 * Beach Pulse strip — the per-beach summary mounted on Beach Detail's
 * community section. Shows the live numeric Pulse score for the current
 * audience plus the top contributing factors, so a beachgoer sees *why*
 * the beach scores what it does without opening the full leaderboard.
 *
 * Data flows through ./api (GET /api/beaches/:id/pulse — all audiences in
 * one call, so an audience prop change re-selects without a refetch).
 * Loading, error and empty states are honest, mirroring VibeBar: skeleton
 * while loading, role="alert" + retry on error, explicit message when the
 * beach has no Pulse for the audience. `initialEntry`/`initialError` seed
 * the first render for tests and server-rendered shells, following
 * VibeBar's initialAggregate/initialError pattern.
 */
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import PulseBadge from "./PulseBadge";
import { fetchBeachPulse } from "./api";
import type { BeachPulseEntry } from "./api";
import { AUDIENCE_LABELS } from "./scoring";
import type { PulseAudience, PulseBreakdown } from "./types";

type Props = {
  beachId: string;
  /**
   * The audience whose Pulse is displayed — defaults to "family". The
   * beach's primary suitability tag is mapped by the parent (Beach
   * Community Section); the strip itself stays presentational about it.
   */
  audience?: PulseAudience;
  /** Pre-seeded result for tests / SSR — skips the loading flash. */
  initialEntry?: BeachPulseEntry | null;
  /** Pre-seeded error for tests / SSR. */
  initialError?: string | null;
  className?: string;
};

type FactorKey = "conditions" | "community" | "activity" | "vibe";

export type PulseFactor = {
  key: FactorKey;
  label: string;
  /** Rounded 0-100 sub-score. */
  score: number;
};

const FACTOR_LABELS: Record<FactorKey, string> = {
  conditions: "Live conditions",
  community: "Community signals",
  activity: "Recent activity",
  vibe: "Vibe votes",
};

/**
 * The top-N contributing factors of a Pulse breakdown, by sub-score.
 * Deterministic: equal scores keep the documented preference order
 * conditions > community > activity > vibe (Array#sort is stable).
 */
export function topFactors(
  breakdown: PulseBreakdown,
  count = 2,
): PulseFactor[] {
  const candidates: Array<{ key: FactorKey; score: number }> = [
    { key: "conditions", score: breakdown.conditions },
    { key: "community", score: breakdown.community },
    { key: "activity", score: breakdown.activity },
    { key: "vibe", score: breakdown.vibe },
  ];
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((factor) => ({
      key: factor.key,
      label: FACTOR_LABELS[factor.key],
      score: Math.round(factor.score),
    }));
}

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  fontFamily: "inherit",
  color: "#0F1E2E",
};

const listStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const factorStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: "6px",
  padding: "4px 10px",
  borderRadius: "8px",
  backgroundColor: "#0A6E780F",
  border: "1px solid #0A6E7833",
  fontSize: "13px",
  lineHeight: 1.2,
};

export function PulseStrip({
  beachId,
  audience = "family",
  initialEntry = null,
  initialError = null,
  className,
}: Props) {
  const [entries, setEntries] = useState<BeachPulseEntry[] | null>(
    initialEntry ? [initialEntry] : null,
  );
  const [error, setError] = useState<string | null>(initialError);

  const load = useCallback(async () => {
    setError(null);
    try {
      const fetched = await fetchBeachPulse(beachId);
      setEntries(fetched);
    } catch (cause) {
      setEntries(null);
      setError(cause instanceof Error ? cause.message : "pulse_unavailable");
    }
  }, [beachId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The endpoint returns one entry per audience; select the current one.
  const entry =
    entries == null
      ? null
      : (entries.find((item) => item.audience === audience) ?? null);

  const retry = (
    <button
      type="button"
      onClick={() => void load()}
      style={{
        padding: "8px 18px",
        borderRadius: "8px",
        border: "1px solid #0A6E78",
        backgroundColor: "#0A6E78",
        color: "#FAF6F0",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Retry
    </button>
  );

  if (error != null) {
    return (
      <section
        className={className}
        style={sectionStyle}
        role="alert"
        aria-label={`Beach Pulse — ${AUDIENCE_LABELS[audience]}`}
      >
        <h3 style={{ margin: 0, fontSize: "15px" }}>Beach Pulse</h3>
        <p style={{ margin: 0, fontSize: "13px" }}>
          Couldn’t load the Beach Pulse. {error}
        </p>
        {retry}
      </section>
    );
  }

  if (entry == null) {
    // Entries loaded but none for this audience (or none at all).
    if (entries != null) {
      return (
        <section
          className={className}
          style={sectionStyle}
          aria-label={`Beach Pulse — ${AUDIENCE_LABELS[audience]}`}
        >
          <h3 style={{ margin: 0, fontSize: "15px" }}>Beach Pulse</h3>
          <p style={{ margin: 0, fontSize: "13px" }}>
            No Pulse yet for {AUDIENCE_LABELS[audience].toLowerCase()} — be the
            first to check in.
          </p>
        </section>
      );
    }
    // Still loading.
    return (
      <section
        className={className}
        style={sectionStyle}
        aria-busy="true"
        aria-label={`Beach Pulse — ${AUDIENCE_LABELS[audience]}`}
      >
        <h3 style={{ margin: 0, fontSize: "15px" }}>Beach Pulse</h3>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "120px",
            height: "24px",
            borderRadius: "999px",
            backgroundColor: "#0F1E2E14",
          }}
        />
        <p style={{ margin: 0, fontSize: "13px", opacity: 0.7 }}>
          Loading the live Beach Pulse…
        </p>
      </section>
    );
  }

  const factors = topFactors(entry.breakdown, 2);

  return (
    <section
      className={className}
      style={sectionStyle}
      data-beach-id={beachId}
      data-pulse-score={entry.score}
      aria-label={`Beach Pulse — ${AUDIENCE_LABELS[audience]}`}
    >
      <h3 style={{ margin: 0, fontSize: "15px" }}>Beach Pulse</h3>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <PulseBadge
          score={entry.score}
          audience={audience}
          staleConditions={entry.staleConditions}
        />
        <span style={{ fontSize: "12px", opacity: 0.65 }}>
          for {entry.label ?? AUDIENCE_LABELS[audience]}
        </span>
      </div>
      <ul style={listStyle} aria-label="Top contributing factors">
        {factors.map((factor) => (
          <li key={factor.key} style={factorStyle}>
            <span style={{ opacity: 0.75 }}>{factor.label}</span>
            <span style={{ fontWeight: 700 }}>{factor.score}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default PulseStrip;
