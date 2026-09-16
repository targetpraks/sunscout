import { useEffect, useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { AUDIENCE_LABELS, rankByPulse } from "./scoring";
import AudiencePicker from "./AudiencePicker";
import PulseBadge from "./PulseBadge";
import type { PulseAudience, PulseInput, PulseRankedItem } from "./types";

type Props = {
  /**
   * Pre-ranked rows (score desc), for the pre-scored/controlled mode.
   * Defensively re-sorted — never trusted blindly. Required (with
   * `audience`) unless `inputs` is passed.
   */
  items?: PulseRankedItem[];
  /** The audience leaderboard the rows were scored for. Required in controlled mode. */
  audience?: PulseAudience;
  /**
   * Raw Pulse inputs, for the self-scoring mode: the leaderboard then owns
   * the audience state, renders an AudiencePicker and re-ranks in place on
   * every switch — no reload, no fetch, no external state. Mutually
   * exclusive with `items`.
   */
  inputs?: PulseInput[];
  /** Injected clock for the self-scoring mode. Defaults to mount time. */
  now?: Date;
  loading?: boolean;
  /** When set, renders an error banner with a retry action instead of rows. */
  error?: string | null;
  onRetry?: () => void;
  /** Invoked with the beach id when a row is activated. */
  onSelect?: (id: string) => void;
  emptyMessage?: string;
  className?: string;
};

/**
 * prefers-reduced-motion: effect-subscribed so the first render never touches
 * window (SSR-safe) and the value tracks live OS changes.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return reduced;
}

const SKELETON_ROWS = 5;

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  fontFamily: "inherit",
  color: "#0F1E2E",
};

const bannerStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: "12px",
  textAlign: "center",
};

/**
 * Per-audience Beach Pulse leaderboard. Standalone: imports only from this
 * folder's ./scoring, ./types, ./PulseBadge and ./AudiencePicker — never from
 * shared shell files (src/types.ts, src/logic.ts, App.tsx).
 *
 * Two modes, both rendering purely from props:
 *
 * - Controlled (`items` + `audience`): pre-scored rows, no internal state.
 *   This is the contract the app shell already mounts; it is unchanged.
 * - Self-scoring (`inputs`, optionally `now`): the leaderboard owns the
 *   audience selection, renders the AudiencePicker above the list and
 *   re-ranks in place via rankByPulse on every chip switch. Loading, error
 *   and empty states still come from props; the list region is a polite
 *   live region so assistive tech announces the re-ranked order.
 */
export default function PulseLeaderboard({
  items,
  audience,
  inputs,
  now,
  loading = false,
  error = null,
  onRetry,
  onSelect,
  emptyMessage = "No beaches with a Pulse for this audience yet.",
  className,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const listId = useId();

  const ownsScoring = inputs !== undefined;
  const [picked, setPicked] = useState<PulseAudience>(audience ?? "family");
  const activeAudience = ownsScoring ? picked : (audience ?? "family");

  // One clock per `now` prop identity — re-ranking stays deterministic
  // across re-renders without reading the system clock on every render.
  const effectiveNow = useMemo(() => now ?? new Date(), [now]);

  // Self-scoring mode: rank the raw inputs for the selected audience.
  const computed = useMemo<PulseRankedItem[] | null>(() => {
    if (!ownsScoring) return null;
    const names = new Map(
      (inputs ?? []).map((beach) => [beach.id, beach.name ?? beach.id]),
    );
    return rankByPulse(inputs ?? [], {
      audience: picked,
      now: effectiveNow,
    }).map((result) => ({
      id: result.id,
      name: names.get(result.id) ?? result.id,
      score: result.score,
      staleConditions: result.staleConditions,
    }));
  }, [ownsScoring, inputs, picked, effectiveNow]);

  const ranked = useMemo(() => {
    const source = ownsScoring ? (computed ?? []) : (items ?? []);
    return [...source]
      .filter((item) => item && Number.isFinite(item.score))
      .sort(
        (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }, [ownsScoring, computed, items]);

  const title = `Beach Pulse — ${AUDIENCE_LABELS[activeAudience]}`;

  // In self-scoring mode the picker sits above every state so the audience
  // can be switched while loading, on error, or when the list is empty.
  const picker = ownsScoring ? (
    <AudiencePicker
      value={picked}
      onChange={setPicked}
      controlsId={listId}
      label="Beach Pulse audience"
    />
  ) : null;

  if (loading) {
    return (
      <section
        className={className}
        style={sectionStyle}
        aria-busy="true"
        aria-label={title}
      >
        {picker}
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 14px",
              borderRadius: "12px",
              backgroundColor: "#0F1E2E0D",
            }}
          >
            <span
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "6px",
                backgroundColor: "#0F1E2E1A",
                flex: "0 0 auto",
              }}
            />
            <span
              style={{
                width: `${65 - i * 8}%`,
                height: "16px",
                borderRadius: "6px",
                backgroundColor: "#0F1E2E1A",
              }}
            />
          </div>
        ))}
      </section>
    );
  }

  if (error) {
    return (
      <section
        className={className}
        style={sectionStyle}
        role="alert"
        aria-label={title}
      >
        {picker}
        <div style={{ ...bannerStyle, backgroundColor: "#FF6B5C1A" }}>
          <p style={{ margin: "0 0 10px", fontWeight: 600 }}>
            Couldn’t load the {AUDIENCE_LABELS[activeAudience]} leaderboard.
          </p>
          <p style={{ margin: "0 0 12px", fontSize: "13px", opacity: 0.8 }}>
            {error}
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
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
              Try again
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (ranked.length === 0) {
    return (
      <section className={className} style={sectionStyle} aria-label={title}>
        {picker}
        <div style={{ ...bannerStyle, backgroundColor: "#0F1E2E0D" }}>
          <p style={{ margin: 0 }}>{emptyMessage}</p>
        </div>
      </section>
    );
  }

  return (
    <section className={className} style={sectionStyle} aria-label={title}>
      {picker}
      <ol
        id={listId}
        aria-live={ownsScoring ? "polite" : undefined}
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {ranked.map((item, index) => (
          <li
            key={item.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 14px",
              borderRadius: "12px",
              backgroundColor: index === 0 ? "#0A6E780F" : "#FAF6F0",
              border: `1px solid ${index === 0 ? "#0A6E7855" : "#0F1E2E14"}`,
              // Row lift on hover is motion-only decoration — off under prefers-reduced-motion.
              transition: reducedMotion
                ? "none"
                : "transform 150ms ease, box-shadow 150ms ease",
              cursor: onSelect ? "pointer" : "default",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "24px",
                textAlign: "center",
                fontWeight: 700,
                color: index === 0 ? "#0A6E78" : "#0F1E2E",
                fontSize: "14px",
                flex: "0 0 auto",
              }}
            >
              {index + 1}
            </span>
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                minWidth: 0,
                flex: "1 1 auto",
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.name}
              </span>
              {item.region ? (
                <span style={{ fontSize: "12px", opacity: 0.65 }}>
                  {item.region}
                </span>
              ) : null}
            </span>
            <PulseBadge
              score={item.score}
              audience={activeAudience}
              staleConditions={item.staleConditions}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
