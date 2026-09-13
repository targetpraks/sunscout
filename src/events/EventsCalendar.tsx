import {
  CalendarDays,
  MapPin,
  PartyPopper,
  Sailboat,
  Trophy,
} from "lucide-react";
import type { CSSProperties } from "react";
import {
  consumerCalendarPartition,
  formatEventRange,
  EVENT_CATEGORY_LABELS,
  type BeachEvent,
  type EventCategory,
} from "./types";

export const CATEGORY_ICONS: Record<EventCategory, typeof Trophy> = {
  party: PartyPopper,
  "surf-competition": Trophy,
  "beach-soccer": Trophy,
  triathlon: Trophy,
  sailing: Sailboat,
  takeover: CalendarDays,
};

const styles = {
  section: {
    borderRadius: 14,
    border: "1px solid rgba(15,30,46,0.12)",
    background: "#fff",
    overflow: "hidden",
  } satisfies CSSProperties,
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 700,
    color: "#0F1E2E",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0 } satisfies CSSProperties,
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "12px 14px",
    borderTop: "1px solid rgba(15,30,46,0.08)",
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
  where: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 13,
    color: "#5B6B7B",
  } satisfies CSSProperties,
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  } satisfies CSSProperties,
  happening: { color: "#0A6E78" } satisfies CSSProperties,
  empty: {
    padding: "16px 14px",
    fontSize: 14,
    color: "#5B6B7B",
    borderTop: "1px solid rgba(15,30,46,0.08)",
  } satisfies CSSProperties,
};

export type EventsCalendarProps = {
  beachName: string;
  events: BeachEvent[];
  now?: Date;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

function EventRow({ event }: { event: BeachEvent }) {
  const Icon = CATEGORY_ICONS[event.category];
  return (
    <li style={styles.item}>
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
        <MapPin size={13} aria-hidden />
        {event.beachName} · {EVENT_CATEGORY_LABELS[event.category]}
      </span>
    </li>
  );
}

function Section({
  label,
  events,
  tone,
}: {
  label: string;
  events: BeachEvent[];
  tone: "happening" | "upcoming" | "past";
}) {
  return (
    <section style={styles.section}>
      <h3 style={styles.heading}>
        {label}
        <span
          style={{
            ...styles.badge,
            ...(tone === "happening"
              ? { background: "rgba(46,139,107,0.14)", color: "#2E8B6B" }
              : tone === "upcoming"
                ? { background: "rgba(10,110,120,0.12)", color: "#0A6E78" }
                : { background: "rgba(91,107,123,0.12)", color: "#5B6B7B" }),
          }}
        >
          {events.length}
        </span>
      </h3>
      {events.length ? (
        <ul style={styles.list}>
          {events.map((event) => (
            <EventRow key={event.publicId} event={event} />
          ))}
        </ul>
      ) : (
        <p style={styles.empty}>Nothing here yet.</p>
      )}
    </section>
  );
}

/**
 * Consumer-facing beach events calendar. Self-contained: renders purely from
 * props (the parent owns fetching via ./api), with explicit loading, error,
 * and empty states. The paid-takeover badge is the only place the paid flag
 * is consumed — a visual label, never a ranking signal.
 */
export function EventsCalendar({
  beachName,
  events,
  now,
  loading = false,
  error,
  onRetry,
}: EventsCalendarProps) {
  const partition = consumerCalendarPartition(events, now ?? new Date());
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
      aria-busy={loading}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 700,
          color: "#0F1E2E",
        }}
      >
        What's happening · {beachName}
      </h2>
      {error ? (
        <p
          style={{
            margin: 0,
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,107,92,0.12)",
            color: "#FF6B5C",
            fontSize: 14,
          }}
          role="alert"
        >
          {error}
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                marginLeft: 8,
                border: "none",
                background: "none",
                color: "#0A6E78",
                fontWeight: 700,
                cursor: "pointer",
                textDecoration: "underline",
                fontSize: 14,
              }}
            >
              Try again
            </button>
          )}
        </p>
      ) : loading ? (
        <p style={{ margin: 0, fontSize: 14, color: "#5B6B7B" }}>
          Loading events…
        </p>
      ) : (
        <>
          <Section
            label="Happening now"
            events={partition.happeningNow}
            tone="happening"
          />
          <Section
            label="Upcoming"
            events={partition.upcoming}
            tone="upcoming"
          />
          <Section label="Past" events={partition.past} tone="past" />
        </>
      )}
    </div>
  );
}
