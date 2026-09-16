/**
 * Day Score + Crowd Forecast tests (node environment — no DOM deps).
 *
 * Covers the client-side acceptance criteria:
 *  - tier boundaries pinned to the same literals as server/dayQuality.ts
 *    (the suites are the drift guard for the deliberate client/server
 *    mirror; the src tree cannot import from server/, so both pin 70/45),
 *  - isStaleObservation honesty: server-flagged stale, missing and
 *    unparsable observedAt are all treated as stale,
 *  - DayScoreCard renders the score for fresh data and an honest stale
 *    state instead of a number for old/missing condition timestamps,
 *  - CrowdForecastStrip renders bars and event highlights, or its honest
 *    empty state.
 *
 * JSX is avoided (React.createElement) so this file is a plain .ts test
 * matching the vitest include glob.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CrowdForecastStrip } from "./CrowdForecastStrip";
import { DayScoreCard } from "./DayScoreCard";
import {
  DAY_TIER_GO_MIN,
  DAY_TIER_WAIT_MIN,
  isStaleObservation,
  tierFor,
  type DayScore,
} from "./types";

const NOW = Date.parse("2026-09-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function makeDayScore(overrides: Partial<DayScore> = {}): DayScore {
  const audiences = [
    "family",
    "friends",
    "solo",
    "couples",
    "party",
    "chill",
  ] as const;
  return {
    score: 82,
    tier: "go",
    audience: "family",
    audienceScores: audiences.map((audience, i) => ({
      audience,
      score: 80 - i * 5,
      tier: "go",
      confidence: 0.8,
      staleConditions: false,
      breakdown: {
        conditions: 70,
        community: 60,
        activity: 55,
        vibe: 50,
        freshness: 1,
        conditionFreshness: 1,
      },
    })),
    crowdForecast: [
      { hour: 12, crowd: 40, eventBoost: false },
      { hour: 13, crowd: 55, eventBoost: false },
      { hour: 14, crowd: 70, eventBoost: true },
    ],
    observedAt: hoursAgo(1),
    computedAt: "2026-09-15T12:00:00Z",
    stale: false,
    activeEvents: ["Sunset party"],
    ...overrides,
  };
}

describe("tier thresholds (drift guard with server/dayQuality.ts)", () => {
  it("pins the documented boundaries", () => {
    expect(DAY_TIER_GO_MIN).toBe(70);
    expect(DAY_TIER_WAIT_MIN).toBe(45);
  });

  it("maps scores to go/wait/skip at the documented boundaries", () => {
    expect(tierFor(100)).toBe("go");
    expect(tierFor(DAY_TIER_GO_MIN)).toBe("go");
    expect(tierFor(DAY_TIER_GO_MIN - 1)).toBe("wait");
    expect(tierFor(DAY_TIER_WAIT_MIN)).toBe("wait");
    expect(tierFor(DAY_TIER_WAIT_MIN - 1)).toBe("skip");
    expect(tierFor(0)).toBe("skip");
    // NaN and out-of-range clamp instead of crashing.
    expect(tierFor(Number.NaN)).toBe("skip");
    expect(tierFor(1000)).toBe("go");
    expect(tierFor(-5)).toBe("skip");
  });
});

describe("isStaleObservation (honesty guard)", () => {
  it("treats a server-flagged stale score as stale", () => {
    expect(
      isStaleObservation({
        stale: true,
        observedAt: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it("treats missing and unparsable observedAt as stale, never fresh", () => {
    expect(isStaleObservation({ stale: false, observedAt: null })).toBe(true);
    expect(isStaleObservation({ stale: false, observedAt: "" })).toBe(true);
    expect(isStaleObservation({ stale: false, observedAt: "nonsense" })).toBe(
      true,
    );
  });

  it("accepts a fresh, timestamped score", () => {
    expect(
      isStaleObservation({
        stale: false,
        observedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).toBe(false);
  });
});

describe("DayScoreCard", () => {
  it("renders the score, tier and per-audience breakdown for fresh data", () => {
    const html = renderToStaticMarkup(
      createElement(DayScoreCard, { dayScore: makeDayScore() }),
    );
    expect(html).toContain("Day Score");
    expect(html).toContain("82");
    expect(html).toContain("Go");
    expect(html).toContain("Families");
    expect(html).toContain("Sunset party");
  });

  it("renders an honest stale state instead of a number when conditions are old", () => {
    const html = renderToStaticMarkup(
      createElement(DayScoreCard, {
        dayScore: makeDayScore({
          stale: true,
          observedAt: hoursAgo(26),
        }),
      }),
    );
    expect(html).toContain("Day Score unavailable");
    expect(html).not.toContain("82");
  });

  it("renders the stale state when the timestamp is missing entirely", () => {
    const html = renderToStaticMarkup(
      createElement(DayScoreCard, {
        dayScore: makeDayScore({ observedAt: null }),
      }),
    );
    expect(html).toContain("Day Score unavailable");
    expect(html).not.toContain("82");
  });
});

describe("CrowdForecastStrip", () => {
  it("renders one bar per point with the crowd percentage and event highlight", () => {
    const html = renderToStaticMarkup(
      createElement(CrowdForecastStrip, {
        points: makeDayScore().crowdForecast,
      }),
    );
    expect(html).toContain("14:00");
    expect(html).toContain("70%");
    // The event-boosted hour is annotated for screen readers/mouse users.
    expect(html).toContain("an event is on at 14:00");
  });

  it("renders its honest empty state when there is no forecast", () => {
    const html = renderToStaticMarkup(
      createElement(CrowdForecastStrip, { points: [] }),
    );
    expect(html).toContain("No crowd forecast yet");
  });
});
