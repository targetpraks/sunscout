/**
 * Settlement ledger tests: the pure merchant-facing state machine and the
 * balance computation that back GET /api/merchant/settlements/ledger, plus
 * the route registration itself.
 *
 * deriveLedgerState maps raw booking/settlement statuses onto the three
 * merchant-facing states; computeSettlementBalances turns the resulting
 * ledger into the payout figures the dashboard renders. The DB-backed
 * handler is a thin serializer over these two functions (same split as
 * bookings.ts), so unit-testing the pure core + asserting route registration
 * covers the endpoint without a database.
 */
import { describe, expect, it } from "vitest";
import {
  computeSettlementBalances,
  deriveLedgerState,
  merchantRouter,
  type LedgerState,
} from "./routes/merchant";

describe("deriveLedgerState", () => {
  it("treats a pending settlement on a confirmed booking as booked", () => {
    expect(
      deriveLedgerState({
        booking_status: "confirmed",
        settlement_status: "pending",
      }),
    ).toBe("booked");
  });

  it("treats a confirmed booking with no settlement row as booked", () => {
    expect(
      deriveLedgerState({
        booking_status: "confirmed",
        settlement_status: null,
      }),
    ).toBe("booked");
  });

  it("treats a redeemed booking with a pending settlement as redeemed", () => {
    expect(
      deriveLedgerState({
        booking_status: "redeemed",
        settlement_status: "pending",
      }),
    ).toBe("redeemed");
  });

  it("treats a settled settlement as settled regardless of booking status", () => {
    expect(
      deriveLedgerState({
        booking_status: "redeemed",
        settlement_status: "settled",
      }),
    ).toBe("settled");
    expect(
      deriveLedgerState({
        booking_status: "confirmed",
        settlement_status: "settled",
      }),
    ).toBe("settled");
  });

  it("excludes cancelled, no-show and refunded money from the ledger", () => {
    expect(
      deriveLedgerState({
        booking_status: "cancelled",
        settlement_status: "pending",
      }),
    ).toBeNull();
    expect(
      deriveLedgerState({
        booking_status: "cancelled",
        settlement_status: "refunded",
      }),
    ).toBeNull();
    expect(
      deriveLedgerState({
        booking_status: "no_show",
        settlement_status: "pending",
      }),
    ).toBeNull();
    expect(
      deriveLedgerState({
        booking_status: "refunded",
        settlement_status: "refunded",
      }),
    ).toBeNull();
  });

  it("excludes a refunded settlement even on a non-terminal booking", () => {
    // A settlement that flipped to refunded closes the payout; the booking
    // row keeps whatever status it had — either way it is not ledger money.
    expect(
      deriveLedgerState({
        booking_status: "confirmed",
        settlement_status: "refunded",
      }),
    ).toBeNull();
    expect(
      deriveLedgerState({
        booking_status: "redeemed",
        settlement_status: "refunded",
      }),
    ).toBeNull();
  });

  it("keeps a settled settlement on a cancelled booking as settled", () => {
    // No-refund cancellations are legitimate forfeitures: server/bookings.ts
    // marks their settlement settled, so the money really was paid out and
    // must stay in the ledger and the payout history.
    expect(
      deriveLedgerState({
        booking_status: "cancelled",
        settlement_status: "settled",
      }),
    ).toBe("settled");
  });

  it("keeps a settled settlement on a no-show booking as settled", () => {
    expect(
      deriveLedgerState({
        booking_status: "no_show",
        settlement_status: "settled",
      }),
    ).toBe("settled");
  });
});

describe("computeSettlementBalances", () => {
  function ledger(state: LedgerState, netCents: number) {
    return { state, netCents };
  }

  it("splits net cents into available (redeemed), in-progress (booked) and paid (settled)", () => {
    const balances = computeSettlementBalances([
      ledger("booked", 5_000),
      ledger("redeemed", 8_000),
      ledger("settled", 20_000),
      ledger("redeemed", 1_200),
      ledger("booked", 300),
    ]);
    expect(balances).toEqual({
      availableCents: 9_200,
      inProgressCents: 5_300,
      paidCents: 20_000,
    });
  });

  it("never counts still-cancellable booked money as available for payout", () => {
    // A confirmed booking can still be cancelled (full refund >24h out), so
    // its net cents must not appear in availableCents.
    const balances = computeSettlementBalances([ledger("booked", 10_000)]);
    expect(balances.availableCents).toBe(0);
    expect(balances.inProgressCents).toBe(10_000);
  });

  it("returns zeroed balances for an empty ledger", () => {
    expect(computeSettlementBalances([])).toEqual({
      availableCents: 0,
      inProgressCents: 0,
      paidCents: 0,
    });
  });
});

describe("merchantRouter wiring", () => {
  /** Express exposes the registered layer stack; assert real mounting. */
  function registeredPaths(): string[] {
    const stack = (
      merchantRouter as unknown as {
        stack: Array<{
          route?: { path: string; methods: Record<string, boolean> };
        }>;
      }
    ).stack;
    return stack
      .filter((layer) => layer.route)
      .map((layer) => {
        const methods = Object.keys(layer!.route!.methods)
          .filter((m) => layer!.route!.methods[m])
          .map((m) => m.toUpperCase())
          .join(",");
        return `${methods} ${layer!.route!.path}`;
      })
      .sort();
  }

  it("mounts the settlement ledger route alongside the existing merchant routes", () => {
    const paths = registeredPaths();
    expect(paths).toContain("GET /api/merchant/settlements/ledger");
    // The pre-existing summary endpoint and the dashboard must survive.
    expect(paths).toContain("GET /api/merchant/settlements");
    expect(paths).toContain("GET /api/merchant/dashboard");
  });
});
