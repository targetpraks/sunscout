import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cooldownRemainingMs, hasLowConfidence, isRateDisabled } from "./api";
import { AccuracyWidget } from "./AccuracyWidget";
import type { ConditionAccuracy } from "./types";

const NOW = Date.parse("2026-09-13T12:00:00.000Z");

function condition(
  condition: ConditionAccuracy["condition"],
  score: number | null,
  overrides: Partial<ConditionAccuracy> = {},
): ConditionAccuracy {
  return {
    condition,
    score,
    sampleSize: 4,
    lastRatedAt: "2026-09-13T10:00:00.000Z",
    yourLastRatedAt: null,
    ...overrides,
  };
}

describe("hasLowConfidence", () => {
  it("flags conditions scoring below 0.6", () => {
    const low = hasLowConfidence([
      condition("crowd", 0.5),
      condition("wind", 0.9),
    ]);
    expect(low.map((item) => item.condition)).toEqual(["crowd"]);
  });

  it("never flags null scores (insufficient sample) or healthy scores", () => {
    expect(
      hasLowConfidence([
        condition("crowd", null, { sampleSize: 1 }),
        condition("wave", 0.6),
        condition("tide", 1),
      ]),
    ).toEqual([]);
  });
});

describe("cooldown helpers", () => {
  it("is disabled inside the 24h window and clear after it", () => {
    const fiveHoursAgo = "2026-09-13T07:00:00.000Z";
    const twentyFiveHoursAgo = "2026-09-12T11:00:00.000Z";
    expect(isRateDisabled(fiveHoursAgo, NOW)).toBe(true);
    expect(isRateDisabled(twentyFiveHoursAgo, NOW)).toBe(false);
    expect(isRateDisabled(null, NOW)).toBe(false);
  });

  it("reports the remaining milliseconds of the window", () => {
    const fiveHoursAgo = "2026-09-13T07:00:00.000Z";
    expect(cooldownRemainingMs(fiveHoursAgo, NOW)).toBe(19 * 3_600_000);
    expect(cooldownRemainingMs(null, NOW)).toBe(0);
  });

  it("tolerates a malformed timestamp without locking the UI", () => {
    expect(isRateDisabled("not-a-date", NOW)).toBe(false);
  });
});

describe("AccuracyWidget", () => {
  const accuracy = (conditions: ConditionAccuracy[]) => ({
    beachId: "praia-da-coelha",
    conditions,
  });

  const render = (props: Parameters<typeof AccuracyWidget>[0]) =>
    renderToStaticMarkup(createElement(AccuracyWidget, props));

  it("shows the confidence badge when any condition score is below 0.6", () => {
    const html = render({
      accuracy: accuracy([condition("crowd", 0.42), condition("wind", 0.9)]),
      now: NOW,
      onRate: () => {},
    });
    expect(html).toContain("Data confidence: low");
    expect(html).toContain("Crowd");
  });

  it("does not show the badge when scores are healthy or null", () => {
    const healthy = render({
      accuracy: accuracy([condition("crowd", 0.75), condition("wave", 0.61)]),
      now: NOW,
    });
    expect(healthy).not.toContain("Data confidence: low");

    const insufficient = render({
      accuracy: accuracy([condition("tide", null, { sampleSize: 1 })]),
      now: NOW,
    });
    expect(insufficient).toContain("accuracy__hint");
    expect(insufficient).not.toContain("Data confidence: low");
  });

  it("disables re-rating for conditions inside the cooldown", () => {
    const html = render({
      accuracy: accuracy([
        condition("crowd", 0.5, {
          yourLastRatedAt: "2026-09-13T07:00:00.000Z",
        }),
        condition("wind", 0.5, {
          yourLastRatedAt: "2026-09-12T07:00:00.000Z",
        }),
      ]),
      now: NOW,
      onRate: () => {},
    });
    const rows = html.split('class="accuracy__row"');
    expect(rows).toHaveLength(7); // 6 condition rows + leading fragment
    // crowd (rated 5h ago) has both buttons disabled; every other row is enabled
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it("renders loading, error, and empty states", () => {
    expect(render({ accuracy: null, loading: true })).toContain(
      "Checking data confidence",
    );
    expect(render({ accuracy: null, error: "api_500" })).toContain(
      "Data confidence unavailable",
    );
    expect(render({ accuracy: accuracy([]), now: NOW })).toContain(
      "No accuracy ratings yet",
    );
  });
});
