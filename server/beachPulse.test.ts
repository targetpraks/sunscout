/**
 * Server-side Beach Pulse tests.
 *
 * These are the drift guard for the server/client mirror: the fixture and
 * every assertion are identical to src/pulse/scoring.test.ts (same beaches,
 * same numbers, same expected orderings). If either module diverges by one
 * constant, one of the two suites fails loudly.
 */

import { describe, expect, it } from "vitest";
import {
  ACTIVITY_WINDOW_H,
  AUDIENCE_PROFILES,
  CONDITION_STALE_HOURS,
  FRESHNESS_WINDOW_H,
  LIVE_NOW_BOOST,
  LIVE_NOW_DECAY_H,
  LIVE_NOW_FLOOR,
  LIVE_NOW_WINDOW_H,
  MISSING_SIGNAL_DEFAULTS,
  NEUTRAL_SIGNAL_SCORE,
  STALE_CONDITION_FACTOR,
  PULSE_AUDIENCES,
  badgeTier,
  computePulse,
  conditionFreshnessFactor,
  freshnessFactor,
  liveNowFactor,
  pulseLabel,
  rankByPulse,
} from "./beachPulse";
import type { CommunitySignals, PulseAudience, PulseInput } from "./beachPulse";

const NOW = new Date("2026-09-13T12:00:00Z");
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

/**
 * Fixed fixture of five beaches with deliberately contrasting profiles.
 * The same fixture (same numbers) is pinned in server/beachPulse.test.ts —
 * the two test suites are the drift guard for the client/server mirror.
 */
function makeFixture(): PulseInput[] {
  return [
    {
      id: "cove",
      name: "Calm Cove",
      conditions: {
        observedAt: hoursAgo(1),
        waveM: 0.3,
        windKmh: 8,
        waterTempC: 23,
        airTempC: 26,
        uvIndex: 5,
        crowdPct: 25,
        cloudPct: 10,
      },
      community: {
        checkIns: [
          { audience: "family", at: hoursAgo(1), kind: "check-in" },
          { audience: "family", at: hoursAgo(2), kind: "check-in" },
          { audience: "family", at: hoursAgo(3), kind: "sighting" },
        ],
        vibeVotes: [{ audience: "family", at: hoursAgo(2), score: 90 }],
        accuracyRatings: [{ at: hoursAgo(2), accurate: true }],
      },
    },
    {
      id: "sunset",
      name: "Sunset Bay",
      conditions: {
        observedAt: hoursAgo(2),
        waveM: 0.6,
        windKmh: 12,
        waterTempC: 22,
        airTempC: 27,
        uvIndex: 6,
        crowdPct: 50,
        cloudPct: 20,
      },
      community: {
        checkIns: [
          { audience: "family", at: hoursAgo(2), kind: "check-in" },
          { audience: "friends", at: hoursAgo(1), kind: "check-in" },
          { audience: "couples", at: hoursAgo(1), kind: "check-in" },
        ],
        vibeVotes: [
          { audience: "family", at: hoursAgo(2), score: 75 },
          { audience: "friends", at: hoursAgo(1), score: 70 },
        ],
        accuracyRatings: [
          { at: hoursAgo(2), accurate: true },
          { at: hoursAgo(3), accurate: true },
        ],
      },
    },
    {
      id: "solitude",
      name: "Solitude Point",
      conditions: {
        observedAt: hoursAgo(1),
        waveM: 0.2,
        windKmh: 6,
        waterTempC: 21,
        airTempC: 24,
        uvIndex: 4,
        crowdPct: 8,
        cloudPct: 15,
      },
      community: {
        checkIns: [
          { audience: "solo", at: hoursAgo(1), kind: "check-in" },
          { audience: "chill", at: hoursAgo(2), kind: "check-in" },
        ],
        vibeVotes: [
          { audience: "solo", at: hoursAgo(1), score: 85 },
          { audience: "chill", at: hoursAgo(2), score: 80 },
        ],
      },
    },
    {
      id: "broadwalk",
      name: "Broadwalk Beach",
      conditions: {
        observedAt: hoursAgo(3),
        waveM: 1,
        windKmh: 18,
        waterTempC: 24,
        airTempC: 30,
        uvIndex: 8,
        crowdPct: 75,
        cloudPct: 5,
      },
      community: {
        checkIns: [
          { audience: "friends", at: hoursAgo(1), kind: "check-in" },
          { audience: "friends", at: hoursAgo(2), kind: "check-in" },
          { audience: "party", at: hoursAgo(1), kind: "check-in" },
          { audience: "party", at: hoursAgo(2), kind: "sighting" },
          { audience: "party", at: hoursAgo(3), kind: "check-in" },
        ],
        vibeVotes: [
          { audience: "friends", at: hoursAgo(1), score: 85 },
          { audience: "party", at: hoursAgo(1), score: 90 },
        ],
        accuracyRatings: [{ at: hoursAgo(3), accurate: true }],
      },
    },
    {
      id: "lido",
      name: "Lido Strip",
      conditions: {
        observedAt: hoursAgo(1),
        waveM: 1.1,
        windKmh: 20,
        waterTempC: 25,
        airTempC: 32,
        uvIndex: 8,
        crowdPct: 92,
        cloudPct: 0,
      },
      community: {
        checkIns: [
          { audience: "party", at: hoursAgo(0.5), kind: "check-in" },
          { audience: "party", at: hoursAgo(1), kind: "check-in" },
          { audience: "party", at: hoursAgo(2), kind: "check-in" },
          { audience: "friends", at: hoursAgo(1), kind: "check-in" },
        ],
        vibeVotes: [{ audience: "party", at: hoursAgo(1), score: 95 }],
        accuracyRatings: [
          { at: hoursAgo(1), accurate: true },
          { at: hoursAgo(2), accurate: true },
        ],
      },
    },
  ];
}

