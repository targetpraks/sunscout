import { useCallback, useEffect, useState } from "react";
import {
  fetchBeachAccuracy,
  hasLowConfidence,
  isRateDisabled,
  submitAccuracyRating,
} from "./api";
import {
  ACCURACY_CONDITIONS,
  type AccuracyCondition,
  type BeachAccuracy,
} from "./types";

const CONDITION_LABELS: Record<AccuracyCondition, string> = {
  crowd: "Crowd",
  waterQuality: "Water quality",
  wind: "Wind",
  wave: "Wave",
  tide: "Tide",
  temperature: "Temperature",
};

function describeScore(score: number | null): string {
  return score == null ? "—" : `${Math.round(score * 100)}%`;
}

export type AccuracyWidgetProps = {
  accuracy: BeachAccuracy | null;
  loading?: boolean;
  error?: string | null;
  /** Injected clock (Date.now()) so cooldown rendering is testable. */
  now?: number;
  onRate?: (condition: AccuracyCondition, rating: number) => void;
};

/**
 * Presentational data-confidence surface for a beach's live conditions.
 * Shows a low-confidence badge whenever any per-condition aggregate score
 * drops below 0.6 (a null score means "not enough ratings" and never
 * triggers the badge), and lets the user rate each condition's accuracy
 * with a 24h per-condition cooldown.
 */
export function AccuracyWidget({
  accuracy,
  loading = false,
  error = null,
  now,
  onRate,
}: AccuracyWidgetProps) {
  const at = now ?? Date.now();

  if (loading) {
    return (
      <div className="accuracy accuracy--loading" aria-busy="true">
        Checking data confidence…
      </div>
    );
  }
  if (error) {
    return (
      <div className="accuracy accuracy--error" role="status">
        Data confidence unavailable
      </div>
    );
  }
  if (!accuracy) return null;

  const conditions = accuracy.conditions ?? [];
  const rated = conditions.filter((item) => item.sampleSize > 0);
  const low = hasLowConfidence(conditions);
  return (
    <div className="accuracy">
      {low.length > 0 && (
        <div className="accuracy__badge" role="status">
          Data confidence: low —{" "}
          {low.map((item) => CONDITION_LABELS[item.condition]).join(", ")}
        </div>
      )}
      {rated.length === 0 && (
        <p className="accuracy__empty">
          No accuracy ratings yet — rate the conditions you can see.
        </p>
      )}
      <ul className="accuracy__list">
        {ACCURACY_CONDITIONS.map((condition) => {
          const entry = conditions.find((item) => item.condition === condition);
          const label = CONDITION_LABELS[condition];
          const cooldownActive = isRateDisabled(
            entry?.yourLastRatedAt ?? null,
            at,
          );
          return (
            <li className="accuracy__row" key={condition}>
              <span className="accuracy__label">{label}</span>
              <span className="accuracy__score">
                {describeScore(entry?.score ?? null)}
                {entry && entry.sampleSize > 0 ? ` (${entry.sampleSize})` : ""}
              </span>
              {onRate && (
                <span className="accuracy__rate">
                  <button
                    type="button"
                    disabled={cooldownActive}
                    aria-label={`Rate ${label} reading as accurate`}
                    onClick={() => onRate(condition, 1)}
                  >
                    Accurate
                  </button>
                  <button
                    type="button"
                    disabled={cooldownActive}
                    aria-label={`Rate ${label} reading as inaccurate`}
                    onClick={() => onRate(condition, 0)}
                  >
                    Off
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {low.length === 0 && (
        <p className="accuracy__hint">
          Rate what you see — ratings keep the live data honest.
        </p>
      )}
    </div>
  );
}

/**
 * Container that loads a beach's accuracy summary and wires the rating
 * actions. Renders the presentational AccuracyWidget with loading,
 * error, and refreshed states.
 */
export default function AccuracyWidgetSection({
  beachId,
}: {
  beachId: string;
}) {
  const [accuracy, setAccuracy] = useState<BeachAccuracy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await fetchBeachAccuracy(beachId);
    if (!data) {
      setError("accuracy_unavailable");
    } else {
      setAccuracy(data);
    }
    setLoading(false);
  }, [beachId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRate = useCallback(
    async (condition: AccuracyCondition, rating: number) => {
      try {
        const result = await submitAccuracyRating({
          beachId,
          condition,
          rating,
        });
        setAccuracy({ beachId, conditions: result.data.conditions });
        setNow(Date.now());
      } catch {
        setError("rating_failed");
      }
    },
    [beachId],
  );

  return (
    <AccuracyWidget
      accuracy={accuracy}
      loading={loading}
      error={error}
      now={now}
      onRate={handleRate}
    />
  );
}
