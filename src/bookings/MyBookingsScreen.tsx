import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CircleAlert,
  Receipt,
  Ticket,
} from "lucide-react";
import { fetchMyBookings } from "./api";
import { CancelBookingModal } from "./CancelBookingModal";
import { BookingReceipt } from "./BookingReceipt";
import {
  computeCancelPreview,
  formatMoney,
  formatBookingWhen,
  isCancellable,
  partitionBookings,
  REFUND_TIER_LABELS,
  type CancelBookingResult,
  type MyBooking,
} from "./types";

/**
 * Self-service My Bookings screen: upcoming and past bookings for the
 * signed-in user. Upcoming confirmed bookings can be cancelled through the
 * cancel modal (refund preview before confirm); any booking can be viewed as
 * a print-friendly receipt. Styles are scoped inline because styles.css is
 * owned by the app shell, not this module.
 */
export function MyBookingsScreen({
  onBack,
  onToast,
}: {
  onBack: () => void;
  onToast: (message: string) => void;
}) {
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelTarget, setCancelTarget] = useState<MyBooking | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setBookings(await fetchMyBookings());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message.replaceAll("_", " ")
          : "Could not load bookings",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (receiptId) {
    return (
      <BookingReceipt
        bookingPublicId={receiptId}
        onBack={() => setReceiptId(null)}
      />
    );
  }

  const { upcoming, past } = partitionBookings(bookings);
  const now = new Date();

  const handleCancelled = (result: CancelBookingResult, booking: MyBooking) => {
    setBookings((current) =>
      current.map((item) =>
        item.id === booking.id ? { ...item, status: "cancelled" } : item,
      ),
    );
    setCancelTarget(null);
    onToast(
      result.refundAmount > 0
        ? `Booking cancelled · ${REFUND_TIER_LABELS[result.policy].toLowerCase()} · ${formatMoney(
            result.refundAmount,
            booking.currency,
          )}`
        : "Booking cancelled · no refund",
    );
    void load();
  };

  const renderBooking = (booking: MyBooking) => {
    const preview = computeCancelPreview(
      booking.totalCents,
      booking.startsAt,
      now,
    );
    return (
      <article className="bk-card" key={booking.id}>
        <span className="bk-card-icon">
          <Ticket />
        </span>
        <span className="bk-card-copy">
          <strong>{booking.beachName}</strong>
          <small>{formatBookingWhen(booking.startsAt, booking.endsAt)}</small>
          <small className="bk-card-items">
            {booking.items.length
              ? booking.items
                  .map((item) => `${item.quantity} ${item.type}`)
                  .join(" · ")
              : "—"}
          </small>
        </span>
        <span className="bk-card-side">
          <strong>{formatMoney(booking.totalCents, booking.currency)}</strong>
          <span
            className={`bk-status bk-status-${booking.status}`}
            data-status={booking.status}
          >
            {booking.status}
          </span>
        </span>
        <span className="bk-card-actions">
          <button
            className="bk-link"
            onClick={() => setReceiptId(booking.id)}
            aria-label={`View receipt for ${booking.beachName}`}
          >
            <Receipt size={15} /> Receipt
          </button>
          {isCancellable(booking) ? (
            <button
              className="bk-cancel"
              onClick={() => setCancelTarget(booking)}
              aria-label={`Cancel booking at ${booking.beachName}`}
            >
              Cancel · {REFUND_TIER_LABELS[preview.tier]}
            </button>
          ) : null}
        </span>
      </article>
    );
  };

  return (
    <div className="bk-screen">
      <style>{`
        .bk-screen { max-width: 430px; margin: 0 auto; min-height: 100dvh; background: var(--sand, #FAF6F0); }
        .bk-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
        .bk-header h1 { font-size: 20px; margin: 0; }
        .bk-content { padding: 0 16px 24px; }
        .bk-section-title { display: flex; align-items: center; gap: 6px; margin: 18px 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7c8c; }
        .bk-card { display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(15,30,46,0.06); flex-wrap: wrap; }
        .bk-card-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; background: rgba(10,110,120,0.1); color: #0A6E78; flex: none; }
        .bk-card-copy { flex: 1 1 140px; display: grid; gap: 2px; min-width: 0; }
        .bk-card-copy strong { font-size: 15px; }
        .bk-card-copy small { color: #6b7c8c; font-size: 12px; }
        .bk-card-side { display: grid; gap: 2px; justify-items: end; }
        .bk-status { font-size: 11px; padding: 2px 8px; border-radius: 999px; text-transform: capitalize; }
        .bk-status-confirmed { background: rgba(46,139,107,0.14); color: #2E8B6B; }
        .bk-status-cancelled { background: rgba(255,107,92,0.14); color: #c04b40; }
        .bk-status-redeemed { background: rgba(10,110,120,0.12); color: #0A6E78; }
        .bk-status-pending, .bk-status-no_show, .bk-status-refunded { background: #eef1f4; color: #51616f; }
        .bk-card-actions { display: flex; gap: 8px; width: 100%; justify-content: flex-end; }
        .bk-link { display: inline-flex; align-items: center; gap: 4px; background: none; border: none; color: #0A6E78; font-weight: 600; font-size: 13px; cursor: pointer; padding: 6px 8px; border-radius: 8px; }
        .bk-cancel { background: rgba(255,107,92,0.1); border: none; color: #c04b40; font-weight: 600; font-size: 13px; cursor: pointer; padding: 6px 10px; border-radius: 8px; }
        .bk-empty { text-align: center; color: #51616f; padding: 32px 12px; }
        .bk-error { display: flex; gap: 8px; align-items: center; color: #c04b40; background: rgba(255,107,92,0.08); border-radius: 10px; padding: 10px 12px; margin: 12px 0; }
      `}</style>
      <header className="bk-header">
        <button className="icon-button" onClick={onBack} aria-label="Go back">
          <ArrowLeft />
        </button>
        <h1>My bookings</h1>
      </header>
      <main className="bk-content">
        {loading ? (
          <p className="bk-empty">Loading your bookings…</p>
        ) : error ? (
          <div className="bk-error" role="alert">
            <CircleAlert size={16} />
            <span>
              {error}{" "}
              <button className="bk-link" onClick={() => void load()}>
                Try again
              </button>
            </span>
          </div>
        ) : bookings.length === 0 ? (
          <div className="bk-empty">
            <h2>No bookings yet</h2>
            <p>Reserve sunbeds or umbrellas and they will show up here.</p>
          </div>
        ) : (
          <>
            <div className="bk-section-title">
              <CalendarDays size={14} /> Upcoming
            </div>
            {upcoming.length ? (
              upcoming.map(renderBooking)
            ) : (
              <p className="bk-empty">Nothing upcoming.</p>
            )}
            <div className="bk-section-title">
              <CalendarDays size={14} /> Past
            </div>
            {past.length ? (
              past.map(renderBooking)
            ) : (
              <p className="bk-empty">No past bookings.</p>
            )}
          </>
        )}
      </main>
      {cancelTarget ? (
        <CancelBookingModal
          booking={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={handleCancelled}
        />
      ) : null}
    </div>
  );
}

export default MyBookingsScreen;
