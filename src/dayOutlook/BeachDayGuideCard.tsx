import { isStaleObservation, type DayScore } from "./types";

/** Live-condition inputs the guide derives from. All optional + honest. */
export type DayGuideConditions = {
  goldenHour?: string | null;
  airTemp?: string | null;
  waterQuality?: string | null;
};

const TIME_RE = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;

const TIER_COLORS: Record<string, string> = {
  go: "var(--green)",
  wait: "#e8a33d",
  skip: "var(--coral)",
};

/**
 * Verdict copy derived 1:1 from the Day Score tier engine (go/wait/skip) —
 * the same tier DayScoreCard renders. Wording is pending Ricardo's sign-off
 * (flagged in the PR body + kanban evidence): edit these strings freely.
 */
const VERDICTS: Record<string, string> = {
  go: "Go now",
  wait: "Wait for it to improve",
  skip: "Skip the beach today",
};

function parseGoldenHourEnd(goldenHour?: string | null): string | null {
  if (!goldenHour) return null;
  const matches = [...goldenHour.matchAll(TIME_RE)].map(([time]) =>
    time.padStart(5, "0"),
  );
  return matches.length ? matches[matches.length - 1] : null;
}

function parseTempC(airTemp?: string | null): number | null {
  if (!airTemp) return null;
  const match = airTemp.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * Deterministic packing flags derived ONLY from live condition fields —
 * no invented product copy. Air temp comes from the beach row; the
 * water-quality flag matches the existing Today advisory logic. When no
 * rule fires, the card says so honestly instead of guessing. Wording is
 * pending Ricardo's sign-off (flagged in the PR body + kanban evidence).
 */
function bringList(airTempC: number | null, waterQuality?: string | null) {
  const list: string[] = [];
  if (airTempC != null && airTempC >= 28) list.push("Extra water — hot day");
  if (airTempC != null && airTempC <= 18) list.push("A warm layer — cool air");
  if (waterQuality === "Advisory" || waterQuality === "Closed") {
    list.push("Check the water-quality notice before swimming");
  }
  if (!list.length) {
    list.push("No packing flags from live data — beach basics apply");
  }
  return list;
}

/**
 * Beach Day Guide — the "go now, bring this, leave by" smart pack (PRD S2.3).
 * Pure presentational, same honesty rule as DayScoreCard: when the condition
 * row behind the score is stale, it refuses to guess and says so. Verdict
 * comes from the existing Day Score tier; "leave by" derives from the
 * golden-hour window (last good light); packing flags derive from live
 * condition fields only.
 */
export function BeachDayGuideCard({
  dayScore,
  conditions,
}: {
  dayScore: DayScore;
  conditions?: DayGuideConditions;
}) {
  if (isStaleObservation(dayScore)) {
    return (
      <section className="detail-section" aria-label="Beach Day Guide">
        <div className="section-heading">
          <h2>Beach Day Guide</h2>
        </div>
        <p className="chart-note" role="status">
          Live condition data is stale, so we won&apos;t guess a plan. The guide
          returns with the next conditions refresh.
        </p>
      </section>
    );
  }

  const verdict = VERDICTS[dayScore.tier] ?? dayScore.tier;
  const leaveBy = parseGoldenHourEnd(conditions?.goldenHour);
  const tempC = parseTempC(conditions?.airTemp);
  const bring = bringList(tempC, conditions?.waterQuality);

  return (
    <section className="detail-section" aria-label="Beach Day Guide">
      <div className="section-heading">
        <h2>Beach Day Guide</h2>
        <span style={{ color: TIER_COLORS[dayScore.tier], fontWeight: 700 }}>
          {verdict}
        </span>
      </div>
      <div
        className="crowd-forecast"
        style={{ height: "auto", alignItems: "center" }}
      >
        <span className="forecast-bar" style={{ flex: "0 0 auto" }}>
          <b
            aria-label={`Beach day score ${dayScore.score} out of 100`}
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
          {leaveBy
            ? `Leave by ~${leaveBy} — that's the last good light.`
            : "Leave-by needs golden-hour data — not available right now."}
        </span>
      </div>
      <ul className="chart-note" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
        {bring.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export default BeachDayGuideCard;
