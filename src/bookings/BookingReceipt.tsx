import { useEffect, useState } from "react";
import { ArrowLeft, CircleAlert, Pencil, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { fetchBookingReceipt } from "./api";
import { CompanionRow, companionChipStyles } from "../profile/CompanionRow";
import { CompanionsEditor } from "../profile/CompanionsEditor";
import { fetchBookingCompanions } from "../profile/api";
import { type Companion } from "../profile/types";
import {
  formatMoney,
  REFUND_TIER_LABELS,
  type BookingReceipt as BookingReceiptData,
} from "./types";

/**
 * Print-friendly booking receipt: booking details, line items, merchant
 * info, cancellation outcome when present, the signed QR redemption
 * token, and the "Who's coming" companion chips with an editor to change
 * them. Companion loading is deliberately non-fatal — if the companions
 * request fails the receipt still renders. Print rules are scoped inline
 * (styles.css is owned by the app shell) using the visibility technique so
 * only the receipt prints.
 */
export function BookingReceipt({
  bookingPublicId,
  onBack,
}: {
  bookingPublicId: string;
  onBack: () => void;
}) {
  const [receipt, setReceipt] = useState<BookingReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [companionsLoading, setCompanionsLoading] = useState(true);
  const [editingCompanions, setEditingCompanions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchBookingReceipt(bookingPublicId)
      .then((data) => {
        if (!cancelled) setReceipt(data);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message.replaceAll("_", " ")
              : "Could not load receipt",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Non-fatal: chips are supplementary receipt detail, so a failure here
    // (including a 404 on an older deployment without the companions API)
    // leaves the receipt intact and hides the section.
    fetchBookingCompanions(bookingPublicId)
      .then((data) => {
        if (!cancelled) setCompanions(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCompanionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingPublicId]);

  return (
    <div className="bk-screen">
      <style>{`
        .bk-receipt { background: #fff; border-radius: 14px; padding: 20px; margin: 12px 16px; box-shadow: 0 1px 3px rgba(15,30,46,0.06); color: #0F1E2E; }
        .bk-receipt-head { display: grid; gap: 2px; border-bottom: 2px solid #0F1E2E; padding-bottom: 10px; margin-bottom: 12px; }
        .bk-receipt-head h2 { margin: 0; font-size: 18px; }
        .bk-receipt-kicker { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #0A6E78; font-weight: 700; }
        .bk-receipt-rows { display: grid; gap: 6px; margin-bottom: 12px; }
        .bk-receipt-row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
        .bk-receipt-row span:first-child { color: #51616f; }
        .bk-receipt-items { border-top: 1px dashed #c9d3db; padding-top: 10px; margin-bottom: 10px; display: grid; gap: 6px; }
        .bk-receipt-total { display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; border-top: 2px solid #0F1E2E; padding-top: 10px; }
        .bk-receipt-cancel { background: rgba(255,107,92,0.08); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; display: grid; gap: 4px; font-size: 13px; }
        .bk-receipt-qr { display: grid; justify-items: center; gap: 8px; padding: 12px 0 4px; }
        .bk-receipt-qr small { color: #51616f; text-align: center; max-width: 260px; }
        .bk-receipt-actions { display: flex; gap: 10px; padding: 0 16px 24px; }
        .bk-receipt-companions { border-top: 1px dashed #c9d3db; margin-top: 10px; padding-top: 10px; }
        .bk-receipt-companions-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .bk-receipt-companions-head h3 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #0A6E78; }
        .bk-receipt-companions-edit { display: inline-flex; align-items: center; gap: 4px; background: none; border: none; color: #0A6E78; font-weight: 600; font-size: 13px; cursor: pointer; padding: 4px 8px; border-radius: 8px; }
        @media print {
          body * { visibility: hidden; }
          .bk-receipt, .bk-receipt * { visibility: visible; }
          .bk-receipt { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; margin: 0; border-radius: 0; }
          .bk-receipt-actions, .bk-header { display: none !important; }
        }
      `}</style>
      <style>{companionChipStyles()}</style>
      <header className="bk-header">
        <button className="icon-button" onClick={onBack} aria-label="Go back">
          <ArrowLeft />
        </button>
        <h1>Receipt</h1>
      </header>
      {loading ? (
        <p className="bk-empty">Loading receipt…</p>
      ) : error ? (
        <div className="bk-error" role="alert">
          <CircleAlert size={16} />
          <span>{error}</span>
        </div>
      ) : receipt ? (
        <main>
          <article className="bk-receipt">
            <div className="bk-receipt-head">
              <span className="bk-receipt-kicker">
                SunScout booking receipt
              </span>
              <h2>{receipt.beach.name}</h2>
              <small>{receipt.merchant.businessName}</small>
            </div>
            <div className="bk-receipt-rows">
              <div className="bk-receipt-row">
                <span>Booking</span>
                <span>#{receipt.publicId.slice(0, 8)}</span>
              </div>
              <div className="bk-receipt-row">
                <span>When</span>
                <span>
                  {new Date(receipt.startsAt).toLocaleString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  –{" "}
                  {new Date(receipt.endsAt).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="bk-receipt-row">
                <span>Status</span>
                <span>{receipt.status}</span>
              </div>
              <div className="bk-receipt-row">
                <span>Booked on</span>
                <span>
                  {new Date(receipt.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>
            <div className="bk-receipt-items">
              {receipt.items.map((item) => (
                <div className="bk-receipt-row" key={item.type}>
                  <span>
                    {item.quantity} × {item.type}
                  </span>
                  <span>
                    {formatMoney(
                      item.quantity * item.unitPriceCents,
                      receipt.currency,
                    )}
                  </span>
                </div>
              ))}
              {!receipt.items.length ? (
                <div className="bk-receipt-row">
                  <span>No line items</span>
                  <span>—</span>
                </div>
              ) : null}
            </div>
            {receipt.cancellation ? (
              <div className="bk-receipt-cancel">
                <strong>
                  Cancelled · {REFUND_TIER_LABELS[receipt.cancellation.tier]}
                </strong>
                <span>
                  Refunded{" "}
                  {formatMoney(
                    receipt.cancellation.refundCents,
                    receipt.currency,
                  )}{" "}
                  · forfeited{" "}
                  {formatMoney(
                    receipt.cancellation.forfeitCents,
                    receipt.currency,
                  )}
                </span>
                <small>
                  Cancelled{" "}
                  {new Date(receipt.cancellation.cancelledAt).toLocaleString(
                    "en-GB",
                    {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}
                </small>
              </div>
            ) : null}
            <div className="bk-receipt-total">
              <span>Total paid</span>
              <span>{formatMoney(receipt.totalCents, receipt.currency)}</span>
            </div>
            <div className="bk-receipt-qr">
              <QRCodeSVG
                value={receipt.qrToken}
                size={136}
                bgColor="#FFFFFF"
                fgColor="#0F1E2E"
              />
              <small>
                Show this signed pass to the merchant at check-in — it is
                verified on redemption.
              </small>
            </div>
            <div className="bk-receipt-companions">
              <div className="bk-receipt-companions-head">
                <h3>Who's coming</h3>
                <button
                  className="bk-receipt-companions-edit"
                  onClick={() => setEditingCompanions(true)}
                  type="button"
                >
                  <Pencil size={13} /> Edit
                </button>
              </div>
              {companionsLoading ? (
                <p className="pf-chip-empty">Loading companions…</p>
              ) : companions.length ? (
                <div className="pf-chip-list">
                  {companions.map((companion) => (
                    <CompanionRow
                      companion={companion}
                      key={companion.publicId}
                    />
                  ))}
                </div>
              ) : (
                <p className="pf-chip-empty">
                  No one attached yet — tap Edit to add companions.
                </p>
              )}
            </div>
          </article>
          <div className="bk-receipt-actions">
            <button className="secondary-button" onClick={onBack}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="primary-button" onClick={() => window.print()}>
              <Printer size={16} /> Print receipt
            </button>
          </div>
        </main>
      ) : null}
      {editingCompanions ? (
        <CompanionsEditor
          bookingPublicId={bookingPublicId}
          attachedCompanions={companions}
          onClose={() => setEditingCompanions(false)}
          onSaved={(saved) => {
            setCompanions(saved);
            setEditingCompanions(false);
          }}
        />
      ) : null}
    </div>
  );
}

export default BookingReceipt;
