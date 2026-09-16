import { useCallback, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useActivePlacements } from "./api";
import { SponsoredSlot } from "./SponsoredSlot";
import { activePlacementsAt, type SponsoredPlacement } from "./types";

const styles = {
  section: {
    // Horizontal margin matches .beach-map's `margin: 10px 18px` so the rail
    // aligns with the map surface it is rendered beneath.
    margin: "8px 18px 10px",
    borderRadius: 10,
    border: "1px solid rgba(15,30,46,0.10)",
    background: "rgba(255,107,92,0.04)",
    overflow: "hidden",
  } satisfies CSSProperties,
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 700,
    color: "#0F1E2E",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } satisfies CSSProperties,
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    background: "rgba(255,107,92,0.14)",
    color: "#FF6B5C",
  } satisfies CSSProperties,
  body: {
    padding: "10px 12px",
    fontSize: 12,
    color: "#5B6B7B",
    borderTop: "1px solid rgba(15,30,46,0.08)",
  } satisfies CSSProperties,
  retry: {
    marginTop: 6,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(10,110,120,0.3)",
    background: "transparent",
    color: "#0A6E78",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0 } satisfies CSSProperties,
  note: {
    marginTop: 4,
    fontSize: 10,
    color: "#5B6B7B",
  } satisfies CSSProperties,
};

export type SponsoredRailViewProps = {
  beachName?: string | null;
  placements: SponsoredPlacement[];
  loading?: boolean;
  error?: string | null;
  now?: Date;
  onRetry?: () => void;
};

/**
 * Pure presentation of the sponsored rail. The "Sponsored" disclosure is
 * rendered in EVERY state (loading, error, empty, populated) — paid
 * inventory is never shown unlabeled, and its absence is stated honestly
 * (PRD §4.6: paid placements never touch the Beach Pulse ranking).
 */
export function SponsoredRailView({
  beachName,
  placements,
  loading = false,
  error = null,
  now,
  onRetry,
}: SponsoredRailViewProps) {
  // Re-apply the half-open window client-side so a stale cached response can
  // never render expired inventory.
  const active = activePlacementsAt(placements, now ?? new Date());

  let content: string | ReactNode;
  if (loading && active.length === 0) {
    content = "Loading sponsored placements…";
  } else if (error && active.length === 0) {
    content = (
      <>
        <span>Sponsored placements are unavailable right now.</span>
        {onRetry ? (
          <button type="button" style={styles.retry} onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </>
    );
  } else if (active.length === 0) {
    content = (
      <>
        <span>
          No sponsored placements for {beachName ? beachName : "this beach"}{" "}
          right now.
        </span>
        <p style={styles.note}>
          Paid placements are shown separately and never affect the Beach Pulse
          ranking or live condition data.
        </p>
      </>
    );
  } else {
    content = (
      <ul style={styles.list}>
        {active.map((placement) => (
          <SponsoredSlot key={placement.publicId} placement={placement} />
        ))}
      </ul>
    );
  }

  return (
    <aside
      style={styles.section}
      role="region"
      aria-label="Sponsored placements"
    >
      <div style={styles.heading}>
        <span style={styles.badge}>Sponsored</span>
        {beachName ? <span>{beachName}</span> : null}
      </div>
      <div style={styles.body}>{content}</div>
    </aside>
  );
}

/**
 * Container: fetches the active placements for the currently focused beach
 * and renders the rail. A null id renders the honest empty state without a
 * network request.
 */
export function SponsoredRail({
  beachPublicId,
  beachName,
}: {
  beachPublicId: string | null;
  beachName?: string | null;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { placements, loading, error } = useActivePlacements(
    beachPublicId,
    refreshKey,
  );
  const onRetry = useCallback(() => setRefreshKey((k) => k + 1), []);
  return (
    <SponsoredRailView
      beachName={beachName}
      placements={placements}
      loading={loading}
      error={error}
      onRetry={onRetry}
    />
  );
}
