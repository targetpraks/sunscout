import { Check, LoaderCircle, Megaphone, Plus } from "lucide-react";
import { useState, type CSSProperties, type FormEvent } from "react";
import {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  type BeachEvent,
} from "../types";
import {
  EVENT_AUDIENCES,
  EVENT_AUDIENCE_LABELS,
  SPONSORSHIP_NOTE,
  emptyPublisherForm,
  formStateFromEvent,
  toEventPayload,
  validateEventForm,
  type CoordinatorEventPayload,
  type EventAudience,
  type PublisherFieldErrors,
  type PublisherFormState,
} from "./types";

const styles = {
  card: {
    borderRadius: 14,
    border: "1px solid rgba(15,30,46,0.12)",
    background: "#fff",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    fontSize: 14,
    fontWeight: 700,
    color: "#0F1E2E",
  } satisfies CSSProperties,
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 13,
    color: "#5B6B7B",
  } satisfies CSSProperties,
  input: {
    border: "1px solid rgba(15,30,46,0.18)",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
    background: "#FAF6F0",
    color: "#0F1E2E",
  } satisfies CSSProperties,
  fieldError: {
    margin: 0,
    fontSize: 12,
    color: "#FF6B5C",
  } satisfies CSSProperties,
  submitError: {
    margin: 0,
    padding: 10,
    borderRadius: 10,
    background: "rgba(255,107,92,0.12)",
    color: "#FF6B5C",
    fontSize: 13,
  } satisfies CSSProperties,
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,
  chip: {
    border: "1px solid rgba(15,30,46,0.18)",
    borderRadius: 999,
    background: "#FAF6F0",
    color: "#5B6B7B",
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
  chipOn: {
    border: "1px solid rgba(10,110,120,0.5)",
    background: "rgba(10,110,120,0.12)",
    color: "#0A6E78",
  } satisfies CSSProperties,
  note: {
    display: "flex",
    gap: 6,
    alignItems: "flex-start",
    margin: 0,
    fontSize: 12,
    color: "#5B6B7B",
  } satisfies CSSProperties,
  row: { display: "flex", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
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
  draft: {
    background: "rgba(91,107,123,0.12)",
    color: "#5B6B7B",
  } satisfies CSSProperties,
  publish: { background: "#0A6E78", color: "#FAF6F0" } satisfies CSSProperties,
  ghost: {
    background: "none",
    color: "#5B6B7B",
    textDecoration: "underline",
  } satisfies CSSProperties,
};

export type EventPublisherProps = {
  /**
   * When set, the form edits this existing window: prefilled, and a
   * successful submit replaces the original (create + publish-if-needed +
   * cancel, handled by the parent via ./api). The parent must remount the
   * publisher with a key when the editing target changes.
   */
  editingEvent?: BeachEvent | null;
  /**
   * Called with the validated payload and whether the coordinator chose
   * publish-now. The parent owns the actual API calls; reject to surface
   * the error inside the form.
   */
  onSubmit: (
    payload: CoordinatorEventPayload,
    publish: boolean,
  ) => Promise<void>;
  /** Closes edit mode without submitting. */
  onCancelEdit?: () => void;
};

/**
 * Coordinator event form: type, window, audience tags and (for create
 * mode) the sponsored-takeover fields. All validation and payload shaping
 * lives in ./types (pure, unit-tested in ./coordinator.test.ts); this
 * component only renders state and reports errors.
 */
export function EventPublisher({
  editingEvent,
  onSubmit,
  onCancelEdit,
}: EventPublisherProps) {
  const [form, setForm] = useState<PublisherFormState>(() =>
    editingEvent ? formStateFromEvent(editingEvent) : emptyPublisherForm(),
  );
  const [fieldErrors, setFieldErrors] = useState<PublisherFieldErrors | null>(
    null,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set =
    <K extends keyof PublisherFormState>(key: K) =>
    (value: PublisherFormState[K]) =>
      setForm((current) => ({ ...current, [key]: value }));

  const toggleAudience = (audience: EventAudience) =>
    setForm((current) => ({
      ...current,
      audienceTags: current.audienceTags.includes(audience)
        ? current.audienceTags.filter((tag) => tag !== audience)
        : [...current.audienceTags, audience],
    }));

  async function handleSubmit(publish: boolean) {
    if (submitting) return;
    const errors = validateEventForm(form);
    setFieldErrors(errors);
    if (errors) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(toEventPayload(form), publish);
      if (editingEvent) {
        onCancelEdit?.();
      } else {
        setForm(emptyPublisherForm());
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Could not save the event.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleNativeSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    // The publish affordance is the primary action; the draft action below
    // calls the same handler with publish=false.
    void handleSubmit(true);
  }

  return (
    <form style={styles.card} onSubmit={handleNativeSubmit}>
      <h3 style={styles.heading}>
        <Megaphone size={15} aria-hidden />
        {editingEvent
          ? `Edit “${editingEvent.title}”`
          : "Publish a beach event"}
      </h3>
      <label style={styles.field}>
        Beach public id
        <input
          style={styles.input}
          placeholder="e.g. 22222222-2222-4222-8222-222222222222"
          value={form.beachPublicId}
          onChange={(change) => set("beachPublicId")(change.target.value)}
          readOnly={Boolean(editingEvent)}
        />
        {fieldErrors?.beachPublicId && (
          <p style={styles.fieldError} role="alert">
            {fieldErrors.beachPublicId}
          </p>
        )}
      </label>
      <label style={styles.field}>
        Title
        <input
          style={styles.input}
          placeholder="Sunset sessions at the point"
          value={form.title}
          onChange={(change) => set("title")(change.target.value)}
        />
        {fieldErrors?.title && (
          <p style={styles.fieldError} role="alert">
            {fieldErrors.title}
          </p>
        )}
      </label>
      <label style={styles.field}>
        Description (optional)
        <textarea
          style={{ ...styles.input, minHeight: 64, resize: "vertical" }}
          placeholder="What should attendees know?"
          value={form.description}
          onChange={(change) => set("description")(change.target.value)}
        />
        {fieldErrors?.description && (
          <p style={styles.fieldError} role="alert">
            {fieldErrors.description}
          </p>
        )}
      </label>
      <label style={styles.field}>
        Type
        <select
          style={styles.input}
          value={form.category}
          onChange={(change) =>
            set("category")(
              change.target.value as PublisherFormState["category"],
            )
          }
        >
          {EVENT_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {EVENT_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
        {fieldErrors?.category && (
          <p style={styles.fieldError} role="alert">
            {fieldErrors.category}
          </p>
        )}
      </label>
      <div style={styles.field}>
        Audience tags
        <div style={styles.chips}>
          {EVENT_AUDIENCES.map((audience) => {
            const on = form.audienceTags.includes(audience);
            return (
              <button
                key={audience}
                type="button"
                aria-pressed={on}
                style={on ? { ...styles.chip, ...styles.chipOn } : styles.chip}
                onClick={() => toggleAudience(audience)}
              >
                {on ? <Check size={11} aria-hidden /> : null}
                {EVENT_AUDIENCE_LABELS[audience]}
              </button>
            );
          })}
        </div>
        {fieldErrors?.audienceTags && (
          <p style={styles.fieldError} role="alert">
            {fieldErrors.audienceTags}
          </p>
        )}
      </div>
      <div style={styles.row}>
        <label style={styles.field}>
          Starts
          <input
            style={styles.input}
            type="datetime-local"
            value={form.startsAt}
            onChange={(change) => set("startsAt")(change.target.value)}
          />
          {fieldErrors?.startsAt && (
            <p style={styles.fieldError} role="alert">
              {fieldErrors.startsAt}
            </p>
          )}
        </label>
        <label style={styles.field}>
          Ends
          <input
            style={styles.input}
            type="datetime-local"
            value={form.endsAt}
            onChange={(change) => set("endsAt")(change.target.value)}
          />
          {fieldErrors?.endsAt && (
            <p style={styles.fieldError} role="alert">
              {fieldErrors.endsAt}
            </p>
          )}
        </label>
      </div>
      {!editingEvent && (
        <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
          <label style={styles.field}>
            <span style={styles.row}>
              <input
                type="checkbox"
                checked={form.isPaidTakeover}
                onChange={(change) =>
                  set("isPaidTakeover")(change.target.checked)
                }
              />
              This window is a sponsored takeover
            </span>
          </label>
          {form.isPaidTakeover && (
            <>
              <label style={styles.field}>
                Sponsor name
                <input
                  style={styles.input}
                  placeholder="Sunblock Co"
                  value={form.sponsorName}
                  onChange={(change) => set("sponsorName")(change.target.value)}
                />
                {fieldErrors?.sponsorName && (
                  <p style={styles.fieldError} role="alert">
                    {fieldErrors.sponsorName}
                  </p>
                )}
              </label>
              <p style={styles.note}>{SPONSORSHIP_NOTE}</p>
            </>
          )}
        </fieldset>
      )}
      {submitError && (
        <p style={styles.submitError} role="alert">
          {submitError}
        </p>
      )}
      <div style={styles.row}>
        <button
          type="submit"
          disabled={submitting}
          style={{
            ...styles.button,
            ...styles.publish,
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? (
            <LoaderCircle size={13} aria-hidden />
          ) : (
            <Check size={13} aria-hidden />
          )}
          {editingEvent ? "Save changes" : "Publish event"}
        </button>
        {!editingEvent && (
          <button
            type="button"
            disabled={submitting}
            style={{
              ...styles.button,
              ...styles.draft,
              opacity: submitting ? 0.6 : 1,
            }}
            onClick={() => void handleSubmit(false)}
          >
            <Plus size={13} aria-hidden />
            Save as draft
          </button>
        )}
        {editingEvent && onCancelEdit && (
          <button
            type="button"
            disabled={submitting}
            style={{ ...styles.button, ...styles.ghost }}
            onClick={onCancelEdit}
          >
            Cancel editing
          </button>
        )}
      </div>
    </form>
  );
}
