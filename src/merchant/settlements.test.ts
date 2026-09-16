/**
 * Client-side settlement helper tests: the ledger row view model and the
 * date/state guards backing TransactionRow, PayoutLedger and
 * SettlementDashboard. Pure functions only (same pattern as
 * src/bookings/bookings.test.ts) — no DOM or render dependencies.
 *
 * These pin the acceptance contract: ledger rows distinguish booked vs
 * redeemed vs settled, and format currency/date consistently with the
 * server response types (minor units + ISO currency code, ISO timestamps).
 */
import { describe, expect, it } from "vitest";
import {
  formatLedgerDate,
  isLedgerState,
  LEDGER_STATE_META,
  toLedgerRowModel,
  type LedgerEntry,
} from "./types";
import { formatMoney } from "../bookings/types";

const NOW = new Date("2026-09-15T12:00:00Z");

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    booking_public_id: "11111111-1111-4111-8111-111111111111",
    beach_name: "Praia Test",
    starts_at: new Date(NOW.getTime() + 3 * 60 * 60 * 1_000).toISOString(),
    created_at: NOW.toISOString(),
    gross_cents: 8_000,
    commission_cents: 400,
    net_cents: 7_600,
    currency: "EUR",
    state: "redeemed",
    settled_at: null,
    ...overrides,
  };
}

describe("isLedgerState", () => {
  it("accepts the three merchant-facing states", () => {
    expect(isLedgerState("booked")).toBe(true);
    expect(isLedgerState("redeemed")).toBe(true);
    expect(isLedgerState("settled")).toBe(true);
  });

  it("rejects anything off the wire that is not a ledger state", () => {
    expect(isLedgerState("cancelled")).toBe(false);
    expect(isLedgerState("refunded")).toBe(false);
    expect(isLedgerState("")).toBe(false);
    expect(isLedgerState(null)).toBe(false);
    expect(isLedgerState(42)).toBe(false);
  });
});

describe("formatLedgerDate", () => {
  it("formats an ISO timestamp with day, short month and year", () => {
    const label = formatLedgerDate("2026-09-15T10:00:00Z");
    expect(label).toContain("2026");
    // Must match the en-GB date shape the bookings surface uses.
    expect(label).toContain(
      new Date("2026-09-15T10:00:00Z").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    );
  });

  it("renders an em dash for a missing date", () => {
    expect(formatLedgerDate(null)).toBe("—");
  });

  it("renders an em dash for an unparseable date instead of Invalid Date", () => {
    expect(formatLedgerDate("not-a-date")).toBe("—");
  });
});

describe("toLedgerRowModel", () => {
  it("labels and tones each of the three ledger states distinctly", () => {
    for (const state of ["booked", "redeemed", "settled"] as const) {
      const model = toLedgerRowModel(makeEntry({ state }));
      expect(model.stateLabel).toBe(LEDGER_STATE_META[state].label);
      expect(model.stateTone).toBe(state);
      expect(model.stateHint).toBe(LEDGER_STATE_META[state].hint);
    }
    const labels = (["booked", "redeemed", "settled"] as const).map(
      (state) => LEDGER_STATE_META[state].label,
    );
    expect(new Set(labels).size).toBe(3);
  });

  it("formats gross, commission and net through the shared money formatter", () => {
    const model = toLedgerRowModel(makeEntry());
    expect(model.grossLabel).toBe(formatMoney(8_000, "EUR"));
    expect(model.commissionLabel).toBe(formatMoney(400, "EUR"));
    expect(model.netLabel).toBe(formatMoney(7_600, "EUR"));
  });

  it("shows the payout date for settled rows and the booking date otherwise", () => {
    const settled = toLedgerRowModel(
      makeEntry({ state: "settled", settled_at: "2026-09-20T09:00:00Z" }),
    );
    expect(settled.moneyDateLabel).toBe(
      formatLedgerDate("2026-09-20T09:00:00Z"),
    );
    const booked = toLedgerRowModel(makeEntry({ state: "booked" }));
    expect(booked.moneyDateLabel).toBe(formatLedgerDate(booked.whenLabel));
  });

  it("carries the beach name and slot date through to the row", () => {
    const model = toLedgerRowModel(makeEntry());
    expect(model.beachName).toBe("Praia Test");
    expect(model.whenLabel).toBe(formatLedgerDate(makeEntry().starts_at));
  });
});
