import type { CSSProperties } from "react";
import { CATEGORY_ICONS } from "./EventsCalendar";
import {
  EVENT_CATEGORY_LABELS,
  formatEventRange,
  formatEventRemaining,
  type BeachEvent,
} from "./types";

const styles = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    width: "100%",
    textAlign: "left",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(15,30,46,0.12)",
    background: "#fff",
    cursor: "pointer",
  } satisfies CSSProperties,
  title: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 600,
    fontSize: 15,
    color: "#0F1E2E",
  } satisfies CSSProperties,
  when: { fontSize: 13, color: "#5B6B7B" } satisfies CSSProperties,
  where: { fontSize: 13, color: "#5B6B7B" } satisfies CSSProperties,
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  } satisfies CSSProperties,
  remaining: {
    alignSelf: "flex-start",
    fontSize: 12,
    fontWeight: 700,
    color: "#0A6E78",
  } satisfies CSSProperties,
};

export type EventCardProps = {
  event: BeachEvent;
  /**
   * Fired with the event's beach public id when the card is tapped — the
   * shell (App.tsx) owns navigation to Beach Detail.
   */
  onOpenBeach: (beachPublicId: string) => void;
  /** Injected clock; defaults to render time. Used only for the live chip. */
  now?: Date;
};

/**
 * Consumer event card for the standalone "What's happening" screen. Purely
 * presentational: the whole card is the tap target for Beach Detail. The
 * paid-takeover badge is a visual label only — never a ranking signal.
 */
export function EventCard({ event, onOpenBeach, now }: EventCardProps) {
  const Icon = CATEGORY_ICONS[event.category];
  const at = now ?? new Date();
  const live =
    new Date(event.startsAt).getTime() <= at.getTime() &&
    at.getTime() < new Date(event.endsAt).getTime();
  return (
    <button
      type="button"
      style={styles.card}
      data-beach-id={event.beachPublicId}
      aria-label={`Open ${event.beachName} detail`}
      onClick={() => onOpenBeach(event.beachPublicId)}
    >
      <span style={styles.title}>
        <Icon size={16} aria-hidden />
        {event.title}
        {event.paidTakeover.isPaid && (
          <span
            style={{
              ...styles.badge,
              background: "rgba(255,107,92,0.14)",
              color: "#FF6B5C",
            }}
          >
            {event.paidTakeover.label}
            {event.paidTakeover.sponsorName
              ? ` · ${event.paidTakeover.sponsorName}`
              : ""}
          </span>
        )}
      </span>
      <span style={styles.when}>
        {formatEventRange(event.startsAt, event.endsAt)}
      </span>
      <span style={styles.where}>
        {event.beachName} · {EVENT_CATEGORY_LABELS[event.category]}
      </span>
      {live ? (
        <span style={styles.remaining}>
          Live · {formatEventRemaining(event.endsAt, at)}
        </span>
      ) : null}
    </button>
  );
}
