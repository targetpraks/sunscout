import type { Pool, PoolClient } from "pg";
import { Router } from "express";
import { pool, withTransaction } from "./db";

type Queryable = Pick<Pool | PoolClient, "query">;

/** Exported so tests and callers can type fake/connection-scoped DB handles. */
export type BookingsDb = Queryable;

// ---------------------------------------------------------------------------
// Refund policy
// ---------------------------------------------------------------------------

/**
 * Self-service cancellation refund policy (booking self-service workstream):
 *
 *   - full refund  — more than 24 hours before the booking starts
 *   - 50% refund   — from 2 hours up to and including 24 hours before start
 *   - no refund    — less than 2 hours before start (past start included)
 *
 * Deliberately NOT billing.ts's computeRefund: that helper implements the
 * older 24h/0h policy and is owned by a different workstream. Boundaries
 * follow the spec literally: exactly 24h falls in the partial window, exactly
 * 2h is still partial, one second under 2h is none.
 */
export const REFUND_FULL_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const REFUND_PARTIAL_WINDOW_MS = 2 * 60 * 60 * 1_000;

export type RefundTier = "full" | "partial" | "none";

export type RefundPolicyResult = {
  tier: RefundTier;
  refundCents: number;
  forfeitCents: number;
};

export function computeRefundPolicy(
  totalCents: number,
  startsAt: Date,
  now: Date = new Date(),
): RefundPolicyResult {
  if (totalCents < 0) throw new Error("total_cents_negative");
  const msUntilStart = startsAt.getTime() - now.getTime();
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

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function auditBookingEvent(
  db: BookingsDb,
  userId: number,
  action: string,
  target: string,
  properties: Record<string, unknown>,
) {
  await db.query(
    `insert into audit_log(actor_user_id, action, target, properties)
     values ($1, $2, $3, $4)`,
    [userId, action, target, JSON.stringify(properties)],
  );
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export type CancelBookingInput = {
  bookingPublicId: string;
  userId: number;
  now?: Date;
};

export type CancelBookingResult =
  | { outcome: "not_found" }
  | { outcome: "not_cancellable" }
  | {
      outcome: "cancelled";
      bookingPublicId: string;
      status: "cancelled";
      refund: RefundPolicyResult;
      cancelledAt: string;
    };

/**
 * Owner-scoped self-service cancellation. Loads the booking with a row lock
 * (`where public_id = $1 and user_id = $2 for update`) so a booking that is
 * not owned by the caller is indistinguishable from a missing one, marks it
 * cancelled, records the refund outcome in booking_cancellation, follows the
 * money in settlement, restores inventory, and writes an audit_log entry.
 * Callers that need atomicity should run this inside withTransaction.
 */
export async function cancelBooking(
  db: BookingsDb,
  input: CancelBookingInput,
): Promise<CancelBookingResult> {
  const now = input.now ?? new Date();
  const booking = await db.query<{
    id: number;
    starts_at: Date;
    status: string;
    total_cents: number;
    currency: string;
  }>(
    `select id, starts_at, status, total_cents, currency
     from booking
     where public_id = $1 and user_id = $2
     for update`,
    [input.bookingPublicId, input.userId],
  );
  if (!booking.rowCount) return { outcome: "not_found" };
  const row = booking.rows[0];
  if (row.status !== "confirmed") return { outcome: "not_cancellable" };

  const refund = computeRefundPolicy(row.total_cents, row.starts_at, now);
  await db.query(
    `update booking set status = 'cancelled', updated_at = now() where id = $1`,
    [row.id],
  );
  await db.query(
    `insert into booking_cancellation(
       booking_id, user_id, refund_cents, forfeit_cents, refund_tier, currency
     ) values ($1, $2, $3, $4, $5, $6)
     on conflict (booking_id) do nothing`,
    [
      row.id,
      input.userId,
      refund.refundCents,
      refund.forfeitCents,
      refund.tier,
      row.currency,
    ],
  );
  // Settlement follows the money: a refunded booking closes the pending
  // payout; a no-refund cancellation is a legitimate forfeiture, so the
  // merchant's pending settlement becomes payable rather than refunded.
  await db.query(
    `update settlement
     set status = $2, settled_at = now()
     where booking_id = $1`,
    [row.id, refund.refundCents > 0 ? "refunded" : "settled"],
  );
  const items = await db.query<{ inventory_id: number; quantity: number }>(
    `select inventory_id, quantity from booking_item where booking_id = $1`,
    [row.id],
  );
  for (const item of items.rows) {
    await db.query(
      `update amenity_inventory
       set available_count = least(total_count, available_count + $1),
           version = version + 1,
           updated_at = now()
       where id = $2`,
      [item.quantity, item.inventory_id],
    );
  }
  await auditBookingEvent(
    db,
    input.userId,
    "booking_cancelled",
    input.bookingPublicId,
    {
      tier: refund.tier,
      policy: refund.tier,
      refundCents: refund.refundCents,
      forfeitCents: refund.forfeitCents,
    },
  );
  return {
    outcome: "cancelled",
    bookingPublicId: input.bookingPublicId,
    status: "cancelled",
    refund,
    cancelledAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

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
  items: Array<{ type: string; quantity: number; unitPriceCents: number }>;
  cancellation: {
    refundCents: number;
    forfeitCents: number;
    tier: RefundTier;
    cancelledAt: string;
  } | null;
};

/**
 * Owner-scoped receipt: booking details, line items, merchant info, the
 * signed QR redemption token, and — when applicable — the cancellation
 * outcome. Returns null when the booking does not exist or belongs to
 * another user (indistinguishable by design).
 */
export async function getBookingReceipt(
  db: BookingsDb,
  input: { bookingPublicId: string; userId: number },
): Promise<BookingReceipt | null> {
  const result = await db.query<{
    public_id: string;
    status: string;
    starts_at: Date;
    ends_at: Date;
    created_at: Date;
    subtotal_cents: number;
    total_cents: number;
    currency: string;
    qr_token: string;
    beach_public_id: string;
    beach_name: string;
    merchant_public_id: string;
    business_name: string;
    items: Array<{
      type: string;
      quantity: number;
      unitPriceCents: number;
    }> | null;
    refund_cents: number | null;
    forfeit_cents: number | null;
    refund_tier: RefundTier | null;
    cancelled_at: Date | null;
  }>(
    `select
       bk.public_id, bk.starts_at, bk.ends_at, bk.status, bk.created_at,
       bk.subtotal_cents, bk.total_cents, bk.currency, bk.qr_token,
       b.public_id as beach_public_id, b.name as beach_name,
       m.public_id as merchant_public_id, m.business_name,
       coalesce(
         jsonb_agg(
           jsonb_build_object(
             'type', ai.amenity_type,
             'quantity', bi.quantity,
             'unitPriceCents', bi.unit_price_cents
           ) order by ai.amenity_type
         ) filter (where ai.id is not null),
         '[]'::jsonb
       ) as items,
       bc.refund_cents, bc.forfeit_cents, bc.refund_tier, bc.cancelled_at
     from booking bk
     join beach b on b.id = bk.beach_id
     join merchant m on m.id = bk.merchant_id
     left join booking_item bi on bi.booking_id = bk.id
     left join amenity_inventory ai on ai.id = bi.inventory_id
     left join booking_cancellation bc on bc.booking_id = bk.id
     where bk.public_id = $1 and bk.user_id = $2
     group by bk.id, b.id, m.id, bc.id`,
    [input.bookingPublicId, input.userId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    publicId: row.public_id,
    status: row.status,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    subtotalCents: row.subtotal_cents,
    totalCents: row.total_cents,
    currency: row.currency,
    qrToken: row.qr_token,
    beach: { publicId: row.beach_public_id, name: row.beach_name },
    merchant: {
      publicId: row.merchant_public_id,
      businessName: row.business_name,
    },
    items: row.items ?? [],
    cancellation: row.cancelled_at
      ? {
          refundCents: row.refund_cents ?? 0,
          forfeitCents: row.forfeit_cents ?? 0,
          tier: row.refund_tier ?? "none",
          cancelledAt: row.cancelled_at.toISOString(),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Express router — mounted by server/index.ts in one additive block
// ---------------------------------------------------------------------------

export const bookingsRouter = Router();

/**
 * POST /api/bookings/:bookingPublicId/cancel
 *
 * `policy` is the tier name required by the self-service contract;
 * `tier`/`refundCents` mirror it so the pre-existing consumer in src/api.ts
 * (App.tsx cancel flows) keeps working unchanged. Owner-scoped via the
 * requireUser middleware mounted at /api/bookings in index.ts.
 */
bookingsRouter.post("/:bookingPublicId/cancel", async (request, response) => {
  const userId = request.userId;
  if (userId == null) {
    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }
  const result = await withTransaction((client) =>
    cancelBooking(client, {
      bookingPublicId: request.params.bookingPublicId,
      userId,
    }),
  );
  if (result.outcome === "not_found") {
    throw Object.assign(new Error("booking_not_found"), { status: 404 });
  }
  if (result.outcome === "not_cancellable") {
    throw Object.assign(new Error("booking_not_cancellable"), { status: 409 });
  }
  response.json({
    data: {
      refundAmount: result.refund.refundCents,
      refundCents: result.refund.refundCents,
      forfeitCents: result.refund.forfeitCents,
      policy: result.refund.tier,
      tier: result.refund.tier,
      status: result.status,
      bookingId: result.bookingPublicId,
      cancelledAt: result.cancelledAt,
    },
  });
});

/**
 * GET /api/bookings/:bookingPublicId/receipt — owner-scoped receipt with the
 * signed QR redemption token. 404 for both missing and foreign bookings.
 */
bookingsRouter.get("/:bookingPublicId/receipt", async (request, response) => {
  const userId = request.userId;
  if (userId == null) {
    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }
  const receipt = await getBookingReceipt(pool, {
    bookingPublicId: request.params.bookingPublicId,
    userId,
  });
  if (!receipt) {
    throw Object.assign(new Error("booking_not_found"), { status: 404 });
  }
  response.json({ data: receipt });
});
