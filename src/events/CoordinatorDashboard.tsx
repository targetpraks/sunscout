import { CheckCircle2, LoaderCircle, Plus, Send, XCircle } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { CATEGORY_ICONS } from "./EventsCalendar";
import {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  EVENT_STATE_LABELS,
  PAID_TAKEOVER_LABEL,
  partitionEvents,
  type BeachEvent,
  type EventCategory,
  type EventState,
} from "./types";

const STATE_TONE: Record<EventState, { background: string; color: string }> = {
  draft: { background: "rgba(91,107,123,0.12)", color: "#5B6B7B" },
  published: { background: "rgba(46,139,107,0.14)", color: "#2E8B6B" },
  cancelled: { background: "rgba(255,107,92,0.14)", color: "#FF6B5C" },
};

const styles = {
  shell: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  heading: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: "#0F1E2E",
  } satisfies CSSProperties,
  card: {
    borderRadius: 14,
    border: "1px solid rgba(15,30,46,0.12)",
    background: "#fff",
    padding: "12px 14px",
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
  title: {
    fontWeight: 600,
    fontSize: 15,
    color: "#0F1E2E",
  } satisfies CSSProperties,
  meta: { fontSize: 13, color: "#5B6B7B" } satisfies CSSProperties,
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
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
  } satisfies CSSProperties,
  publish: { background: "#0A6E78", color: "#FAF6F0" } satisfies CSSProperties,
  cancel: {
    background: "rgba(255,107,92,0.14)",
    color: "#FF6B5C",
  } satisfies CSSProperties,
  create: { background: "#FF6B5C", color: "#FAF6F0" } satisfies CSSProperties,
  input: {
    border: "1px solid rgba(15,30,46,0.18)",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
    background: "#FAF6F0",
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  sectionTitle: { margin: "0 0 6px", fontSize: 14, fontWeight: 700 },
};

function formatWindow(event: BeachEvent): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  return `${start.toLocaleString()} → ${end.toLocaleString()}`;
}

function EventCard({
  event,
  onPublish,
  onCancel,
}: {
  event: BeachEvent;
  onPublish?: (eventPublicId: string) => void;
  onCancel?: (eventPublicId: string) => void;
}) {
  const Icon = CATEGORY_ICONS[event.category];
  const tone = STATE_TONE[event.state];
  return (
    <li style={styles.card}>
      <div style={styles.row}>
        <Icon size={16} aria-hidden />
        <span style={styles.title}>{event.title}</span>
        <span
          style={{
            ...styles.badge,
            background: tone.background,
            color: tone.color,
          }}
        >
          {EVENT_STATE_LABELS[event.state]}
        </span>
        {event.paidTakeover.isPaid && (
          <span
            style={{
              ...styles.badge,
              background: "rgba(255,107,92,0.14)",
              color: "#FF6B5C",
            }}
          >
            {PAID_TAKEOVER_LABEL}
            {event.paidTakeover.sponsorName
              ? ` · ${event.paidTakeover.sponsorName}`
              : ""}
          </span>
        )}
      </div>
      <div style={styles.meta}>
        {event.beachName} · {EVENT_CATEGORY_LABELS[event.category]} ·{" "}
        {formatWindow(event)}
      </div>
      {(event.state === "draft" || event.state === "published") &&
        (onPublish || onCancel) && (
          <div style={styles.row}>
            {event.state === "draft" && onPublish && (
              <button
                style={{ ...styles.button, ...styles.publish }}
                onClick={() => onPublish(event.publicId)}
              >
                <Send size={13} aria-hidden />
                Publish
              </button>
            )}
            {onCancel && (
              <button
                style={{ ...styles.button, ...styles.cancel }}
                onClick={() => onCancel(event.publicId)}
              >
                <XCircle size={13} aria-hidden />
                Cancel event
              </button>
            )}
          </div>
        )}
    </li>
  );
}

function DashboardSection({
  label,
  color,
  events,
  dimmed = false,
  onPublish,
  onCancel,
}: {
  label: string;
  color: string;
  events: BeachEvent[];
  dimmed?: boolean;
  onPublish?: (eventPublicId: string) => void;
  onCancel?: (eventPublicId: string) => void;
}) {
  if (!events.length) return null;
  return (
    <section>
      <h3 style={{ ...styles.sectionTitle, color }}>
        {label} ({events.length})
      </h3>
      <ul style={{ ...styles.list, opacity: dimmed ? 0.75 : 1 }}>
        {events.map((event) => (
          <EventCard
            key={event.publicId}
            event={event}
            onPublish={onPublish}
            onCancel={onCancel}
          />
        ))}
      </ul>
    </section>
  );
}

export type CoordinatorCreateInput = {
  beachPublicId: string;
  title: string;
  category: EventCategory;
  startsAt: string;
  endsAt: string;
};

