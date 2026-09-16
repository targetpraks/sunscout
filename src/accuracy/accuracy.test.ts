import { describe, expect, it } from "vitest";
import {
  ACCURACY_CONDITIONS,
  ACCURACY_CONDITION_LABELS,
  ACCURATE_RATING_THRESHOLD,
  applyRatingToSignal,
  emptyAccuracySignal,
  entryFor,
  metaLine,
} from "./types";

/**
 * Pure-logic tests for the front-end half of the condition-accuracy loop.
 * The vitest environment is node (no jsdom), so the panel's React wiring is
 * exercised by its state functions, not DOM rendering.
 *
 * KEEP IN SYNC with server/accuracy.test.ts — both suites assert the same
 * canonical constants and fixtures so the two deliberate copies of the
 * accuracy contract cannot drift.
 */

describe("canonical accuracy contract (mirror of server/accuracy)", () => {
  it("fixes the five ratable conditions in canonical order", () => {
    expect([...ACCURACY_CONDITIONS]).toEqual([
      "crowd",
      "water_quality",
      "wind",
      "temperature",
      "cloud_cover",
    ]);
  });

  it("labels every condition and treats ratings at or above 4 as accurate", () => {
    for (const condition of ACCURACY_CONDITIONS) {
      expect(ACCURACY_CONDITION_LABELS[condition].length).toBeGreaterThan(0);
    }
    expect(ACCURATE_RATING_THRESHOLD).toBe(4);
  });
});

describe("emptyAccuracySignal — honest degraded state", () => {
  it("reports every condition with zero ratings and null aggregates", () => {
    const signal = emptyAccuracySignal();
    expect(signal.state).toBe("empty");
    expect(signal.totalRatings).toBe(0);
    expect(signal.signal).toHaveLength(5);
    for (const entry of signal.signal) {
      expect(entry.ratingCount).toBe(0);
      expect(entry.averageRating).toBeNull();
      expect(entry.accuratePercent).toBeNull();
    }
  });
});

describe("applyRatingToSignal — optimistic display merge", () => {
  it("populates a condition from the first rating", () => {
    const next = applyRatingToSignal(emptyAccuracySignal(), "wind", 5);
    expect(next.state).toBe("ok");
    expect(next.totalRatings).toBe(1);
    const wind = entryFor(next, "wind");
    expect(wind.ratingCount).toBe(1);
    expect(wind.averageRating).toBe(5);
    expect(wind.accuratePercent).toBe(100);
    // Untouched conditions keep their honest zeroed shape.
    const crowd = entryFor(next, "crowd");
    expect(crowd.ratingCount).toBe(0);
    expect(crowd.averageRating).toBeNull();
  });

  it("marks a first below-threshold rating as 0% accurate, not null", () => {
    const next = applyRatingToSignal(emptyAccuracySignal(), "crowd", 1);
    const crowd = entryFor(next, "crowd");
    expect(crowd.averageRating).toBe(1);
    expect(crowd.accuratePercent).toBe(0);
  });

  it("blends a new rating into the existing mean and accurate share", () => {
    // 2 ratings averaging 3.5 with 50% accurate, then a 5 arrives:
    // mean -> (3.5*2 + 5)/3 = 4, accurate -> 2 of 3 = 67%.
    const base = {
      state: "ok" as const,
      totalRatings: 2,
      signal: [
        {
          condition: "crowd" as const,
          ratingCount: 2,
          averageRating: 3.5,
          accuratePercent: 50,
        },
      ],
    };
    const next = applyRatingToSignal(base, "crowd", 5);
    expect(next.totalRatings).toBe(3);
    const crowd = entryFor(next, "crowd");
    expect(crowd.ratingCount).toBe(3);
    expect(crowd.averageRating).toBe(4);
    expect(crowd.accuratePercent).toBe(67);
  });

  it("ignores out-of-range or non-integer ratings", () => {
    const signal = emptyAccuracySignal();
    expect(applyRatingToSignal(signal, "wind", 0)).toEqual(signal);
    expect(applyRatingToSignal(signal, "wind", 6)).toEqual(signal);
    expect(applyRatingToSignal(signal, "wind", 3.5)).toEqual(signal);
  });
});

describe("entryFor / metaLine", () => {
  it("falls back to the honest zeroed entry for a missing condition", () => {
    const entry = entryFor(emptyAccuracySignal(), "cloud_cover");
    expect(entry).toEqual({
      condition: "cloud_cover",
      ratingCount: 0,
      averageRating: null,
      accuratePercent: null,
    });
  });

  it("describes an unrated condition without inventing a score", () => {
    expect(metaLine(entryFor(emptyAccuracySignal(), "wind"))).toBe(
      "Not rated yet",
    );
  });

  it("describes an aggregate compactly", () => {
    expect(
      metaLine({
        condition: "wind",
        ratingCount: 3,
        averageRating: 3.67,
        accuratePercent: 67,
      }),
    ).toBe("3.7 avg · 67% accurate · 3 ratings");
    expect(
      metaLine({
        condition: "wind",
        ratingCount: 1,
        averageRating: 5,
        accuratePercent: 100,
      }),
    ).toBe("5.0 avg · 100% accurate · 1 rating");
  });
});
