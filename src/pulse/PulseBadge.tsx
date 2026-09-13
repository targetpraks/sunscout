import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { badgeTier, pulseLabel } from "./scoring";
import type { PulseAudience } from "./types";

type Props = {
  /** 0-100 Beach Pulse score. Clamped internally; NaN treated as 0. */
  score: number;
  /** Optional audience the score was computed for — only used for the label. */
  audience?: PulseAudience;
  /** Renders a same-size skeleton instead of a value. */
  loading?: boolean;
  /** Marks the underlying condition row as older than the 6h stale window. */
  staleConditions?: boolean;
  className?: string;
};

type Tier = "great" | "good" | "fair" | "poor";

const TIER_COLORS: Record<Tier, string> = {
  great: "#2E8B6B",
  good: "#0A6E78",
  fair: "#FF6B5C",
  poor: "#8B4A4A",
};

/**
 * prefers-reduced-motion: subscribed in an effect so the first render is
 * SSR-safe (no window access during render), and the value updates live if
 * the OS setting changes.
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

function finiteScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Inline Beach Pulse badge — the per-audience score chip used beside a beach
 * name. Standalone: imports only from this folder's ./scoring and ./types;
 * never from shared shell files (src/types.ts, src/logic.ts, App.tsx).
 */
export default function PulseBadge({
  score,
  audience,
  loading = false,
  staleConditions = false,
  className,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const value = finiteScore(score);
  const tier = badgeTier(value);
  const color = TIER_COLORS[tier];
  const label = pulseLabel(value);

  const shellStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    borderRadius: "999px",
    backgroundColor: `${color}1A`,
    border: `1px solid ${color}55`,
    fontFamily: "inherit",
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: 1.2,
    color: "#0F1E2E",
    whiteSpace: "nowrap",
  };

  const dotStyle: CSSProperties = {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: color,
    // Motion nicety only — fully disabled under prefers-reduced-motion; the
    // badge never depends on animation to convey the score.
    animation: reducedMotion
      ? undefined
      : "pulse-badge-breathe 2.4s ease-in-out infinite",
    flex: "0 0 auto",
  };

  const content = loading ? (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "34px",
        height: "13px",
        borderRadius: "4px",
        backgroundColor: "#0F1E2E1F",
      }}
    />
  ) : (
    <>
      <span style={dotStyle} aria-hidden="true" />
      <span>
        {value}
        <span style={{ fontWeight: 500, opacity: 0.75 }}> · {label}</span>
      </span>
      {staleConditions ? (
        <span
          title="Live conditions older than 6h — score may be outdated"
          style={{ opacity: 0.7, fontWeight: 500 }}
        >
          · stale
        </span>
      ) : null}
    </>
  );

  return (
    <span
      className={className}
      style={shellStyle}
      aria-label={
        loading
          ? "Beach Pulse loading"
          : `Beach Pulse ${value} of 100, ${label}${
              audience ? ` for ${audience}` : ""
            }${staleConditions ? ", live conditions may be outdated" : ""}`
      }
    >
      {content}
    </span>
  );
}
