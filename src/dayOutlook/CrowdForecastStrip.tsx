import { Users } from "lucide-react";
import type { DayScoreCrowdPoint } from "./types";

/**
 * Crowd Forecast strip — the next N hourly crowd percentages from the
 * Day Score payload, highlighting hours elevated by an active published
 * event. Pure presentational: takes `points` from /api/conditions dayScore.
 * Empty state is honest ("no forecast yet") rather than fabricated bars.
 */
export function CrowdForecastStrip({
  points,
}: {
  points: DayScoreCrowdPoint[];
}) {
  if (!points.length) {
    return (
      <p className="chart-note" role="status">
        No crowd forecast yet for this beach.
      </p>
    );
  }

  return (
    <section className="detail-section" aria-label="Crowd forecast">
      <div className="section-heading">
        <span className="heading-group">
          <Users />
          <h2>Crowd forecast</h2>
        </span>
        <span>Next hours</span>
      </div>
      <div className="crowd-forecast">
        {points.map((point) => (
          <span
            className="forecast-bar"
            key={point.hour}
            title={
              point.eventBoost
                ? `Elevated: an event is on at ${point.hour}:00`
                : undefined
            }
          >
            <i
              style={{
                height: `${Math.max(4, point.crowd)}%`,
                ...(point.eventBoost
                  ? {
                      background:
                        "linear-gradient(var(--coral), rgba(255, 107, 92, 0.4))",
                    }
                  : {}),
              }}
            />
            <small>{point.hour}:00</small>
            <b>{point.crowd}%</b>
          </span>
        ))}
      </div>
      <p className="chart-note">
        Event hours show in coral — expect a busier beach then.
      </p>
    </section>
  );
}
