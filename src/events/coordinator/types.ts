import {
  EVENT_CATEGORIES,
  type BeachEvent,
  type EventCategory,
  type EventInput,
} from "../types";

/**
 * Coordinator publishing flow — pure types and helpers, no React and no
 * fetch. Everything here is covered by ./coordinator.test.ts, which runs in
 * vitest's node environment (no DOM), so all form/payload/takeover logic
 * lives in this module rather than in the components.
 *
 * Integrity rule (advertising takeovers): sponsorship owns ONLY the
 * curated/branding layer of an event window. Nothing in this module or in
 * ./api.ts reads or writes Beach Pulse, day-quality, condition, check-in or
 * sighting data — that separation is asserted by test.
 */

/** Visible label for a sponsored window on coordinator surfaces. */
export const SPONSORED_LABEL = "Sponsored";

/**
 * Integrity note rendered next to the sponsor toggle. It names the Beach
 * Pulse explicitly so coordinators see the earned-vs-paid boundary.
 */
export const SPONSORSHIP_NOTE =
  "Sponsorship only changes this window's curated branding layer. " +
  "It never feeds the Beach Pulse score, rankings, or live condition data.";

/**
 * Audience tags for an event window, mirroring the client pulse audience
 * vocabulary (src/pulse/types.ts) so per-audience leaderboards and event
 * targeting speak the same language. Deliberately declared locally: the
 * coordinator module must not import anything from the pulse module, so the
 * earned-vs-paid separation holds by construction, not convention.
 */
export const EVENT_AUDIENCES = [
  "family",
  "friends",
  "solo",
  "couples",
  "party",
  "chill",
] as const;

export type EventAudience = (typeof EVENT_AUDIENCES)[number];

export const EVENT_AUDIENCE_LABELS: Record<EventAudience, string> = {
  family: "Families",
  friends: "Friends",
  solo: "Solo",
  couples: "Couples",
  party: "Party seekers",
  chill: "Chill",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mutable form state for the publisher form (datetime-local strings). */
export type PublisherFormState = {
  beachPublicId: string;
  title: string;
  description: string;
  category: EventCategory;
  audienceTags: EventAudience[];
  startsAt: string;
  endsAt: string;
  isPaidTakeover: boolean;
  sponsorName: string;
};

export type PublisherFieldErrors = Partial<
  Record<keyof PublisherFormState, string>
>;

/**
 * Payload posted to POST /api/events. Extends the server-accepted
 * EventInput (server/events.ts eventInputSchema — flat isPaidTakeover and
 * sponsorName fields, never a nested paidTakeover object) with audienceTags.
 * The server schema currently strips the audienceTags key (zod object
 * default), so tags are validated and sent client-side today and persist
 * once the integration owner extends eventInputSchema; no server change is
 * made from this client-side workstream.
 */
export type CoordinatorEventPayload = EventInput & {
  audienceTags: EventAudience[];
};

/** The sponsor state of one event window. */
export type TakeoverChange = {
  isPaid: boolean;
  sponsorName: string | null;
};

export function emptyPublisherForm(): PublisherFormState {
  return {
    beachPublicId: "",
    title: "",
    description: "",
    category: "party",
    audienceTags: [],
    startsAt: "",
    endsAt: "",
    isPaidTakeover: false,
    sponsorName: "",
  };
}

/**
 * Validates the form against the same rules the server schema enforces
 * (title 1–120, description ≤ 2000, uuid beach id, ISO-able window with
 * end > start, sponsor 1–80 when paid). Returns the first error per field,
 * or null when the form is submittable.
 */
export function validateEventForm(
  form: PublisherFormState,
): PublisherFieldErrors | null {
  const errors: PublisherFieldErrors = {};

  if (!UUID_RE.test(form.beachPublicId.trim())) {
    errors.beachPublicId = "Enter the beach's public id (uuid).";
  }

  const title = form.title.trim();
  if (!title) {
    errors.title = "A title is required.";
  } else if (title.length > 120) {
    errors.title = "Keep the title under 120 characters.";
  }

  const description = form.description.trim();
  if (description.length > 2000) {
    errors.description = "Keep the description under 2000 characters.";
  }

  if (!EVENT_CATEGORIES.includes(form.category)) {
    errors.category = "Pick an event type.";
  }

  const start = new Date(form.startsAt).getTime();
  const end = new Date(form.endsAt).getTime();
  if (Number.isNaN(start)) {
    errors.startsAt = "Pick a start time.";
  }
  if (Number.isNaN(end)) {
    errors.endsAt = "Pick an end time.";
  }
  if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
    errors.endsAt = "The event must end after it starts.";
  }

  if (form.audienceTags.some((tag) => !EVENT_AUDIENCES.includes(tag))) {
    errors.audienceTags = "Unknown audience tag.";
  }

  if (form.isPaidTakeover) {
    const problem = sponsorProblem(form.sponsorName);
    if (problem) {
      errors.sponsorName = problem;
    }
  }

  return Object.keys(errors).length ? errors : null;
}

