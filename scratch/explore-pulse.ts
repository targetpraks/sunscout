// Exploratory: print family vs party orderings for the shared fixture.
// Temporary scratch — deleted before commit.
import {
  computePulse,
  rankByPulse,
  AUDIENCE_PROFILES,
} from "../src/pulse/scoring";
import type { PulseInput, PulseAudience } from "../src/pulse/types";

const NOW = new Date("2026-09-13T12:00:00Z");
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

// Shared fixture: five beaches with deliberately contrasting profiles.
const familyParadise: PulseInput = {
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
};

const balanced: PulseInput = {
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
};

const quiet: PulseInput = {
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
};

const busy: PulseInput = {
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
};

const partyCentral: PulseInput = {
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
};

const FIXTURE = [familyParadise, balanced, quiet, busy, partyCentral];

for (const audience of [
  "family",
  "party",
  "friends",
  "solo",
  "couples",
  "chill",
] as PulseAudience[]) {
  const ranked = rankByPulse(FIXTURE, { audience, now: NOW });
  console.log(
    audience.padEnd(8),
    ranked.map((r) => `${r.id}:${r.score}`).join(" "),
  );
}

// Per-audience breakdown detail for family and party
for (const audience of ["family", "party"] as PulseAudience[]) {
  console.log(`\n--- ${audience} breakdowns ---`);
  for (const b of FIXTURE) {
    const r = computePulse(b, { audience, now: NOW });
    console.log(
      r.id.padEnd(10),
      `score=${r.score}`,
      `cond=${r.breakdown.conditions.toFixed(1)}`,
      `comm=${r.breakdown.community.toFixed(1)}`,
      `act=${r.breakdown.activity}`,
      `vibe=${r.breakdown.vibe}`,
      `fresh=${r.breakdown.freshness.toFixed(3)}`,
      `conf=${r.confidence.toFixed(2)}`,
    );
  }
}

// Stale vs fresh experiment (AC#2)
const perfectStale: PulseInput = {
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
const mediocreFresh: PulseInput = {
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
for (const audience of ["family", "party"] as PulseAudience[]) {
  const a = computePulse(perfectStale, { audience, now: NOW });
  const b = computePulse(mediocreFresh, { audience, now: NOW });
  console.log(
    `AC2 ${audience}: perfectStale=${a.score} mediocreFresh=${b.score} diff=${b.score - a.score}`,
  );
}

// Stale conditions factor (AC#3)
const staleCond = computePulse(
  {
    id: "x",
    conditions: {
      observedAt: hoursAgo(7),
      waveM: 0.3,
      windKmh: 8,
      waterTempC: 23,
      airTempC: 26,
      uvIndex: 5,
      crowdPct: 25,
      cloudPct: 10,
    },
    community: {
      checkIns: [{ audience: "family", at: hoursAgo(1), kind: "check-in" }],
    },
  },
  { audience: "family", now: NOW },
);
const freshCond = computePulse(
  {
    id: "x",
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
      checkIns: [{ audience: "family", at: hoursAgo(1), kind: "check-in" }],
    },
  },
  { audience: "family", now: NOW },
);
console.log(
  `AC3: freshCond=${freshCond.breakdown.conditions.toFixed(2)} staleCond=${staleCond.breakdown.conditions.toFixed(2)} ratio=${(staleCond.breakdown.conditions / freshCond.breakdown.conditions).toFixed(4)}`,
);
console.log(
  "empty:",
  JSON.stringify(computePulse({ id: "e" }, { audience: "family", now: NOW })),
);
