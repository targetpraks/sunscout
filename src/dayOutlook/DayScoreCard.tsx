import { Sun } from "lucide-react";
import { AlertBanner } from "../alerts/AlertBanner";
import { AlertRuleEditor } from "../alerts/AlertRuleEditor";
import {
  DAY_AUDIENCE_LABELS,
  DAY_TIER_LABELS,
  isStaleObservation,
  type DayScore,
} from "./types";

/**
 * Day Score card — the single "right beach right now" verdict for the
 * selected audience, with the per-audience breakdown that proves the
 * weighting. Pure presentational: takes the dayScore payload from
 * /api/conditions, fetches nothing, reads no clock. Reuses existing CSS
 * classes (detail-section / crowd-forecast / forecast-bar / chart-note /
 * alert-banner) — no new stylesheet is required by this feature.
 *
 * Honesty rule: when the condition row behind the score is stale (older
 * than the pulse threshold, or missing/unparsable), the card refuses to
 * show a number and says so instead — never present unverifiable data as
 * fresh.
 */
const TIER_COLORS: Record<string, string> = {
  go: "var(--green)",
  wait: "#e8a33d",
  skip: "var(--coral)",
};

export function DayScoreCard({ dayScore }: { dayScore: DayScore }) {
  if (isStaleObservation(dayScore)) {
    return (
      <div className="alert-banner" role="status" aria-label="Day Score stale">
        <Sun />
        <span>
          <strong>Day Score unavailable</strong>
          <small>
            Live condition data is stale, so we won&apos;t score today
            dishonestly. Conditions will refresh shortly.
          </small>
        </span>
      </div>
    );
  }

  const requested = dayScore.audienceScores.find(
    (entry) => entry.audience === dayScore.audience,
  );
  const lowConfidence = requested != null && requested.confidence < 0.5;

  return (
    <section className="detail-section" aria-label="Day Score">
      <div className="section-heading">
        <h2>Day Score</h2>
        <span style={{ color: TIER_COLORS[dayScore.tier], fontWeight: 700 }}>
          {DAY_TIER_LABELS[dayScore.tier]}
        </span>
      </div>
      <div
        className="crowd-forecast"
        style={{ height: "auto", alignItems: "center" }}
      >
        <span className="forecast-bar" style={{ flex: "0 0 auto" }}>
          <b
            aria-label={`Day Score ${dayScore.score} out of 100`}
            style={{ fontSize: 28, color: "var(--teal)" }}
          >
            {dayScore.score}
          </b>
        </span>
        <span
          className="forecast-bar"
          style={{
            flex: 1,
            textAlign: "left",
            fontSize: 12,
            color: "var(--driftwood)",
          }}
        >
          {lowConfidence
            ? "Low confidence — few live signals behind this score."
            : `For ${DAY_AUDIENCE_LABELS[dayScore.audience].toLowerCase()}`}
        </span>
      </div>
      <div
        className="suitability-rail"
        style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}
      >
        {dayScore.audienceScores.map((entry) => (
          <span
            key={entry.audience}
            className={`suitability-item ${entry.audience === dayScore.audience ? "party" : ""}`}
            style={{
              opacity: entry.audience === dayScore.audience ? 1 : 0.6,
            }}
            title={`${DAY_AUDIENCE_LABELS[entry.audience]}: ${entry.score} (${DAY_TIER_LABELS[entry.tier]})`}
          >
            <small style={{ fontSize: 10 }}>
              {DAY_AUDIENCE_LABELS[entry.audience]}
            </small>
            <b style={{ fontSize: 13, color: "var(--marine)" }}>
              {entry.score}
            </b>
          </span>
        ))}
      </div>
      {dayScore.activeEvents.length ? (
        <p className="chart-note">
          Bumping the crowd forecast: {dayScore.activeEvents.join(", ")}.
        </p>
      ) : null}
      {/* Personal condition alerts ("tell me before I go") ride the Day
          Score card: the banner shows triggered rules at or above the
          configured priority and the editor manages them. Both are
          self-sufficient and user-scoped, so no props flow from TidePanel
          or App — the card's { dayScore } signature is unchanged. */}
      <AlertBanner />
      <AlertRuleEditor />
    </section>
  );
}
