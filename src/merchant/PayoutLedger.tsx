import { Banknote } from "lucide-react";
import { formatLedgerDate } from "./types";
import { formatMoney } from "../bookings/types";
import type { PayoutEntry } from "./types";

/**
 * Payout history: one entry per settled settlement, newest first (the
 * server sorts them). There is no separate payout table, so the server
 * derives this from settled settlement rows — see
 * GET /api/merchant/settlements/ledger in server/routes/merchant.ts.
 */
export function PayoutLedger({ payouts }: { payouts: PayoutEntry[] }) {
  if (!payouts.length) {
    return (
      <p className="stl-empty">
        No payouts yet. Redeemed bookings become available for payout, then show
        up here once settled.
      </p>
    );
  }
  return (
    <ul className="stl-payouts">
      {payouts.map((payout) => (
        <li key={payout.settlement_public_id ?? payout.booking_public_id}>
          <span className="stl-payout-icon">
            <Banknote size={15} />
          </span>
          <span className="stl-payout-copy">
            <strong>{formatMoney(payout.net_cents, payout.currency)}</strong>
            <small>
              {payout.beach_name} · paid {formatLedgerDate(payout.settled_at)}
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default PayoutLedger;