/** Sponsor name rules, mirroring the server schema (trim, 1–80 when paid). */
export function sponsorProblem(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter the sponsor name.";
  if (trimmed.length > 80) {
    return "Keep the sponsor name under 80 characters.";
  }
  return null;
}

/**
 * Converts form state into the POST /api/events payload: local
 * datetime-local values become UTC ISO strings (the server schema requires
 * ISO datetimes) and the sponsor name is cleared unless the window is paid.
 */
export function toEventPayload(
  form: PublisherFormState,
): CoordinatorEventPayload {
  const description = form.description.trim();
  const isPaid = form.isPaidTakeover;
  return {
    beachPublicId: form.beachPublicId.trim(),
    title: form.title.trim(),
    description: description ? description : undefined,
    category: form.category,
    startsAt: new Date(form.startsAt).toISOString(),
    endsAt: new Date(form.endsAt).toISOString(),
    isPaidTakeover: isPaid,
    sponsorName: isPaid ? form.sponsorName.trim() : undefined,
    audienceTags: [...form.audienceTags],
  };
}

/** ISO timestamp -> value for an `<input type="datetime-local">`. */
export function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Prefills the form from an existing event (draft edit). Audience tags are
 * not persisted by the events API today, so editing starts them empty.
 */
export function formStateFromEvent(event: BeachEvent): PublisherFormState {
  return {
    beachPublicId: event.beachPublicId,
    title: event.title,
    description: event.description ?? "",
    category: event.category,
    audienceTags: [],
    startsAt: toDatetimeLocal(event.startsAt),
    endsAt: toDatetimeLocal(event.endsAt),
    isPaidTakeover: event.paidTakeover.isPaid,
    sponsorName: event.paidTakeover.sponsorName ?? "",
  };
}

/**
 * Normalizes raw toggle + sponsor input into a TakeoverChange. An unpaid
 * window always carries a null sponsor — the server schema pairs
 * sponsor_name with is_paid_takeover, and a stray sponsor on an unpaid
 * window would be invalid state.
 */
export function normalizeTakeover(
  paid: boolean,
  sponsorRaw: string,
): TakeoverChange {
  return paid
    ? { isPaid: true, sponsorName: sponsorRaw.trim() }
    : { isPaid: false, sponsorName: null };
}

/**
 * The visible label for a sponsored window, or null for an organic one.
 * Used by the coordinator surfaces; the consumer calendar keeps rendering
 * its own paidTakeover.label badge.
 */
export function takeoverBadgeText(event: BeachEvent): string | null {
  if (!event.paidTakeover.isPaid) return null;
  const sponsor = event.paidTakeover.sponsorName;
  return sponsor ? `${SPONSORED_LABEL} · ${sponsor}` : SPONSORED_LABEL;
}

/**
 * Rebuilds the create payload for a replacement window from an existing
 * event plus the next sponsorship state. The events API has no update
 * handler, so changing sponsorship (or editing a draft) is modeled as
 * create-replacement + cancel-original — see ./api.ts.
 */
export function eventToPayload(
  event: BeachEvent,
  takeover: TakeoverChange,
): CoordinatorEventPayload {
  return {
    beachPublicId: event.beachPublicId,
    title: event.title,
    description: event.description ?? undefined,
    category: event.category,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    isPaidTakeover: takeover.isPaid,
    sponsorName: takeover.sponsorName ?? undefined,
    audienceTags: [],
  };
}

/** Upserts one event into a list by publicId (append when new). */
export function mergeEventList(
  events: BeachEvent[],
  incoming: BeachEvent,
): BeachEvent[] {
  const exists = events.some((event) => event.publicId === incoming.publicId);
  return exists
    ? events.map((event) =>
        event.publicId === incoming.publicId ? incoming : event,
      )
    : [...events, incoming];
}

/** Removes one event from a list by publicId. */
export function removeEvent(
  events: BeachEvent[],
  publicId: string,
): BeachEvent[] {
  return events.filter((event) => event.publicId !== publicId);
}
