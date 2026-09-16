import { useCallback, useEffect, useState } from "react";
import { Info, Star } from "lucide-react";
import {
  ACCURACY_CONDITIONS,
  ACCURACY_CONDITION_LABELS,
  applyRatingToSignal,
  emptyAccuracySignal,
  entryFor,
  metaLine,
  type AccuracyCondition,
  type AccuracySignal,
} from "./types";
import { fetchAccuracySignal, submitAccuracyRating } from "./api";

const RATING_STARS = [1, 2, 3, 4, 5] as const;

/**
 * Rate-the-data panel: one 1-5 star row per live condition (crowd, water
 * quality, wind, temperature, cloud cover) plus the aggregated accuracy
 * signal for the beach. Submitting persists via ./api and the aggregate
 * refreshes in place — no page reload.
 */
export function AccuracyPanel({ beachId }: { beachId: string }) {
  const [signal, setSignal] = useState<AccuracySignal>(emptyAccuracySignal());
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [pending, setPending] = useState<AccuracyCondition | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await fetchAccuracySignal(beachId);
      setSignal(next);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [beachId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rate = async (condition: AccuracyCondition, rating: number) => {
    if (pending) return;
    const current = signal;
    setSubmitFailed(false);
    setSignal(applyRatingToSignal(current, condition, rating));
    setPending(condition);
    try {
      const next = await submitAccuracyRating(beachId, condition, rating);
      setSignal(next);
    } catch {
      setSignal(current);
      setSubmitFailed(true);
    } finally {
      setPending(null);
    }
  };

  if (status === "loading") {
    return (
      <section
        className="accuracy-vote"
        aria-label="Loading condition accuracy ratings"
      >
        <p className="muted">Loading accuracy ratings…</p>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section
        className="accuracy-vote"
        aria-label="Condition accuracy ratings unavailable"
      >
        <p className="muted">Couldn't load accuracy ratings.</p>
        <button className="text-button" onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="accuracy-vote" aria-label="Rate the live conditions">
      <div className="section-heading compact-heading">
        <h2>How accurate is this data?</h2>
        <Info aria-label="Your ratings improve conditions for everyone" />
      </div>
      {signal.state === "empty" ? (
        <p className="muted">
          No ratings yet for this beach — yours will be the first.
        </p>
      ) : (
        <p className="muted">
          {signal.totalRatings}{" "}
          {signal.totalRatings === 1 ? "rating" : "ratings"} from people
          checking this beach.
        </p>
      )}
      {submitFailed ? (
        <p className="muted">That rating didn't save — please try again.</p>
      ) : null}
      <div className="accuracy-list">
        {ACCURACY_CONDITIONS.map((condition) => {
          const entry = entryFor(signal, condition);
          const label = ACCURACY_CONDITION_LABELS[condition];
          return (
            <span className="accuracy-item" key={condition}>
              <small>{label}</small>
              {RATING_STARS.map((star) => (
                <button
                  key={star}
                  onClick={() => void rate(condition, star)}
                  disabled={pending !== null}
                  aria-label={`Rate ${label} ${star} out of 5`}
                  className={
                    star <= Math.round(entry.averageRating ?? 0) ? "active" : ""
                  }
                >
                  <Star size={15} />
                </button>
              ))}
              <small>{metaLine(entry)}</small>
            </span>
          );
        })}
      </div>
    </section>
  );
}
