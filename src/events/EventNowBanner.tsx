import type { CSSProperties } from "react";
import {
  EVENT_CATEGORY_LABELS,
  formatEventRemaining,
  type BeachEvent,
} from "./types";

const styles = {
  banner: {
    borderRadius: 14,
    border: "1px solid rgba(46,139,107,0.35)",
    background: "rgba(46,139,107,0.08)",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    color: "#2E8B6B",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } satisfies CSSProperties,
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "#2E8B6B",
    display: "inline-block",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: "#0F1E2E",
  } satisfies CSSProperties,
  meta: { fontSize: 13, color: "#5B6B7B" } satisfies CSSProperties,
  remaining: {
    fontSize: 13,
    fontWeight: 700,
    color: "#0A6E78",
  } satisfies CSSProperties,
};

export type EventNowBannerProps = {
  events: BeachEvent[];
  now?: Date;
};

/**
 * Live "what's happening now" strip for a beach. Presentational only: the
 * parent (EventsCalendar) supplies the events and the reference instant.
 * Events whose half-open window does not cover `now` are filtered out
 * defensively, and the banner renders nothing at all when nothing is live —
 * no fake liveliness, no placeholder.
 */
export function EventNowBanner({ events, now }: EventNowBannerProps) {
  const at = now ?? new Date();
  const ref = at.getTime();
  const live = events.filter((event) => {
    const start = new Date(event.startsAt).getTime();
    const end = new Date(event.endsAt).getTime();
    return start <= ref && ref < end;
  });
  if (!live.length) return null;
  return (
    <section style={styles.banner} aria-label="Live events">
      <span style={styles.heading}>
        <span style={styles.dot} aria-hidden />
        Live now
      </span>
      {live.map((event) => (
        <div key={event.publicId} style={styles.row}>
          <span style={styles.title}>{event.title}</span>
          <span style={styles.meta}>
            {EVENT_CATEGORY_LABELS[event.category]}
          </span>
          <span style={styles.remaining}>
            {formatEventRemaining(event.endsAt, at)}
          </span>
        </div>
      ))}
    </section>
  );
}
