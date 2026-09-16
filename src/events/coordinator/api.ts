import type { BeachEvent } from "../types";
import {
  eventToPayload,
  type CoordinatorEventPayload,
  type TakeoverChange,
} from "./types";
import { cancelEvent, createEvent, publishEvent } from "../api";

export {
  cancelEvent,
  createEvent,
  publishEvent,
  fetchCoordinatorEvents,
} from "../api";

/**
 * Coordinator publishing API — a thin layer over the existing /api/events
 * handlers (src/events/api.ts → server/events.ts). There is deliberately no
 * new endpoint here: the server exposes create / publish / cancel only, so
 * every "edit" or "sponsorship change" on an existing window is modeled as
 * create-replacement + (publish when the original was live) + cancel-original.
 */

/** Result of replacing one event window with a new one. */
export type TakeoverApplyResult = {
  /** The window that was replaced (now cancelled, or still live if the cancel failed). */
  originalPublicId: string;
  /** The newly created window carrying the new content/sponsorship. */
  replacement: BeachEvent;
  /** Whether the original window was successfully cancelled. */
  originalCancelled: boolean;
  /** Error message when the replacement was created but the original cancel failed. */
  cancelError: string | null;
};

/**
 * Creates an event and immediately publishes it. Two POSTs against the
 * existing handlers: POST /api/events then POST /api/events/:id/publish.
 */
export async function createAndPublishEvent(
  input: CoordinatorEventPayload,
): Promise<BeachEvent> {
  const created = await createEvent(input);
  return publishEvent(created.publicId);
}

/**
 * Replaces one event window with a new draft (or published event when the
 * original was published, so consumer visibility is preserved). If the final
 * cancel of the original fails, the error is surfaced in the result instead
 * of being swallowed — the caller can still merge the replacement and warn.
 */
export async function replaceEvent(
  original: BeachEvent,
  payload: CoordinatorEventPayload,
): Promise<TakeoverApplyResult> {
  const created = await createEvent(payload);
  let replacement = created;
  if (original.state === "published" && created.state === "draft") {
    replacement = await publishEvent(created.publicId);
  }
  let originalCancelled = true;
  let cancelError: string | null = null;
  try {
    await cancelEvent(original.publicId);
  } catch (error) {
    originalCancelled = false;
    cancelError = error instanceof Error ? error.message : String(error);
  }
  return {
    originalPublicId: original.publicId,
    replacement,
    originalCancelled,
    cancelError,
  };
}

/**
 * Applies a sponsorship change to one event window via the replace flow.
 * This is the ONLY write path for the curated/branding layer: it touches
 * beach_event rows through /api/events exclusively and never reads or
 * writes Beach Pulse, day-quality, condition, check-in or sighting data.
 * That earned-vs-paid separation is asserted in ./coordinator.test.ts.
 */
export async function applyTakeoverChange(
  event: BeachEvent,
  takeover: TakeoverChange,
): Promise<TakeoverApplyResult> {
  if (takeover.isPaid && !(takeover.sponsorName ?? "").trim()) {
    // Mirrors the server schema (sponsorName min 1 when present): a paid
    // window without a sponsor is invalid state and must not reach the API.
    throw new Error("sponsor_name_required");
  }
  return replaceEvent(event, eventToPayload(event, takeover));
}
