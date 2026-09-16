import { describe, expect, it } from "vitest";
import {
  cancelBooking,
  computeRefundPolicy,
  getBookingReceipt,
  type BookingsDb,
} from "./bookings";

const NOW = new Date("2026-09-15T12:00:00Z");

/**
 * pg's query is a heavily overloaded generic, so a hand-rolled stub is not
 * directly assignable. Route the cast through unknown once, here, instead of
 * at every call site (same pattern as server/events.test.ts).
 */
function asQuery(
  fn: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>,
): BookingsDb["query"] {
  return fn as unknown as BookingsDb["query"];
}

describe("computeRefundPolicy", () => {
  it("gives a full refund more than 24 hours before start", () => {
    const startsAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1_000 + 1);
    expect(computeRefundPolicy(10_000, startsAt, NOW)).toEqual({
      tier: "full",
      refundCents: 10_000,
      forfeitCents: 0,
    });
  });

  it("gives a 50% refund exactly 24 hours before start", () => {
    const startsAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1_000);
    const result = computeRefundPolicy(10_001, startsAt, NOW);
    expect(result.tier).toBe("partial");
    expect(result.refundCents).toBe(5_001);
    expect(result.forfeitCents).toBe(5_000);
  });

  it("gives a 50% refund exactly 2 hours before start", () => {
    const startsAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1_000);
    expect(computeRefundPolicy(9_000, startsAt, NOW)).toEqual({
      tier: "partial",
      refundCents: 4_500,
      forfeitCents: 4_500,
    });
  });

  it("gives no refund just under 2 hours before start", () => {
    const startsAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1_000 - 1);
    expect(computeRefundPolicy(9_000, startsAt, NOW)).toEqual({
      tier: "none",
      refundCents: 0,
      forfeitCents: 9_000,
    });
  });

  it("gives no refund once the slot has started", () => {
    const startsAt = new Date(NOW.getTime() - 1);
    expect(computeRefundPolicy(9_000, startsAt, NOW).tier).toBe("none");
  });

  it("rejects a negative total", () => {
    expect(() =>
      computeRefundPolicy(
        -1,
        new Date(NOW.getTime() + 10 * 60 * 60 * 1_000),
        NOW,
      ),
    ).toThrow("total_cents_negative");
  });
});

type BookingRow = {
  id: number;
  starts_at: Date;
  status: string;
  total_cents: number;
  currency: string;
};

/**
 * Dispatches stubbed rows by SQL shape, in the order cancelBooking issues
 * them: booking select → booking update → cancellation insert → settlement
 * update → items select → inventory updates → audit insert.
 */
function makeCancelDb(booking: BookingRow | null, items: BookingRow[] = []) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const query = asQuery(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("from booking") && sql.includes("for update")) {
      return booking
        ? { rows: [booking], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes("from booking_item")) {
      return { rows: items, rowCount: items.length };
    }
    return { rows: [], rowCount: 0 };
  });
  return { db: { query }, calls };
}

