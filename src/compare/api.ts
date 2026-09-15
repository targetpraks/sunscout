/**
 * Beach compare — API composition.
 *
 * Thin wrappers over the existing consumer endpoints (../api) — no new
 * server surface, no duplicated request plumbing. The compare screen needs
 * three things: the live beach catalog (with origin so drive distance is
 * server-populated), the wishlist ids, and the create-trip endpoint used to
 * commit the compare trip draft exactly once.
 */

import { createTrip, fetchBeaches, fetchSavedBeachIds } from "../api";
import type { Origin, TripDraft } from "./types";

/**
 * Full beach catalog with refreshed live conditions. When an origin is
 * given it is passed through so the server populates `travel`
 * (distanceKm / driveMinutes) per beach.
 */
export async function fetchCompareCatalog(
  origin: Origin | null,
): Promise<import("../types").Beach[]> {
  return fetchBeaches(
    origin
      ? { lat: origin.latitude, lng: origin.longitude, refresh: true }
      : { refresh: true },
  );
}

/** Wishlist (saved) beach public ids for the signed-in user. */
export async function fetchWishlistIds(): Promise<string[]> {
  return fetchSavedBeachIds();
}

/**
 * Commit the compare trip draft through the existing create-trip endpoint.
 *
 * The server exposes no append-a-beach-to-trip endpoint — POST /api/me/trips
 * is create-with-beaches only — so the draft is committed exactly once with
 * the full beach list. This mirrors the TripSheet flow in the app shell.
 */
export async function commitTripDraft(
  draft: TripDraft,
  origin: Origin | null,
): Promise<string> {
  const created = await createTrip({
    name: draft.name,
    beachPublicIds: draft.beachIds,
    ...(origin
      ? {
          locationLabel: origin.label,
          latitude: origin.latitude,
          longitude: origin.longitude,
        }
      : {}),
  });
  return created.data.public_id;
}