function CreateForm({
  onCreate,
}: {
  onCreate?: (input: CoordinatorCreateInput) => void;
}) {
  const [beachPublicId, setBeachPublicId] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<EventCategory>("party");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  if (!onCreate) return null;
  return (
    <form
      style={{ ...styles.card, gap: 10 }}
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        if (!beachPublicId || !title || !startsAt || !endsAt) {
          setFormError("All fields are required.");
          return;
        }
        const startIso = new Date(startsAt).toISOString();
        const endIso = new Date(endsAt).toISOString();
        if (new Date(endIso) <= new Date(startIso)) {
          setFormError("The event must end after it starts.");
          return;
        }
        setFormError(null);
        onCreate({
          beachPublicId,
          title,
          category,
          startsAt: startIso,
          endsAt: endIso,
        });
      }}
    >
      <strong style={{ fontSize: 14, color: "#0F1E2E" }}>
        New event (starts as draft)
      </strong>
      <input
        style={styles.input}
        placeholder="Beach public id"
        value={beachPublicId}
        onChange={(change) => setBeachPublicId(change.target.value)}
      />
      <input
        style={styles.input}
        placeholder="Event title"
        value={title}
        onChange={(change) => setTitle(change.target.value)}
      />
      <select
        style={styles.input}
        value={category}
        onChange={(change) => setCategory(change.target.value as EventCategory)}
      >
        {EVENT_CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {EVENT_CATEGORY_LABELS[value]}
          </option>
        ))}
      </select>
      <label style={styles.meta}>
        Starts
        <input
          style={styles.input}
          type="datetime-local"
          value={startsAt}
          onChange={(change) => setStartsAt(change.target.value)}
        />
      </label>
      <label style={styles.meta}>
        Ends
        <input
          style={styles.input}
          type="datetime-local"
          value={endsAt}
          onChange={(change) => setEndsAt(change.target.value)}
        />
      </label>
      {formError && (
        <p style={{ margin: 0, fontSize: 13, color: "#FF6B5C" }} role="alert">
          {formError}
        </p>
      )}
      <button type="submit" style={{ ...styles.button, ...styles.create }}>
        <Plus size={13} aria-hidden />
        Create draft
      </button>
    </form>
  );
}

export type CoordinatorDashboardProps = {
  events: BeachEvent[];
  now?: Date;
  loading?: boolean;
  error?: string | null;
  onCreate?: (input: CoordinatorCreateInput) => void;
  onPublish?: (eventPublicId: string) => void;
  onCancel?: (eventPublicId: string) => void;
};

/**
 * Coordinator dashboard: the signed-in coordinator's own events, grouped into
 * mutually exclusive sections (happening now / upcoming / past cover only
 * published events; drafts and cancelled get their own sections), with
 * publish and cancel actions plus a draft creation form. Fully prop-driven —
 * the parent owns fetching and the API calls via ./api; there is no unpublish
 * path by design. The paid-takeover flag renders only as a labeled badge and
 * never feeds any ordering or ranking here.
 */
export function CoordinatorDashboard({
  events,
  now,
  loading = false,
  error,
  onCreate,
  onPublish,
  onCancel,
}: CoordinatorDashboardProps) {
  const published = events.filter((event) => event.state === "published");
  const { happeningNow, upcoming, past } = partitionEvents(
    published,
    now ?? new Date(),
  );
  const byStartAsc = (a: BeachEvent, b: BeachEvent) =>
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  const drafts = events
    .filter((event) => event.state === "draft")
    .sort(byStartAsc);
  const cancelled = events
    .filter((event) => event.state === "cancelled")
    .sort(byStartAsc);
  return (
    <div style={styles.shell} aria-busy={loading}>
      <h2 style={styles.heading}>Coordinator dashboard</h2>
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
        </p>
      ) : loading ? (
        <p style={{ margin: 0, fontSize: 14, color: "#5B6B7B" }}>
          <LoaderCircle size={14} aria-hidden /> Loading your events…
        </p>
      ) : events.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: "#5B6B7B" }}>
          <CheckCircle2 size={14} aria-hidden /> You have no events yet — create
          your first draft below.
        </p>
      ) : (
        <>
          <DashboardSection
            label="Happening now"
            color="#2E8B6B"
            events={happeningNow}
            onPublish={onPublish}
            onCancel={onCancel}
          />
          <DashboardSection
            label="Upcoming"
            color="#0A6E78"
            events={upcoming}
            onPublish={onPublish}
            onCancel={onCancel}
          />
          <DashboardSection
            label="Drafts"
            color="#5B6B7B"
            events={drafts}
            onPublish={onPublish}
            onCancel={onCancel}
          />
          <DashboardSection label="Past" color="#5B6B7B" events={past} dimmed />
          <DashboardSection
            label="Cancelled"
            color="#FF6B5C"
            events={cancelled}
            dimmed
          />
        </>
      )}
      <CreateForm onCreate={onCreate} />
    </div>
  );
}
