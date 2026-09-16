import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CircleAlert, Clock, Landmark, Wallet } from "lucide-react";
import { fetchMerchantProfiles, fetchSettlementLedger } from "./api";
import { PayoutLedger } from "./PayoutLedger";
import { TransactionRow } from "./TransactionRow";
import { formatMoney } from "../bookings/types";
import type { SettlementLedgerResponse } from "./types";

/**
 * Merchant settlement dashboard (B2B payouts surface): the available-for-
 * payout balance with in-progress and paid figures, the booked/redeemed/
 * settled transaction ledger, and the payout history. Mounted from
 * MyBookingsScreen for merchant users only — the caller gates on merchant
 * profiles before rendering this, so this component always assumes a
 * merchant. Styles are scoped inline (stl- prefix) matching the bk- pattern
 * the bookings module uses, because styles.css is owned by the app shell.
 */
export function SettlementDashboard({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<SettlementLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchSettlementLedger());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message.replaceAll("_", " ")
          : "Could not load settlements",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Currency follows the ledger's own rows (booking.currency defaults to
  // EUR); the fallback covers an empty ledger where there is no row to ask.
  const currency = data?.ledger[0]?.currency ?? "EUR";

  return (
    <div className="stl-screen">
      <style>{`
        .stl-screen { max-width: 430px; margin: 0 auto; min-height: 100dvh; background: var(--sand, #FAF6F0); }
        .stl-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
        .stl-header h1 { font-size: 20px; margin: 0; }
        .stl-content { padding: 0 16px 24px; }
        .stl-section-title { display: flex; align-items: center; gap: 6px; margin: 18px 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7c8c; }
        .stl-balance { background: #0F1E2E; color: #FAF6F0; border-radius: 16px; padding: 16px; margin-bottom: 12px; }
        .stl-balance-label { display: flex; align-items: center; gap: 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(250,246,240,0.65); }
        .stl-balance-amount { font-size: 30px; font-weight: 700; margin-top: 4px; }
        .stl-balance-sub { display: flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; }
        .stl-balance-sub span { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: rgba(250,246,240,0.8); }
        .stl-row { display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(15,30,46,0.06); }
        .stl-row-main { flex: 1; display: grid; gap: 2px; min-width: 0; }
        .stl-row-main strong { font-size: 15px; }
        .stl-row-main small { color: #6b7c8c; font-size: 12px; }
        .stl-row-money { display: grid; gap: 2px; justify-items: end; }
        .stl-gross { font-size: 14px; font-weight: 600; }
        .stl-row-money small { color: #6b7c8c; font-size: 11px; }
        .stl-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; flex: none; }
        .stl-badge-booked { background: #eef1f4; color: #51616f; }
        .stl-badge-redeemed { background: rgba(255,107,92,0.12); color: #c04b40; }
        .stl-badge-settled { background: rgba(46,139,107,0.14); color: #2E8B6B; }
        .stl-payouts { list-style: none; margin: 0; padding: 0; }
        .stl-payouts li { display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(15,30,46,0.06); }
        .stl-payout-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: rgba(46,139,107,0.12); color: #2E8B6B; flex: none; }
        .stl-payout-copy { display: grid; gap: 2px; }
        .stl-payout-copy strong { font-size: 14px; }
        .stl-payout-copy small { color: #6b7c8c; font-size: 12px; }
        .stl-empty { text-align: center; color: #51616f; padding: 32px 12px; }
        .stl-error { display: flex; gap: 8px; align-items: center; color: #c04b40; background: rgba(255,107,92,0.08); border-radius: 10px; padding: 10px 12px; margin: 12px 0; }
      `}</style>
      <header className="stl-header">
        <button className="icon-button" onClick={onBack} aria-label="Go back">
          <ArrowLeft />
        </button>
        <h1>Settlements</h1>
      </header>
      <main className="stl-content">
        {loading ? (
          <p className="stl-empty">Loading your settlements…</p>
        ) : error ? (
          <div className="stl-error" role="alert">
            <CircleAlert size={16} />
            <span>
              {error}{" "}
              <button className="bk-link" onClick={() => void load()}>
                Try again
              </button>
            </span>
          </div>
        ) : !data ? null : (
          <>
            <section className="stl-balance">
              <span className="stl-balance-label">
                <Wallet size={13} /> Available for payout
              </span>
              <div className="stl-balance-amount">
                {formatMoney(data.balance.availableCents, currency)}
              </div>
              <div className="stl-balance-sub">
                <span>
                  <Clock size={13} />
                  {formatMoney(data.balance.inProgressCents, currency)} booked
                </span>
                <span>
                  <Landmark size={13} />
                  {formatMoney(data.balance.paidCents, currency)} paid out
                </span>
              </div>
            </section>
            <div className="stl-section-title">Transactions</div>
            {data.ledger.length ? (
              data.ledger.map((entry) => (
                <TransactionRow key={entry.booking_public_id} entry={entry} />
              ))
            ) : (
              <p className="stl-empty">
                No bookings yet. Sunbed and umbrella reservations appear here as
                they are booked, redeemed and settled.
              </p>
            )}
            <div className="stl-section-title">Payout history</div>
            <PayoutLedger payouts={data.payouts} />
          </>
        )}
      </main>
    </div>
  );
}

export default SettlementDashboard;

/**
 * Silent merchant gate for MyBookingsScreen: resolves true when the signed-in
 * user owns at least one merchant. Any failure (network, 401, unexpected
 * shape) resolves false — a non-merchant must see the bookings surface
 * unchanged, never an error state.
 */
export async function isMerchantUser(): Promise<boolean> {
  try {
    return (await fetchMerchantProfiles()).length > 0;
  } catch {
    return false;
  }
}