describe("cancelBooking", () => {
  const confirmedBooking: BookingRow = {
    id: 42,
    starts_at: new Date(NOW.getTime() + 3 * 60 * 60 * 1_000),
    status: "confirmed",
    total_cents: 8_000,
    currency: "EUR",
  };

  it("cancels a confirmed booking with the partial refund outcome", async () => {
    const { db, calls } = makeCancelDb(confirmedBooking, [
      { inventory_id: 7, quantity: 2 } as unknown as BookingRow,
    ]);
    const result = await cancelBooking(db, {
      bookingPublicId: "bk-1",
      userId: 5,
      now: NOW,
    });
    expect(result.outcome).toBe("cancelled");
    if (result.outcome !== "cancelled") return;
    expect(result.status).toBe("cancelled");
    expect(result.refund.tier).toBe("partial");
    expect(result.refund.refundCents).toBe(4_000);

    const bookingUpdate = calls.find((call) =>
      call.sql.startsWith("update booking"),
    );
    expect(bookingUpdate?.params).toEqual([42]);

    const cancellationInsert = calls.find((call) =>
      call.sql.includes("insert into booking_cancellation"),
    );
    expect(cancellationInsert?.params).toEqual([
      42,
      5,
      4_000,
      4_000,
      "partial",
      "EUR",
    ]);

    const settlementUpdate = calls.find((call) =>
      call.sql.startsWith("update settlement"),
    );
    expect(settlementUpdate?.params).toEqual([42, "refunded"]);

    const inventoryUpdate = calls.find((call) =>
      call.sql.startsWith("update amenity_inventory"),
    );
    expect(inventoryUpdate?.params).toEqual([2, 7]);

    const audit = calls.find((call) =>
      call.sql.includes("insert into audit_log"),
    );
    expect(audit?.params?.[1]).toBe("booking_cancelled");
    expect(audit?.params?.[2]).toBe("bk-1");
  });

  it("marks the settlement settled rather than refunded on a no-refund cancel", async () => {
    const late: BookingRow = {
      ...confirmedBooking,
      starts_at: new Date(NOW.getTime() + 60 * 60 * 1_000),
    };
    const { db, calls } = makeCancelDb(late);
    const result = await cancelBooking(db, {
      bookingPublicId: "bk-1",
      userId: 5,
      now: NOW,
    });
    expect(result.outcome).toBe("cancelled");
    const settlementUpdate = calls.find((call) =>
      call.sql.startsWith("update settlement"),
    );
    expect(settlementUpdate?.params).toEqual([42, "settled"]);
  });

  it("returns not_found for a booking owned by someone else", async () => {
    const { db } = makeCancelDb(null);
    const result = await cancelBooking(db, {
      bookingPublicId: "bk-1",
      userId: 5,
      now: NOW,
    });
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("returns not_cancellable for a booking that is not confirmed", async () => {
    const { db } = makeCancelDb({ ...confirmedBooking, status: "cancelled" });
    const result = await cancelBooking(db, {
      bookingPublicId: "bk-1",
      userId: 5,
      now: NOW,
    });
    expect(result).toEqual({ outcome: "not_cancellable" });
  });

  it("scopes the booking lookup to the requesting owner", async () => {
    const { db, calls } = makeCancelDb(confirmedBooking);
    await cancelBooking(db, { bookingPublicId: "bk-1", userId: 9, now: NOW });
    const select = calls.find((call) => call.sql.includes("from booking"));
    expect(select?.params).toEqual(["bk-1", 9]);
  });
});

describe("getBookingReceipt", () => {
  function receiptDb(row: Record<string, unknown> | null): BookingsDb {
    const query = asQuery(async () =>
      row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 },
    );
    return { query };
  }

  const row = {
    public_id: "bk-1",
    status: "cancelled",
    starts_at: NOW,
    ends_at: new Date(NOW.getTime() + 6 * 60 * 60 * 1_000),
    created_at: NOW,
    subtotal_cents: 8_000,
    total_cents: 8_000,
    currency: "EUR",
    qr_token: "signed.token",
    beach_public_id: "beach-1",
    beach_name: "Praia Test",
    merchant_public_id: "m-1",
    business_name: "Beach Club Test",
    items: [{ type: "sunbed", quantity: 2, unitPriceCents: 4_000 }],
    refund_cents: 4_000,
    forfeit_cents: 4_000,
    refund_tier: "partial",
    cancelled_at: NOW,
  };

  it("returns the owner-scoped receipt with merchant, items and QR token", async () => {
    const receipt = await getBookingReceipt(receiptDb(row), {
      bookingPublicId: "bk-1",
      userId: 5,
    });
    expect(receipt).not.toBeNull();
    expect(receipt?.publicId).toBe("bk-1");
    expect(receipt?.merchant.businessName).toBe("Beach Club Test");
    expect(receipt?.items).toEqual([
      { type: "sunbed", quantity: 2, unitPriceCents: 4_000 },
    ]);
    expect(receipt?.qrToken).toBe("signed.token");
    expect(receipt?.cancellation?.tier).toBe("partial");
    expect(receipt?.cancellation?.refundCents).toBe(4_000);
  });

  it("returns null when the booking does not exist or is foreign", async () => {
    const receipt = await getBookingReceipt(receiptDb(null), {
      bookingPublicId: "bk-1",
      userId: 5,
    });
    expect(receipt).toBeNull();
  });

  it("omits the cancellation block for an active booking", async () => {
    const receipt = await getBookingReceipt(
      receiptDb({ ...row, status: "confirmed", cancelled_at: null }),
      { bookingPublicId: "bk-1", userId: 5 },
    );
    expect(receipt?.cancellation).toBeNull();
    expect(receipt?.status).toBe("confirmed");
  });
});
