import {
  CheckCircle2,
  LoaderCircle,
  PencilLine,
  Send,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { CATEGORY_ICONS } from "./EventsCalendar";
import {
  EVENT_CATEGORY_LABELS,
  EVENT_STATE_LABELS,
  PAID_TAKEOVER_LABEL,
  partitionEvents,
  type BeachEvent,
} from "./types";
import {
  applyTakeoverChange,
  cancelEvent,
  createAndPublishEvent,
  createEvent,
  fetchCoordinatorEvents,
  publishEvent,
  replaceEvent,
} from "./coordinator/api";
import { EventPublisher } from "./coordinator/EventPublisher";
import { TakeoverSettings } from "./coordinator/TakeoverSettings";
import {
  mergeEventList,
  removeEvent,
  takeoverBadgeText,
  type CoordinatorEventPayload,
  type TakeoverChange,
} from "./coordinator/types";

const STATE_TONE: Record<string, { background: string; color: string }> = {
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
  banner: {
    margin: 0,
    padding: 12,
    borderRadius: 10,
    fontSize: 14,
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
  neutral: {
    background: "rgba(91,107,123,0.12)",
    color: "#5B6B7B",
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  sectionTitle: {
    margin: "0 0 6px",
    fontSize: 14,
    fontWeight: 700,
  } satisfies CSSProperties,
};

function formatWindow(event: BeachEvent): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  return `${start.toLocaleString()} → ${end.toLocaleString()}`;
}

function EventCard({
  event,
  editable,
  editing,
  onPublish,
  onCancel,
  onEdit,
  onApplyTakeover,
}: {
  event: BeachEvent;
  editable: boolean;
  editing: boolean;
  onPublish?: (eventPublicId: string) => void;
  onCancel?: (eventPublicId: string) => void;
  onEdit?: (event: BeachEvent) => void;
  onApplyTakeover?: (
    event: BeachEvent,
    change: TakeoverChange,
  ) => Promise<void>;
}) {
  const Icon = CATEGORY_ICONS[event.category];
  const tone = STATE_TONE[event.state];
  const [showTakeover, setShowTakeover] = useState(false);
  const sponsoredBadge = takeoverBadgeText(event);
  return (
    <li
      style={{
        ...styles.card,
        ...(editing ? { borderColor: "rgba(10,110,120,0.5)" } : {}),
      }}
    >
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
        {sponsoredBadge ? ` · ${sponsoredBadge}` : ""}
      </div>
      {editable && (
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
          {onEdit && !editing && (
            <button
              style={{ ...styles.button, ...styles.neutral }}
              onClick={() => onEdit(event)}
            >
              <PencilLine size={13} aria-hidden />
              Edit
            </button>
          )}
          {onApplyTakeover && !editing && (
            <button
              style={{ ...styles.button, ...styles.neutral }}
              aria-expanded={showTakeover}
              onClick={() => setShowTakeover((open) => !open)}
            >
              <SlidersHorizontal size={13} aria-hidden />
              Takeover settings
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
      {editable && showTakeover && onApplyTakeover && !editing && (
        <TakeoverSettings
          key={event.publicId}
          event={event}
          onApply={(change) => onApplyTakeover(event, change)}
        />
      )}
    </li>
  );
}

function DashboardSection({
  label,
  color,
  events,
  dimmed = false,
  editableIds,
  editingId,
  onPublish,
  onCancel,
  onEdit,
  onApplyTakeover,
}: {
  label: string;
  color: string;
  events: BeachEvent[];
  dimmed?: boolean;
  editableIds: Set<string>;
  editingId: string | null;
  onPublish?: (eventPublicId: string) => void;
  onCancel?: (eventPublicId: string) => void;
  onEdit?: (event: BeachEvent) => void;
  onApplyTakeover?: (
    event: BeachEvent,
    change: TakeoverChange,
  ) => Promise<void>;
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
            editable={editableIds.has(event.publicId)}
            editing={editingId === event.publicId}
            onPublish={onPublish}
            onCancel={onCancel}
            onEdit={onEdit}
            onApplyTakeover={onApplyTakeover}
          />
        ))}
      </ul>
    </section>
  );
}

export type CoordinatorDashboardProps = {
  now?: Date;
};

/**
 * Coordinator dashboard: the signed-in coordinator's own events, fetched
 * from /api/events/mine on mount, grouped into mutually exclusive sections
 * (happening now / upcoming / past cover only published events; drafts and
 * cancelled get their own sections). Publishing flow:
 *
 * - EventPublisher (create + edit) posts through the existing /api/events
 *   handlers only. There is no update endpoint, so editing an existing
 *   window creates a replacement and cancels the original — a replacement
 *   of a published event is published too, so the consumer EventsCalendar
 *   keeps seeing the window without a gap.
 * - TakeoverSettings flips a window's sponsored/curated flag, again via
 *   create-replacement + cancel. Sponsorship only ever touches the event
 *   window's branding layer: it never reads or writes Beach Pulse, ranking
 *   or live-condition data (asserted in coordinator/coordinator.test.ts),
 *   and the "Sponsored"/paid-takeover badges render as labels only.
 */
export function CoordinatorDashboard({ now }: CoordinatorDashboardProps) {
  const [events, setEvents] = useState<BeachEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<BeachEvent | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCoordinatorEvents()
      .then((loaded) => {
        if (!cancelled) setEvents(loaded);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load your events.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ref = now ?? new Date();

  async function handlePublish(eventPublicId: string) {
    setActionError(null);
    try {
      const updated = await publishEvent(eventPublicId);
      setEvents((current) => mergeEventList(current, updated));
    } catch (publishError) {
      setActionError(
        publishError instanceof Error
          ? publishError.message
          : "Could not publish the event.",
      );
    }
  }

  async function handleCancel(eventPublicId: string) {
    setActionError(null);
    try {
      await cancelEvent(eventPublicId);
      setEvents((current) => removeEvent(current, eventPublicId));
    } catch (cancelError) {
      setActionError(
        cancelError instanceof Error
          ? cancelError.message
          : "Could not cancel the event.",
      );
    }
  }

  async function handlePublisherSubmit(
    payload: CoordinatorEventPayload,
    publish: boolean,
  ) {
    setActionError(null);
    setNotice(null);
    if (editing) {
      const result = await replaceEvent(editing, payload);
      // Merge the replacement and drop the original only after the whole
      // replace flow fulfilled; a throw above leaves the list untouched.
      setEvents((current) =>
        removeEvent(
          mergeEventList(current, result.replacement),
          editing.publicId,
        ),
      );
      if (result.cancelError) {
        setNotice(
          `Updated, but cancelling the original window failed (${result.cancelError}). It still appears below — cancel it manually.`,
        );
      }
      setEditing(null);
      return;
    }
    const created = publish
      ? await createAndPublishEvent(payload)
      : await createEvent(payload);
    setEvents((current) => mergeEventList(current, created));
  }

  async function handleApplyTakeover(
    event: BeachEvent,
    change: TakeoverChange,
  ) {
    setActionError(null);
    setNotice(null);
    const result = await applyTakeoverChange(event, change);
    setEvents((current) =>
      removeEvent(mergeEventList(current, result.replacement), event.publicId),
    );
    if (result.cancelError) {
      setNotice(
        `Sponsorship updated, but cancelling the original window failed (${result.cancelError}). It still appears below — cancel it manually.`,
      );
    }
  }

  const published = events.filter((event) => event.state === "published");
  const { happeningNow, upcoming, past } = partitionEvents(published, ref);
  const byStartAsc = (a: BeachEvent, b: BeachEvent) =>
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  const drafts = events
    .filter((event) => event.state === "draft")
    .sort(byStartAsc);
  const cancelled = events
    .filter((event) => event.state === "cancelled")
    .sort(byStartAsc);

  // Editable: drafts and windows that have not ended. Past and cancelled
  // windows are immutable history.
  const editableIds = new Set(
    events
      .filter(
        (event) =>
          event.state !== "cancelled" &&
          new Date(event.endsAt).getTime() > ref.getTime(),
      )
      .map((event) => event.publicId),
  );
  const editingId = editing?.publicId ?? null;

  return (
    <div style={styles.shell} aria-busy={loading}>
      <h2 style={styles.heading}>Coordinator dashboard</h2>
      {error && (
        <p
          style={{
            ...styles.banner,
            background: "rgba(255,107,92,0.12)",
            color: "#FF6B5C",
          }}
          role="alert"
        >
          {error}
        </p>
      )}
      {actionError && (
        <p
          style={{
            ...styles.banner,
            background: "rgba(255,107,92,0.12)",
            color: "#FF6B5C",
          }}
          role="alert"
        >
          {actionError}
        </p>
      )}
      {notice && (
        <p
          style={{
            ...styles.banner,
            background: "rgba(10,110,120,0.08)",
            color: "#0A6E78",
          }}
          role="status"
        >
          {notice}
        </p>
      )}
      {loading ? (
        <p style={{ margin: 0, fontSize: 14, color: "#5B6B7B" }}>
          <LoaderCircle size={14} aria-hidden /> Loading your events…
        </p>
      ) : events.length === 0 && !error ? (
        <p style={{ margin: 0, fontSize: 14, color: "#5B6B7B" }}>
          <CheckCircle2 size={14} aria-hidden /> You have no events yet —
          publish your first one below.
        </p>
      ) : (
        <>
          <DashboardSection
            label="Happening now"
            color="#2E8B6B"
            events={happeningNow}
            editableIds={editableIds}
            editingId={editingId}
            onPublish={handlePublish}
            onCancel={handleCancel}
            onEdit={setEditing}
            onApplyTakeover={handleApplyTakeover}
          />
          <DashboardSection
            label="Upcoming"
            color="#0A6E78"
            events={upcoming}
            editableIds={editableIds}
            editingId={editingId}
            onPublish={handlePublish}
            onCancel={handleCancel}
            onEdit={setEditing}
            onApplyTakeover={handleApplyTakeover}
          />
          <DashboardSection
            label="Drafts"
            color="#5B6B7B"
            events={drafts}
            editableIds={editableIds}
            editingId={editingId}
            onPublish={handlePublish}
            onCancel={handleCancel}
            onEdit={setEditing}
            onApplyTakeover={handleApplyTakeover}
          />
          <DashboardSection
            label="Past"
            color="#5B6B7B"
            events={past}
            dimmed
            editableIds={editableIds}
            editingId={editingId}
          />
          <DashboardSection
            label="Cancelled"
            color="#FF6B5C"
            events={cancelled}
            dimmed
            editableIds={editableIds}
            editingId={editingId}
          />
        </>
      )}
      <EventPublisher
        key={editing?.publicId ?? "new"}
        editingEvent={editing}
        onSubmit={handlePublisherSubmit}
        onCancelEdit={() => setEditing(null)}
      />
    </div>
  );
}
