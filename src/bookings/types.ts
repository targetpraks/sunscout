/**
 * Client-side booking domain types and pure helpers. Mirrors the server
 * module (server/bookings.ts) — the front-end cannot import server code, so
 * keep the two copies aligned. Field names match the server serializers.
 */

export const REFUND_FULL_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const REFUND_PARTIAL_WINDOW_MS = 2 * 60 * 60 * 1_000;

export type RefundTier = "full" | "partial" | "none";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "redeemed"
  | "cancelled"
  | "no_show"
  | "refunded";

export type BookingItem = {
  type: string;
  quantity: number;
  unitPriceCents: number;
};

export type MyBooking = {
  /** booking public id (uuid) — the API identifier for cancel/receipt calls */
  id: string;
  beachPublicId: string;
  beachName: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  totalCents: number;
  currency: string;
  qrToken: string;
  items: BookingItem[];
};

export type CancelBookingResult = {
  /** refund in minor units — the self-service contract field */
  refundAmount: number;
  refundCents: number;
  forfeitCents: number;
  policy: RefundTier;
  /** mirrors `policy` for the legacy App.tsx cancel flows */
  tier: RefundTier;
  status: string;
  bookingId: string;
  cancelledAt: string;
};

export type BookingReceipt = {
  publicId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  qrToken: string;
  beach: { publicId: string; name: string };
  merchant: { publicId: string; businessName: string };
  items: BookingItem[];
  cancellation: {
    refundCents: number;
    forfeitCents: number;
    tier: RefundTier;
    cancelledAt: string;
  } | null;
};

/**
 * Client-side refund preview for the cancel modal. Mirrors
 * server/bookings.ts computeRefundPolicy exactly (same boundaries): full
 * >24h before start, 50% from 2h up to and including 24h, none under 2h.
 * The server recomputes authoritatively on confirm.
 */
export function computeCancelPreview(
  totalCents: number,
  startsAt: string | Date,
  now: Date = new Date(),
): { tier: RefundTier; refundCents: number; forfeitCents: number } {
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (totalCents < 0) throw new Error("total_cents_negative");
  const msUntilStart = start.getTime() - now.getTime();
  if (msUntilStart > REFUND_FULL_WINDOW_MS) {
    return { tier: "full", refundCents: totalCents, forfeitCents: 0 };
  }
  if (msUntilStart >= REFUND_PARTIAL_WINDOW_MS) {
    const refundCents = Math.round(totalCents / 2);
    return {
      tier: "partial",
      refundCents,
      forfeitCents: totalCents - refundCents,
    };
  }
  return { tier: "none", refundCents: 0, forfeitCents: totalCents };
}

export const REFUND_TIER_LABELS: Record<RefundTier, string> = {
  full: "Full refund",
  partial: "50% refund",
  none: "No refund",
};

export const REFUND_POLICY_LINES: ReadonlyArray<{
  tier: RefundTier;
  text: string;
}> = [
  {
    tier: "full",
    text: "Full refund until 24 hours before your slot starts",
  },
  {
    tier: "partial",
    text: "50% refund between 2 and 24 hours before your slot starts",
  },
  { tier: "none", text: "No refund less than 2 hours before your slot" },
];

/**
 * Upcoming = not cancelled and still running or in the future (a booking in
 * progress stays visible until its slot ends). Past = everything else,
 * including cancelled bookings. Upcoming sorts by start ascending, past by
 * start descending.
 */
export function partitionBookings(
  bookings: MyBooking[],
  now: Date = new Date(),
): { upcoming: MyBooking[]; past: MyBooking[] } {
  const ref = now.getTime();
  const upcoming: MyBooking[] = [];
  const past: MyBooking[] = [];
  for (const booking of bookings) {
    if (
      booking.status !== "cancelled" &&
      new Date(booking.endsAt).getTime() >= ref
    ) {
      upcoming.push(booking);
    } else {
      past.push(booking);
    }
  }
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  past.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { upcoming, past };
}

/** Only confirmed bookings can be cancelled (matches the server rule). */
export function isCancellable(booking: MyBooking): boolean {
  return booking.status === "confirmed";
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function formatBookingWhen(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const date = start.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const from = start.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const to = new Date(endsAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${from}–${to}`;
}
