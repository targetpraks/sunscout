/**
 * Merchant settlement domain types and pure helpers. Mirrors the server
 * serializer in server/routes/merchant.ts (GET /api/merchant/settlements/
 * ledger) — field names match the JSON the server emits, so the shapes stay
 * aligned without the front-end importing server code.
 *
 * Money is always minor units (cents) with an ISO currency code, exactly as
 * the server returns it; formatting goes through the shared formatMoney
 * helper from src/bookings/types.ts so every surface renders currency the
 * same way.
 */
import { formatMoney } from "../bookings/types";

/** Merchant-facing ledger state: booked → redeemed → settled. */
export type LedgerState = "booked" | "redeemed" | "settled";

export type LedgerEntry = {
  booking_public_id: string;
  beach_name: string;
  starts_at: string;
  created_at: string;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  currency: string;
  state: LedgerState;
  settled_at: string | null;
};

export type PayoutEntry = {
  settlement_public_id: string | null;
  booking_public_id: string;
  beach_name: string;
  net_cents: number;
  currency: string;
  settled_at: string;
};

/** Computed by the server from the ledger: the merchant's payout position. */
export type SettlementBalance = {
  /** Net cents earned (redeemed) but not yet paid out. */
  availableCents: number;
  /** Net cents booked but still cancellable — not payout money yet. */
  inProgressCents: number;
  /** Net cents already paid out (settled). */
  paidCents: number;
};

export type SettlementLedgerResponse = {
  ledger: LedgerEntry[];
  payouts: PayoutEntry[];
  balance: SettlementBalance;
};

/** One row of GET /api/merchant/profile — a merchant the user owns. */
export type MerchantProfile = {
  public_id: string;
  business_name: string;
  kyc_status: string;
  beach_name: string;
  beach_public_id: string;
};

/** Display metadata per ledger state — one label/tone per state, no overlap. */
export const LEDGER_STATE_META: Record<
  LedgerState,
  { label: string; tone: LedgerState; hint: string }
> = {
  booked: {
    label: "Booked",
    tone: "booked",
    hint: "Reserved — still cancellable, not payout money yet",
  },
  redeemed: {
    label: "Redeemed",
    tone: "redeemed",
    hint: "Served — earned, awaiting payout",
  },
  settled: {
    label: "Settled",
    tone: "settled",
    hint: "Paid out",
  },
};

/** Runtime guard for the state field coming off the wire. */
export function isLedgerState(value: unknown): value is LedgerState {
  return (
    (value === "booked" || value === "redeemed" || value === "settled") &&
    typeof value === "string"
  );
}

/**
 * Formats a server timestamp (ISO string) the way the bookings surface
 * formats dates: en-GB, day + short month + year. Unparseable input renders
 * as an em dash rather than "Invalid Date".
 */
export function formatLedgerDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Everything a ledger row needs to render, derived in one testable place. */
export type LedgerRowModel = {
  state: LedgerState;
  stateLabel: string;
  stateTone: LedgerState;
  stateHint: string;
  beachName: string;
  /** When the guest's slot starts (or "—" when unparseable). */
  whenLabel: string;
  /** When money moved — settled_at for settled rows, else the booking date. */
  moneyDateLabel: string;
  grossLabel: string;
  commissionLabel: string;
  netLabel: string;
};

/**
 * Maps one server ledger entry onto its view model. Currency formatting goes
 * through the shared formatMoney helper so a ledger row shows money exactly
 * like a booking card does (minor units → currency string).
 */
export function toLedgerRowModel(entry: LedgerEntry): LedgerRowModel {
  const meta = LEDGER_STATE_META[entry.state];
  return {
    state: entry.state,
    stateLabel: meta.label,
    stateTone: meta.tone,
    stateHint: meta.hint,
    beachName: entry.beach_name,
    whenLabel: formatLedgerDate(entry.starts_at),
    moneyDateLabel: formatLedgerDate(entry.settled_at ?? entry.created_at),
    grossLabel: formatMoney(entry.gross_cents, entry.currency),
    commissionLabel: formatMoney(entry.commission_cents, entry.currency),
    netLabel: formatMoney(entry.net_cents, entry.currency),
  };
}
