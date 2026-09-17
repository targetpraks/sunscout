import type { CSSProperties } from "react";
import {
  PULSE_TIER_COLORS,
  PULSE_TIER_LABELS,
  PULSE_TIER_ORDER,
  crowdOpacity,
} from "./pulseHeat";

const styles = {
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    margin: "6px 18px 10px",
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(15,30,46,0.08)",
    background: "rgba(250,246,240,0.7)",
    fontSize: 10,
    color: "#5A6B7A",
  } satisfies CSSProperties,
  item: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  swatch: {
    display: "inline-block",
    width: 9,
    height: 9,
    borderRadius: 999,
  } satisfies CSSProperties,
  heatSwatch: {
    display: "inline-block",
    width: 12,
    height: 12,
    borderRadius: 999,
    background: "#FF6B5C",
  } satisfies CSSProperties,
} satisfies Record<string, CSSProperties>;

/**
 * Beach Pulse legend for the map: the deterministic pin-color ladder (same
 * 75/55/35 boundaries as the Pulse leaderboard's badge tiers) plus the
 * crowd-heat swatch. Pure presentational — no data, no fetch, no clock.
 */
export function MapLegend() {
  return (
    <div
      data-testid="map-legend"
      style={styles.row}
      role="list"
      aria-label="Beach Pulse legend"
    >
      <span style={styles.item} role="listitem">
        Pulse
      </span>
      {PULSE_TIER_ORDER.map((tier) => (
        <span key={tier} style={styles.item} role="listitem">
          <span
            style={{ ...styles.swatch, background: PULSE_TIER_COLORS[tier] }}
          />
          {PULSE_TIER_LABELS[tier]}
        </span>
      ))}
      <span style={styles.item} role="listitem">
        <span
          style={{
            ...styles.heatSwatch,
            opacity: crowdOpacity(70),
          }}
        />
        Crowd heat
      </span>
    </div>
  );
}
