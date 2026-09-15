import { useState } from "react";
import { CircleAlert, Info, X } from "lucide-react";
import { cancelBooking } from "./api";
import {
  computeCancelPreview,
  formatMoney,
  formatBookingWhen,
  REFUND_POLICY_LINES,
  REFUND_TIER_LABELS,
  type CancelBookingResult,
  type MyBooking,
} from "./types";

/**
 * Cancel confirmation modal. Shows the refund preview — computed with the same
 * policy boundaries as the server — BEFORE the user confirms, so the cost of
 * cancelling is never a surprise. The server recomputes authoritatively on
 * confirm; the authoritative outcome is surfaced if it differs.
 */
export function CancelBookingModal({
  booking,
  onClose,
  onCancelled,
}: {
  booking: MyBooking;
  onClose: () => void;
  onCancelled: (result: CancelBookingResult, booking: MyBooking) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const preview = computeCancelPreview(booking.totalCents, booking.startsAt);

  const confirm = async () => {
    setSubmitting(true);
    setError("");
    try {
      const result = await cancelBooking(booking.id);
      onCancelled(result, booking);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message.replaceAll("_", " ")
          : "Could not cancel booking",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <style>{`
        .cbm-sheet { display: grid; gap: 12px; }
        .cbm-preview { border-radius: 12px; padding: 12px 14px; display: grid; gap: 6px; }
        .cbm-preview.full { background: rgba(46,139,107,0.1); }
        .cbm-preview.partial { background: rgba(232,163,61,0.14); }
        .cbm-preview.none { background: rgba(255,107,92,0.1); }
        .cbm-preview-row { display: flex; justify-content: space-between; align-items: baseline; }
        .cbm-preview-row strong { font-size: 17px; }
        .cbm-policy { display: grid; gap: 4px; color: #51616f; font-size: 12px; }
      `}</style>
      <section className="booking-sheet cbm-sheet">
        <div className="sheet-handle" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <span className="step-label">Cancel booking</span>
        <h2>{booking.beachName}</h2>
        <p className="muted">
          {formatBookingWhen(booking.startsAt, booking.endsAt)} ·{" "}
          {formatMoney(booking.totalCents, booking.currency)} paid
        </p>

        <div className={`cbm-preview ${preview.tier}`} role="status">
          <div className="cbm-preview-row">
            <span>If you cancel now</span>
            <strong>{REFUND_TIER_LABELS[preview.tier]}</strong>
          </div>
          <div className="cbm-preview-row">
            <span>Refunded</span>
            <strong>
              {formatMoney(preview.refundCents, booking.currency)}
            </strong>
          </div>
          <div className="cbm-preview-row">
            <span>Kept by the beach</span>
            <strong>
              {formatMoney(preview.forfeitCents, booking.currency)}
            </strong>
          </div>
        </div>

        <div className="cbm-policy">
          <span>
            <Info size={12} /> Refund policy
          </span>
          {REFUND_POLICY_LINES.map((line) => (
            <span key={line.tier}>· {line.text}</span>
          ))}
        </div>

        {error ? (
          <p className="form-error" role="alert">
            <CircleAlert size={14} /> {error}
          </p>
        ) : null}

        <button
          className="primary-button sheet-primary"
          disabled={submitting}
          onClick={() => void confirm()}
        >
          {submitting ? "Cancelling…" : "Confirm cancellation"}
        </button>
        <button className="text-button" onClick={onClose} disabled={submitting}>
          Keep my booking
        </button>
      </section>
    </div>
  );
}

export default CancelBookingModal;
