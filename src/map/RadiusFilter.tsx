import type { CSSProperties } from "react";

/** Distance-radius presets; 60 km is the full default map view. */
export const DEFAULT_RADIUS_OPTIONS = [10, 25, 50, 60];

const styles = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: "10px 18px 0",
    fontSize: 11,
    color: "#5A6B7A",
  } satisfies CSSProperties,
  label: {
    fontWeight: 600,
    marginRight: 2,
  } satisfies CSSProperties,
  button: {
    padding: "3px 10px",
    borderRadius: 999,
    border: "1px solid rgba(10,110,120,0.25)",
    background: "transparent",
    color: "#0A6E78",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
  active: {
    padding: "3px 10px",
    borderRadius: 999,
    border: "1px solid #0A6E78",
    background: "#0A6E78",
    color: "#FAF6F0",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
} satisfies Record<string, CSSProperties>;

/**
 * Controlled distance-radius filter for the beach map. The parent owns the
 * value (BeachMap keeps internal state when uncontrolled) — this component
 * is a pure function of props.
 */
export function RadiusFilter({
  value,
  options = DEFAULT_RADIUS_OPTIONS,
  onChange,
}: {
  /** Currently selected radius in km. */
  value: number;
  /** Selectable radii in km, ascending. */
  options?: number[];
  onChange: (km: number) => void;
}) {
  return (
    <div
      data-testid="radius-filter"
      style={styles.row}
      role="group"
      aria-label="Distance radius filter"
    >
      <span style={styles.label}>Within</span>
      {options.map((km) => (
        <button
          key={km}
          type="button"
          style={value === km ? styles.active : styles.button}
          aria-pressed={value === km}
          onClick={() => onChange(km)}
        >
          {km} km
        </button>
      ))}
    </div>
  );
}
