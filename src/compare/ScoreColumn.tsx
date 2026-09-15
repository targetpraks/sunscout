/**
 * Beach compare — per-audience Pulse score cell.
 *
 * Wraps the shared PulseBadge (imported from ../pulse — never modified) so
 * the compare surface's score presentation is identical to the rest of the
 * app, and adds a highlight variant for the highest-scoring beach of the
 * comparison. Purely presentational: all data arrives via props.
 */

import type { CSSProperties } from "react";
import PulseBadge from "../pulse/PulseBadge";
import type { PulseAudience } from "../pulse/types";

type Props = {
  /** 0-100 per-audience Beach Pulse score. */
  score: number;
  /** Audience the score was computed for — badge label only. */
  audience?: PulseAudience;
  /** Renders the badge skeleton instead of a value. */
  loading?: boolean;
  /** Passed through to PulseBadge (conditions older than the 6h window). */
  staleConditions?: boolean;
  /** True when this beach has the highest score of the comparison. */
  isTop?: boolean;
  /** Optional beach name for accessible labels. */
  beachName?: string;
};

const TOP_RING = "2px solid #2E8B6B";
const TOP_BG = "#2E8B6B14";

/**
 * Score cell with a winner highlight. The highlight is a ring + tint around
 * the same PulseBadge used everywhere else — tier colors, dot animation and
 * label all come from the badge itself, so variants stay consistent by
 * construction, not by copy.
 */
export default function ScoreColumn({
  score,
  audience,
  loading = false,
  staleConditions = false,
  isTop = false,
  beachName,
}: Props) {
  const shellStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 6px",
    borderRadius: "12px",
    border: isTop ? TOP_RING : "2px solid transparent",
    backgroundColor: isTop ? TOP_BG : "transparent",
  };

  const ariaLabel = isTop
    ? `Highest Beach Pulse score${beachName ? ` — ${beachName}` : ""}`
    : undefined;

  return (
    <span style={shellStyle} aria-label={ariaLabel}>
      <PulseBadge
        score={score}
        audience={audience}
        loading={loading}
        staleConditions={staleConditions}
      />
    </span>
  );
}
