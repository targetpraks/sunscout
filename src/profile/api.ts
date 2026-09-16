import type { Companion } from "./types";

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-sunscout-user-id": "00000000-0000-7000-8000-000000000001",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `api_${response.status}`);
  }
  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/** All companions in the caller's group profile, newest first. */
export async function fetchCompanions(): Promise<Companion[]> {
  const result = await apiRequest<{ data: Companion[] }>("/me/companions");
  return result.data;
}

/** Adds a companion; throws companion_duplicate_name (409) on a clash. */
export async function createCompanion(input: {
  name: string;
  relationship: Companion["relationship"];
}): Promise<Companion> {
  const result = await apiRequest<{ data: Companion }>("/me/companions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.data;
}

/** Owner-scoped delete; resolves false when the companion was not found. */
export async function deleteCompanion(
  companionPublicId: string,
): Promise<boolean> {
  try {
    await apiRequest(
      `/me/companions/${encodeURIComponent(companionPublicId)}`,
      { method: "DELETE" },
    );
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "companion_not_found") {
      return false;
    }
    throw error;
  }
}

/**
 * Companions attached to one booking, for the receipt's "Who's coming"
 * chips. Throws booking_not_found (404) for missing and foreign bookings.
 */
export async function fetchBookingCompanions(
  bookingPublicId: string,
): Promise<Companion[]> {
  const result = await apiRequest<{ data: Companion[] }>(
    `/bookings/${encodeURIComponent(bookingPublicId)}/companions`,
  );
  return result.data;
}

/**
 * Full-replace PATCH of the booking's companion set. Sends the COMPLETE
 * attached id array — never a delta. Throws companion_not_owned_or_missing
 * (422) when an id does not belong to the caller.
 */
export async function updateBookingCompanions(
  bookingPublicId: string,
  companionPublicIds: string[],
): Promise<Companion[]> {
  const result = await apiRequest<{ data: Companion[] }>(
    `/bookings/${encodeURIComponent(bookingPublicId)}/companions`,
    { method: "PATCH", body: JSON.stringify({ companionPublicIds }) },
  );
  return result.data;
}
