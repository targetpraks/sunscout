import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PulseAudience } from "../pulse/types";
import { fetchAllBeachEvents } from "./api";
import { EventCard } from "./EventCard";
import { EventNowBanner } from "./EventNowBanner";
import { EventsCalendar } from "./EventsCalendar";
import { EventsFilterBar } from "./EventsFilterBar";
import {
  filterScreenEvents,
  groupEventsByBeach,
  groupEventsByDay,
  type BeachEvent,
  type EventWindow,
} from "./types";

/**
 * Consumer "What's happening now" events screen.
 *
 * Container/view split: `EventsScreen` owns fetching (client-side fan-out
 * over the existing GET /api/events/beaches/:id handler — no new server
 * endpoint) and filter state; `EventsScreenView` is presentational so node
 * SSR tests can assert every state without a DOM environment.
 */

export type EventsBeachOption = {
  /** Beach public id (the events API's beachPublicId). */
  id: string;
};

export type EventsScreenProps = {
  /** Beaches to scan for events; the shell passes the full catalog. */
  beachCatalog: readonly EventsBeachOption[];
  onBack: () => void;
  /** Fired with the event's beach public id; the shell opens Beach Detail. */
  onOpenBeach: (beachPublicId: string) => void;
};

const styles = {
  shell: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  back: {
    alignSelf: "flex-start",
    margin: "12px 16px 0",
    border: "none",
    background: "none",
    color: "#0A6E78",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 14,
    textDecoration: "underline",
    padding: 0,
  } satisfies CSSProperties,
  title: {
    margin: "0 16px",
    fontSize: 18,
    fontWeight: 700,
    color: "#0F1E2E",
  } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "0 16px 24px",
  } satisfies CSSProperties,
  dayHeading: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 700,
    color: "#0F1E2E",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    margin: "12px 0 0",
  } satisfies CSSProperties,
  count: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: "rgba(10,110,120,0.12)",
    color: "#0A6E78",
  } satisfies CSSProperties,
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  message: {
    margin: 0,
    fontSize: 14,
    color: "#5B6B7B",
  } satisfies CSSProperties,
  error: {
    margin: 0,
    padding: 12,
    borderRadius: 10,
    background: "rgba(255,107,92,0.12)",
    color: "#FF6B5C",
    fontSize: 14,
  } satisfies CSSProperties,
  retry: {
    marginLeft: 8,
    border: "none",
    background: "none",
    color: "#0A6E78",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "underline",
    fontSize: 14,
  } satisfies CSSProperties,
  partialNote: {
    margin: 0,
    fontSize: 12,
    color: "#5B6B7B",
  } satisfies CSSProperties,
};

function isLive(event: BeachEvent, now: Date): boolean {
  const start = new Date(event.startsAt).getTime();
  const end = new Date(event.endsAt).getTime();
  const ref = now.getTime();
  return start <= ref && ref < end;
}

export type EventsScreenViewProps = {
  events: BeachEvent[];
  loading?: boolean;
  error?: string | null;
  /** How many beach feeds could not be reached (partial-outage note). */
  failedBeachCount?: number;
  onRetry?: () => void;
  /** Injected clock — tests pass a fixed instant. */
  now?: Date;
  dateWindow: EventWindow;
  audience: PulseAudience | null;
  onDateWindowChange: (dateWindow: EventWindow) => void;
  onAudienceChange: (audience: PulseAudience | null) => void;
  onOpenBeach: (beachPublicId: string) => void;
};

/** Presentational events screen: filters, live banner, day-grouped body. */
export function EventsScreenView({
  events,
  loading = false,
  error,
  failedBeachCount = 0,
  onRetry,
  now,
  dateWindow,
  audience,
  onDateWindowChange,
  onAudienceChange,
  onOpenBeach,
}: EventsScreenViewProps): ReactNode {
  const at = now ?? new Date();
  const filtered = error
    ? []
    : filterScreenEvents(events, { window: dateWindow, audience }, at);
  const live = filtered.filter((event) => isLive(event, at));
  const dayGroups = groupEventsByDay(filtered, at);
  return (
    <div style={styles.shell} aria-label="Beach events" aria-busy={loading}>
      <h1 style={styles.title}>What's happening</h1>
      <div style={styles.body}>
        <EventsFilterBar
          window={dateWindow}
          audience={audience}
          onWindowChange={onDateWindowChange}
          onAudienceChange={onAudienceChange}
        />
        {error ? (
          <p style={styles.error} role="alert">
            {error}
            {onRetry && (
              <button onClick={onRetry} style={styles.retry}>
                Try again
              </button>
            )}
          </p>
        ) : loading ? (
          <p style={styles.message}>Loading events…</p>
        ) : (
          <>
            <EventNowBanner events={live} now={at} />
            {failedBeachCount > 0 ? (
              <p style={styles.partialNote}>
                {failedBeachCount} beach{" "}
                {failedBeachCount === 1 ? "feed" : "feeds"} could not be
                reached.
              </p>
            ) : null}
            {dayGroups.length === 0 ? (
              <p style={styles.message}>
                Nothing on right now — try widening the date window.
              </p>
            ) : (
              dayGroups.map((group) => (
                <section key={group.dayKey}>
                  <h2 style={styles.dayHeading}>
                    {group.label}
                    <span style={styles.count}>{group.events.length}</span>
                  </h2>
                  <div style={styles.cards}>
                    {group.isToday
                      ? groupEventsByBeach(group.events).map((beach) => (
                          <EventsCalendar
                            key={beach.beachPublicId}
                            beachName={beach.beachName}
                            events={beach.events}
                            now={at}
                          />
                        ))
                      : group.events.map((event) => (
                          <EventCard
                            key={event.publicId}
                            event={event}
                            now={at}
                            onOpenBeach={onOpenBeach}
                          />
                        ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Container: owns fetching (fan-out) and filter state. */
export function EventsScreen({
  beachCatalog,
  onBack,
  onOpenBeach,
}: EventsScreenProps) {
  const [dateWindow, setDateWindow] = useState<EventWindow>("today");
  const [audience, setAudience] = useState<PulseAudience | null>(null);
  const [events, setEvents] = useState<BeachEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failedBeachCount, setFailedBeachCount] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [now] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (beachCatalog.length === 0) {
      setEvents([]);
      setFailedBeachCount(0);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    fetchAllBeachEvents(beachCatalog.map((beach) => beach.id)).then(
      (result) => {
        if (cancelled) return;
        setEvents(result.events);
        setFailedBeachCount(result.failedBeachIds.length);
        if (result.failedBeachIds.length === beachCatalog.length) {
          setError("Couldn't load events right now.");
        }
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [beachCatalog, attempt]);

  return (
    <>
      <button style={styles.back} onClick={onBack} aria-label="Go back">
        ← Back
      </button>
      <EventsScreenView
        events={events}
        loading={loading}
        error={error}
        failedBeachCount={failedBeachCount}
        onRetry={() => setAttempt((current) => current + 1)}
        now={now}
        dateWindow={dateWindow}
        audience={audience}
        onDateWindowChange={setDateWindow}
        onAudienceChange={setAudience}
        onOpenBeach={onOpenBeach}
      />
    </>
  );
}
