import type { BookingReceipt, CancelBookingResult, MyBooking } from "./types";

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

/** All bookings owned by the signed-in user, upcoming and past alike. */
export async function fetchMyBookings(): Promise<MyBooking[]> {
  const result = await apiRequest<{
    data: Array<{
      public_id: string;
      beach_public_id: string;
      beach_name: string;
      starts_at: string;
      ends_at: string;
      status: MyBooking["status"];
      total_cents: number;
      currency: string;
      qr_token: string;
      items: Array<{ type: string; quantity: number; unitPriceCents: number }>;
    }>;
  }>("/bookings");
  return result.data.map((row) => ({
    id: row.public_id,
    beachPublicId: row.beach_public_id,
    beachName: row.beach_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    totalCents: row.total_cents,
    currency: row.currency,
    qrToken: row.qr_token,
    items: row.items ?? [],
  }));
}

/** Self-service cancellation; returns the applied refund policy outcome. */
export async function cancelBooking(
  bookingPublicId: string,
): Promise<CancelBookingResult> {
  const result = await apiRequest<{ data: CancelBookingResult }>(
    `/bookings/${encodeURIComponent(bookingPublicId)}/cancel`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return result.data;
}

/** Owner-scoped receipt for one booking (details, merchant info, QR token). */
export async function fetchBookingReceipt(
  bookingPublicId: string,
): Promise<BookingReceipt> {
  const result = await apiRequest<{ data: BookingReceipt }>(
    `/bookings/${encodeURIComponent(bookingPublicId)}/receipt`,
  );
  return result.data;
}
