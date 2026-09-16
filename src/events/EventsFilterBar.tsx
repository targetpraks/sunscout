import type { CSSProperties } from "react";
import { AUDIENCE_LABELS, PULSE_AUDIENCES } from "../pulse/scoring";
import type { PulseAudience } from "../pulse/types";
import { EVENT_WINDOW_LABELS, EVENT_WINDOWS, type EventWindow } from "./types";

const styles = {
  bar: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(15,30,46,0.12)",
    background: "#fff",
  } satisfies CSSProperties,
  groupLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#5B6B7B",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,
  chip: {
    border: "1px solid rgba(15,30,46,0.12)",
    background: "#FAF6F0",
    color: "#0F1E2E",
    borderRadius: 999,
    padding: "4px 12px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
  chipActive: {
    background: "#0A6E78",
    borderColor: "#0A6E78",
    color: "#fff",
  } satisfies CSSProperties,
};

export type EventsFilterBarProps = {
  /** Selected date window (see EVENT_WINDOWS in ./types). */
  window: EventWindow;
  /** Selected pulse audience, or null for "anyone". */
  audience: PulseAudience | null;
  onWindowChange: (window: EventWindow) => void;
  onAudienceChange: (audience: PulseAudience | null) => void;
};

/**
 * Date-window and audience filter bar for the consumer events screen.
 * Fully controlled — the screen (EventsScreen) owns the state so tests can
 * render any combination directly.
 */
export function EventsFilterBar({
  window,
  audience,
  onWindowChange,
  onAudienceChange,
}: EventsFilterBarProps) {
  return (
    <div style={styles.bar} aria-label="Event filters">
      <span style={styles.groupLabel}>When</span>
      <div role="group" aria-label="Date window" style={styles.row}>
        {EVENT_WINDOWS.map((option) => (
          <button
            key={option}
            type="button"
            style={{
              ...styles.chip,
              ...(window === option ? styles.chipActive : {}),
            }}
            aria-pressed={window === option}
            onClick={() => onWindowChange(option)}
          >
            {EVENT_WINDOW_LABELS[option]}
          </button>
        ))}
      </div>
      <span style={styles.groupLabel}>Who's it for</span>
      <div role="group" aria-label="Audience" style={styles.row}>
        <button
          type="button"
          style={{
            ...styles.chip,
            ...(audience == null ? styles.chipActive : {}),
          }}
          aria-pressed={audience == null}
          onClick={() => onAudienceChange(null)}
        >
          Anyone
        </button>
        {PULSE_AUDIENCES.map((option) => (
          <button
            key={option}
            type="button"
            style={{
              ...styles.chip,
              ...(audience === option ? styles.chipActive : {}),
            }}
            aria-pressed={audience === option}
            onClick={() => onAudienceChange(option)}
          >
            {AUDIENCE_LABELS[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
