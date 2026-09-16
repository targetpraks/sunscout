import { BadgeCheck, Info, LoaderCircle } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { BeachEvent } from "../types";
import {
  SPONSORED_LABEL,
  SPONSORSHIP_NOTE,
  normalizeTakeover,
  sponsorProblem,
  takeoverBadgeText,
  type TakeoverChange,
} from "./types";

const styles = {
  card: {
    borderRadius: 12,
    border: "1px dashed rgba(10,110,120,0.35)",
    background: "rgba(10,110,120,0.04)",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: "rgba(255,107,92,0.14)",
    color: "#FF6B5C",
  } satisfies CSSProperties,
  organic: {
    background: "rgba(91,107,123,0.12)",
    color: "#5B6B7B",
  } satisfies CSSProperties,
  input: {
    border: "1px solid rgba(15,30,46,0.18)",
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 13,
    flex: 1,
    minWidth: 140,
    background: "#FAF6F0",
    color: "#0F1E2E",
  } satisfies CSSProperties,
  note: {
    display: "flex",
    gap: 6,
    alignItems: "flex-start",
    margin: 0,
    fontSize: 12,
    color: "#5B6B7B",
  } satisfies CSSProperties,
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "none",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    background: "#0A6E78",
    color: "#FAF6F0",
  } satisfies CSSProperties,
  error: { margin: 0, fontSize: 12, color: "#FF6B5C" } satisfies CSSProperties,
};

export type TakeoverSettingsProps = {
  event: BeachEvent;
  /**
   * Applies the next sponsorship state to this window. The parent owns the
   * API call (./api applyTakeoverChange — create-replacement + cancel on
   * the existing /api/events handlers) and list reconciliation; reject to
   * surface the error here.
   */
  onApply: (change: TakeoverChange) => Promise<void>;
};

/**
 * Sponsorship controls for one event window: shows the current curated /
 * sponsored state with a visible "Sponsored" badge, and lets the coordinator
 * flip the window's sponsorship (sponsor name required when paid).
 *
 * Integrity rule: this component and its onApply contract can only touch
 * the event window's curated/branding layer. It never reads or writes
 * Beach Pulse, ranking, or live-condition data — asserted in
 * ./coordinator.test.ts.
 */
export function TakeoverSettings({ event, onApply }: TakeoverSettingsProps) {
  const [paid, setPaid] = useState(event.paidTakeover.isPaid);
  const [sponsorName, setSponsorName] = useState(
    event.paidTakeover.sponsorName ?? "",
  );
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentBadge = takeoverBadgeText(event);

  async function handleApply() {
    if (applying) return;
    const next = normalizeTakeover(paid, sponsorName);
    const problem = next.isPaid ? sponsorProblem(sponsorName) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await onApply(next);
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "Could not update sponsorship.",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.row}>
        <strong style={{ fontSize: 12, color: "#0F1E2E" }}>
          Takeover settings
        </strong>
        <span
          style={
            event.paidTakeover.isPaid
              ? styles.badge
              : { ...styles.badge, ...styles.organic }
          }
        >
          <BadgeCheck size={12} aria-hidden />
          {currentBadge ?? "Organic"}
        </span>
      </div>
      <label style={{ ...styles.row, fontSize: 13, color: "#0F1E2E" }}>
        <input
          type="checkbox"
          checked={paid}
          onChange={(change) => {
            setPaid(change.target.checked);
            setError(null);
          }}
        />
        Mark this window as a sponsored takeover ({SPONSORED_LABEL})
      </label>
      {paid && (
        <input
          style={styles.input}
          placeholder="Sponsor name"
          aria-label="Sponsor name"
          value={sponsorName}
          onChange={(change) => {
            setSponsorName(change.target.value);
            setError(null);
          }}
        />
      )}
      <p style={styles.note}>
        <Info size={13} aria-hidden />
        {SPONSORSHIP_NOTE}
      </p>
      {error && (
        <p style={styles.error} role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={applying}
        style={{
          ...styles.button,
          alignSelf: "flex-start",
          opacity: applying ? 0.6 : 1,
        }}
        onClick={() => void handleApply()}
      >
        {applying ? <LoaderCircle size={13} aria-hidden /> : null}
        Apply sponsorship
      </button>
    </div>
  );
}