describe("audience weight profiles", () => {
  it("has blend, condition-weight and community-mix weights summing to 1", () => {
    for (const [audience, p] of Object.entries(AUDIENCE_PROFILES)) {
      const condSum =
        p.conditionWeights.wave +
        p.conditionWeights.wind +
        p.conditionWeights.airTemp +
        p.conditionWeights.waterTemp +
        p.conditionWeights.uv +
        p.conditionWeights.crowd +
        p.conditionWeights.cloud;
      expect(condSum, `${audience} conditionWeights`).toBeCloseTo(1, 10);
      expect(p.blend.conditions + p.blend.community).toBeCloseTo(1, 10);
      expect(
        p.communityMix.activity + p.communityMix.vibe + p.communityMix.accuracy,
      ).toBeCloseTo(1, 10);
    }
  });
});

describe("per-audience ordering (AC: family vs party/clubs differ)", () => {
  it("ranks the same fixture differently for family vs party", () => {
    const fixture = makeFixture();
    const family = rankByPulse(fixture, { audience: "family", now: NOW });
    const party = rankByPulse(fixture, { audience: "party", now: NOW });
    const familyIds = family.map((r) => r.id);
    const partyIds = party.map((r) => r.id);
    // Ordered-assertion: exact top-N orderings are pinned.
    expect(familyIds).toEqual([
      "cove",
      "sunset",
      "solitude",
      "broadwalk",
      "lido",
    ]);
    expect(partyIds).toEqual([
      "lido",
      "broadwalk",
      "sunset",
      "cove",
      "solitude",
    ]);
    expect(familyIds).not.toEqual(partyIds);
    // The family winner is the party loser and vice versa.
    expect(familyIds[0]).toBe("cove");
    expect(partyIds[0]).toBe("lido");
    expect(partyIds.indexOf("cove")).toBeGreaterThan(familyIds.indexOf("cove"));
    expect(partyIds.indexOf("lido")).toBeLessThan(familyIds.indexOf("lido"));
  });

  it("does not mutate its input and tiebreaks deterministically by id", () => {
    const fixture = makeFixture();
    const snapshot = fixture.map((b) => b.id);
    rankByPulse(fixture, { audience: "family", now: NOW });
    expect(fixture.map((b) => b.id)).toEqual(snapshot);

    const twins: PulseInput[] = [
      { id: "b", conditions: { observedAt: hoursAgo(1) } },
      { id: "a", conditions: { observedAt: hoursAgo(1) } },
    ];
    const ranked = rankByPulse(twins, { audience: "solo", now: NOW });
    expect(ranked.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("audience-matched freshness decay (AC: stale signals sink)", () => {
  // Perfect family conditions, but the last audience-matching signal is 36h old.
  const perfectButStale: PulseInput = {
    id: "perfect-stale",
    conditions: {
      observedAt: hoursAgo(1),
      waveM: 0.4,
      windKmh: 8,
      waterTempC: 24,
      airTempC: 27,
      uvIndex: 5,
      crowdPct: 25,
      cloudPct: 10,
    },
    community: {
      checkIns: [{ audience: "family", at: hoursAgo(36), kind: "check-in" }],
      vibeVotes: [{ audience: "family", at: hoursAgo(36), score: 95 }],
      accuracyRatings: [{ at: hoursAgo(36), accurate: true }],
    },
  };
  // Mediocre conditions, but fresh audience-matching signals.
  const mediocreButFresh: PulseInput = {
    id: "mediocre-fresh",
    conditions: {
      observedAt: hoursAgo(1),
      waveM: 0.6,
      windKmh: 15,
      waterTempC: 21,
      airTempC: 26,
      uvIndex: 5,
      crowdPct: 30,
      cloudPct: 25,
    },
    community: {
      checkIns: [
        { audience: "family", at: hoursAgo(0.5), kind: "check-in" },
        { audience: "family", at: hoursAgo(1), kind: "check-in" },
      ],
      vibeVotes: [{ audience: "family", at: hoursAgo(0.5), score: 70 }],
      accuracyRatings: [{ at: hoursAgo(1), accurate: true }],
    },
  };

  it("ranks a fresh-signal beach above a stale-signal beach with perfect conditions", () => {
    const stale = computePulse(perfectButStale, {
      audience: "family",
      now: NOW,
    });
    const fresh = computePulse(mediocreButFresh, {
      audience: "family",
      now: NOW,
    });
    expect(fresh.score).toBeGreaterThan(stale.score);
    // Measured gap is ~31 points — require a decisive margin, not a coin flip.
    expect(fresh.score - stale.score).toBeGreaterThanOrEqual(20);
    expect(stale.breakdown.freshness).toBeLessThan(0.25);
    expect(fresh.breakdown.freshness).toBe(1);
  });

  it("decays community to zero when there are no audience-matching signals at all", () => {
    const wrongCrowd = computePulse(
      {
        id: "wrong-crowd",
        conditions: { observedAt: hoursAgo(1), waveM: 0.3, crowdPct: 25 },
        community: {
          checkIns: [{ audience: "party", at: hoursAgo(1), kind: "check-in" }],
          vibeVotes: [{ audience: "party", at: hoursAgo(1), score: 95 }],
        },
      },
      { audience: "family", now: NOW },
    );
    expect(wrongCrowd.breakdown.community).toBe(0);
    expect(wrongCrowd.breakdown.freshness).toBe(0);
  });
});

describe("condition staleness degradation (AC: >6h reduces the score)", () => {
  const perfectRow = {
    waveM: 0.3,
    windKmh: 8,
    waterTempC: 23,
    airTempC: 26,
    uvIndex: 5,
    crowdPct: 25,
    cloudPct: 10,
  };
  const withCommunity: CommunitySignals = {
    checkIns: [{ audience: "family", at: hoursAgo(1), kind: "check-in" }],
  };

  it("applies the documented 0.85 degradation factor past 6h", () => {
    const fresh = computePulse(
      {
        id: "x",
        conditions: { observedAt: hoursAgo(1), ...perfectRow },
        community: withCommunity,
      },
      { audience: "family", now: NOW },
    );
    const stale = computePulse(
      {
        id: "x",
        conditions: { observedAt: hoursAgo(7), ...perfectRow },
        community: withCommunity,
      },
      { audience: "family", now: NOW },
    );
    expect(fresh.staleConditions).toBe(false);
    expect(stale.staleConditions).toBe(true);
    expect(stale.breakdown.conditionFreshness).toBe(STALE_CONDITION_FACTOR);
    // Documented degradation factor, exactly.
    expect(stale.breakdown.conditions / fresh.breakdown.conditions).toBeCloseTo(
      STALE_CONDITION_FACTOR,
      10,
    );
    // Same-row comparison: the stale beach scores strictly lower.
    expect(stale.score).toBeLessThan(fresh.score);
  });

  it("treats the 6h boundary as fresh and 6h+epsilon as stale", () => {
    expect(conditionFreshnessFactor(CONDITION_STALE_HOURS)).toBe(1);
    expect(conditionFreshnessFactor(CONDITION_STALE_HOURS + 0.01)).toBe(
      STALE_CONDITION_FACTOR,
    );
    // Unknown age is treated as stale — never present unverifiable data as fresh.
    expect(conditionFreshnessFactor(null)).toBe(STALE_CONDITION_FACTOR);
  });
});

describe("defaults, clamping and NaN safety", () => {
  it("scores an empty input finitely within 0-100 with zero confidence", () => {
    const r = computePulse({ id: "empty" }, { audience: "family", now: NOW });
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.confidence).toBe(0);
    expect(r.staleConditions).toBe(true);
    expect(r.breakdown.community).toBe(0);
  });

  it("falls back to documented defaults for missing/invalid signals", () => {
    const withDefault = computePulse(
      { id: "x", conditions: { observedAt: hoursAgo(1) } },
      { audience: "family", now: NOW },
    );
    const withNan = computePulse(
      {
        id: "x",
        conditions: {
          observedAt: hoursAgo(1),
          waveM: Number.NaN,
          windKmh: Number.NaN,
          waterTempC: Number.NaN,
          airTempC: Number.NaN,
          uvIndex: Number.NaN,
          crowdPct: Number.NaN,
          cloudPct: Number.NaN,
        },
      },
      { audience: "family", now: NOW },
    );
    expect(withNan.score).toBe(withDefault.score);
    expect(Number.isFinite(withNan.score)).toBe(true);
    // Documented defaults are mild, never perfect.
    expect(MISSING_SIGNAL_DEFAULTS.crowdPct).toBeGreaterThan(0);
    expect(MISSING_SIGNAL_DEFAULTS.crowdPct).toBeLessThan(100);
  });

  it("uses the documented neutral default for missing vibe votes and accuracy ratings", () => {
    const r = computePulse(
      {
        id: "x",
        conditions: { observedAt: hoursAgo(1) },
        community: {
          checkIns: [{ audience: "solo", at: hoursAgo(1), kind: "check-in" }],
        },
      },
      { audience: "solo", now: NOW },
    );
    expect(r.breakdown.vibe).toBe(NEUTRAL_SIGNAL_SCORE);
  });

  it("clamps out-of-range inputs instead of producing NaN", () => {
    const r = computePulse(
      {
        id: "x",
        conditions: {
          observedAt: hoursAgo(1),
          waveM: -50,
          windKmh: 1e9,
          airTempC: -100,
          waterTempC: 1e9,
          uvIndex: -1,
          crowdPct: -20,
          cloudPct: 500,
        },
      },
      { audience: "family", now: NOW },
    );
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("freshnessFactor", () => {
  it("is 1 inside the window, 0 with no signal, and decays by half-life past it", () => {
    expect(freshnessFactor(null, 12)).toBe(0);
    expect(freshnessFactor(FRESHNESS_WINDOW_H, 12)).toBe(1);
    const halfLife = AUDIENCE_PROFILES.family.freshnessHalfLifeH;
    expect(
      freshnessFactor(FRESHNESS_WINDOW_H + halfLife, halfLife),
    ).toBeCloseTo(0.5, 10);
  });
});

describe("activity window", () => {
  it("counts only audience-matching check-ins within the activity window", () => {
    const base = {
      conditions: { observedAt: hoursAgo(1), waveM: 0.3, crowdPct: 25 },
    };
    const within = computePulse(
      {
        ...base,
        id: "x",
        community: {
          checkIns: [
            {
              audience: "family",
              at: hoursAgo(ACTIVITY_WINDOW_H - 0.5),
              kind: "check-in",
            },
          ],
        },
      },
      { audience: "family", now: NOW },
    );
    const outside = computePulse(
      {
        ...base,
        id: "x",
        community: {
          checkIns: [
            {
              audience: "family",
              at: hoursAgo(ACTIVITY_WINDOW_H + 2),
              kind: "check-in",
            },
          ],
        },
      },
      { audience: "family", now: NOW },
    );
    expect(within.breakdown.activity).toBeGreaterThan(0);
    expect(outside.breakdown.activity).toBe(0);
  });
});

describe("display helpers", () => {
  it("maps scores to tiers and labels at the documented boundaries", () => {
    expect(badgeTier(100)).toBe("great");
    expect(badgeTier(75)).toBe("great");
    expect(badgeTier(74)).toBe("good");
    expect(badgeTier(55)).toBe("good");
    expect(badgeTier(54)).toBe("fair");
    expect(badgeTier(35)).toBe("fair");
    expect(badgeTier(34)).toBe("poor");
    expect(badgeTier(0)).toBe("poor");
    expect(pulseLabel(80)).toBe("Excellent");
    expect(pulseLabel(60)).toBe("Good");
    expect(pulseLabel(40)).toBe("Fair");
    expect(pulseLabel(10)).toBe("Poor");
  });

  it("clamps out-of-range scores in display helpers", () => {
    expect(badgeTier(1000)).toBe("great");
    expect(badgeTier(-5)).toBe("poor");
  });
});

describe("all six audiences produce sane scores", () => {
  it("scores every fixture beach finitely for every audience", () => {
    const audiences: PulseAudience[] = [
      "family",
      "friends",
      "solo",
      "couples",
      "party",
      "chill",
    ];
    for (const audience of audiences) {
      for (const beach of makeFixture()) {
        const r = computePulse(beach, { audience, now: NOW });
        expect(Number.isFinite(r.score), `${audience}/${beach.id}`).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("liveNowFactor (AC: live-now boost and 24h decay)", () => {
  it("is >= 1.05 within the 2h window and decays monotonically to the 0.8 floor at 24h", () => {
    // No signals at all: the documented floor, well inside the <= 0.85 contract.
    expect(liveNowFactor(null)).toBe(LIVE_NOW_FLOOR);
    expect(LIVE_NOW_BOOST).toBeGreaterThanOrEqual(1.05);
    expect(LIVE_NOW_FLOOR).toBeLessThanOrEqual(0.85);
    // Inside the window: the full documented boost, exactly.
    expect(liveNowFactor(0)).toBe(LIVE_NOW_BOOST);
    expect(liveNowFactor(LIVE_NOW_WINDOW_H)).toBe(LIVE_NOW_BOOST);
    // Just past the window the decay starts immediately.
    expect(liveNowFactor(LIVE_NOW_WINDOW_H + 0.01)).toBeLessThan(
      LIVE_NOW_BOOST,
    );
    // At and beyond 24h: the floor, exactly.
    expect(liveNowFactor(LIVE_NOW_DECAY_H)).toBe(LIVE_NOW_FLOOR);
    expect(liveNowFactor(LIVE_NOW_DECAY_H + 24)).toBe(LIVE_NOW_FLOOR);
    // Monotone non-increasing across the whole band.
    let prev = liveNowFactor(0);
    for (let h = 0.25; h <= LIVE_NOW_DECAY_H; h += 0.25) {
      const current = liveNowFactor(h);
      expect(current).toBeLessThanOrEqual(prev);
      prev = current;
    }
  });

  it("boosts a beach with an any-audience signal within 2h, decays one with none in 24h", () => {
    const base = {
      conditions: { observedAt: hoursAgo(1), waveM: 0.3, crowdPct: 25 },
    };
    // A party sighting 1h ago still boosts the FAMILY leaderboard — live-now
    // is audience-agnostic by design ("is this beach alive right now").
    const boosted = computePulse(
      {
        ...base,
        id: "x",
        community: {
          checkIns: [{ audience: "party", at: hoursAgo(1), kind: "check-in" }],
        },
      },
      { audience: "family", now: NOW },
    );
    // Nothing newer than 25h: floor decay, even though the signal matches.
    const decayed = computePulse(
      {
        ...base,
        id: "x",
        community: {
          checkIns: [
            { audience: "family", at: hoursAgo(25), kind: "check-in" },
            { audience: "friends", at: hoursAgo(30), kind: "check-in" },
          ],
        },
      },
      { audience: "family", now: NOW },
    );
    // No community signals at all.
    const silent = computePulse(
      { ...base, id: "x" },
      { audience: "family", now: NOW },
    );

    expect(boosted.breakdown.liveNow).toBeGreaterThanOrEqual(1.05);
    expect(boosted.lastLiveSignalAgeH).toBeCloseTo(1, 10);
    expect(decayed.breakdown.liveNow).toBeLessThanOrEqual(0.85);
    expect(decayed.lastLiveSignalAgeH).toBeCloseTo(25, 10);
    expect(silent.breakdown.liveNow).toBeLessThanOrEqual(0.85);
    expect(silent.lastLiveSignalAgeH).toBeNull();
    // Identical conditions: the boost is a real lift, the decay a real sink.
    expect(boosted.score).toBeGreaterThan(silent.score);
    expect(decayed.score).toBeLessThan(boosted.score);
  });

  it("uses the newest any-audience signal, distinct from the audience-matched one", () => {
    const r = computePulse(
      {
        id: "x",
        conditions: { observedAt: hoursAgo(1), waveM: 0.3, crowdPct: 25 },
        community: {
          checkIns: [
            { audience: "family", at: hoursAgo(10), kind: "check-in" },
            { audience: "party", at: hoursAgo(0.5), kind: "sighting" },
          ],
        },
      },
      { audience: "family", now: NOW },
    );
    // Audience-matched view: the family check-in is 10h old.
    expect(r.lastSignalAgeH).toBeCloseTo(10, 10);
    // Live-now view: the fresher party sighting keeps the beach boosted.
    expect(r.lastLiveSignalAgeH).toBeCloseTo(0.5, 10);
    expect(r.breakdown.liveNow).toBeGreaterThanOrEqual(1.05);
  });

  it("applies a uniform live-now boost across the fixture without flipping the pinned orderings", () => {
    // Every fixture beach has an any-audience check-in within 2h, so the
    // factor is a uniform 1.05 and the pinned family/party orderings above
    // must still hold with the boost applied.
    for (const beach of makeFixture()) {
      const r = computePulse(beach, { audience: "family", now: NOW });
      expect(r.breakdown.liveNow).toBe(LIVE_NOW_BOOST);
    }
    const familyIds = rankByPulse(makeFixture(), {
      audience: "family",
      now: NOW,
    }).map((r) => r.id);
    expect(familyIds).toEqual([
      "cove",
      "sunset",
      "solitude",
      "broadwalk",
      "lido",
    ]);
  });
});

describe("per-audience top-3 (AC: family weighting differs from party weighting)", () => {
  it("produces a different family top-3 than party top-3 on identical seed data", () => {
    const fixture = makeFixture();
    const familyTop3 = rankByPulse(fixture, {
      audience: "family",
      now: NOW,
    })
      .slice(0, 3)
      .map((r) => r.id);
    const partyTop3 = rankByPulse(fixture, { audience: "party", now: NOW })
      .slice(0, 3)
      .map((r) => r.id);
    expect(familyTop3).not.toEqual(partyTop3);
    // Each audience's own winner tops its leaderboard.
    expect(familyTop3[0]).toBe("cove");
    expect(partyTop3[0]).toBe("lido");
  });

  it("exposes all six audiences through PULSE_AUDIENCES in canonical chip order", () => {
    expect(PULSE_AUDIENCES).toEqual([
      "family",
      "friends",
      "solo",
      "couples",
      "party",
      "chill",
    ]);
  });
});
