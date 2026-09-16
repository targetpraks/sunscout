import { describe, expect, it } from "vitest";
import {
  aggregateVibes,
  AUDIENCE_TAGS,
  COOLDOWN_MS,
  cooldownRemainingMs,
  decayWeight,
  evaluateVibeVote,
  serializeVibes,
  toPulseSignal,
  VIBE_TAGS,
  VOTE_WINDOW_MS,
  type WeightedVibeVote,
} from "./vibes";

const SECOND_MS = 1_000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;

// Fixed clock so every assertion is deterministic.
const NOW_MS = 100 * DAY_MS;

describe("vibe tag vocabulary", () => {
  it("defines the six product vibes", () => {
    expect([...VIBE_TAGS]).toEqual([
      "chill",
      "party",
      "family",
      "romantic",
      "hidden-gem",
      "beach-club",
    ]);
  });

  it("covers every audience from beach_suitability and the leaderboard scopes", () => {
    // Locks the contract workstream-1's per-audience leaderboards rely on.
    const required = [
      "families",
      "friends",
      "solo",
      "couples",
      "party",
      "clubs",
      "chill",
      "beach-club",
    ];
    for (const tag of required) {
      expect(AUDIENCE_TAGS).toContain(tag);
    }
  });

  it("uses the PRD cooldown and expiry windows", () => {
    expect(COOLDOWN_MS).toBe(DAY_MS);
    expect(VOTE_WINDOW_MS).toBe(7 * DAY_MS);
  });
});

describe("decayWeight — 7-day linear time decay", () => {
  it("weights a vote just cast at 1.0", () => {
    expect(decayWeight(NOW_MS, NOW_MS)).toBe(1);
  });

  it("weights a vote half-way through the window at 0.5", () => {
    expect(decayWeight(NOW_MS - 3.5 * DAY_MS, NOW_MS)).toBe(0.5);
  });

  it("decays linearly to zero at the 7-day edge", () => {
    expect(decayWeight(NOW_MS - VOTE_WINDOW_MS, NOW_MS)).toBe(0);
  });

  it("clamps votes older than the window to zero", () => {
    expect(decayWeight(NOW_MS - 8 * DAY_MS, NOW_MS)).toBe(0);
  });

  it("clamps future timestamps to 1.0 instead of overshooting", () => {
    expect(decayWeight(NOW_MS + DAY_MS, NOW_MS)).toBe(1);
  });
});

describe("cooldownRemainingMs — 24h per-user-per-beach cooldown", () => {
  it("is the full 24h immediately after voting", () => {
    expect(cooldownRemainingMs(NOW_MS, NOW_MS)).toBe(COOLDOWN_MS);
  });

  it("counts down as time passes", () => {
    expect(cooldownRemainingMs(NOW_MS, NOW_MS + 12 * HOUR_MS)).toBe(
      12 * HOUR_MS,
    );
  });

  it("reaches zero exactly at the 24h boundary", () => {
    expect(cooldownRemainingMs(NOW_MS, NOW_MS + COOLDOWN_MS)).toBe(0);
  });

  it("never goes negative after the cooldown lifts", () => {
    expect(cooldownRemainingMs(NOW_MS, NOW_MS + 2 * COOLDOWN_MS)).toBe(0);
  });
});

describe("evaluateVibeVote", () => {
  it("blocks a duplicate vote within 24h of the last one", () => {
    const evaluation = evaluateVibeVote(NOW_MS, NOW_MS + HOUR_MS);
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.cooldownRemainingMs).toBe(23 * HOUR_MS);
    expect(evaluation.nextAllowedAtMs).toBe(NOW_MS + COOLDOWN_MS);
  });

  it("allows a new vote exactly at the 24h boundary", () => {
    const evaluation = evaluateVibeVote(NOW_MS, NOW_MS + COOLDOWN_MS);
    expect(evaluation.allowed).toBe(true);
    expect(evaluation.cooldownRemainingMs).toBe(0);
  });

  it("allows a new vote after the cooldown has fully elapsed", () => {
    const evaluation = evaluateVibeVote(NOW_MS, NOW_MS + COOLDOWN_MS + 1);
    expect(evaluation.allowed).toBe(true);
  });
});

describe("aggregateVibes — weighting, decay, audience bucketing", () => {
  const votes: WeightedVibeVote[] = [
    { vibe: "chill", audienceTag: "families", createdAtMs: NOW_MS - DAY_MS },
    {
      vibe: "party",
      audienceTag: "friends",
      createdAtMs: NOW_MS - 3.5 * DAY_MS,
    },
    { vibe: "chill", audienceTag: "couples", createdAtMs: NOW_MS },
  ];

  it("buckets every vote into both a vibe and an audience tally", () => {
    const aggregate = aggregateVibes("beach-1", votes, NOW_MS);
    expect(aggregate.totalVotes).toBe(3);
    expect(aggregate.vibes.map((v) => [v.tag, v.votes])).toEqual([
      ["chill", 2],
      ["party", 1],
    ]);
    expect(aggregate.audiences.map((a) => a.tag)).toEqual([
      "couples",
      "families",
      "friends",
    ]);
  });

  it("applies linear time decay to each bucket deterministically", () => {
    const aggregate = aggregateVibes("beach-1", votes, NOW_MS);
    const chill = aggregate.vibes.find((v) => v.tag === "chill");
    // 1.0 (just cast) + 6/7 rounded (cast 1 day ago) = 1.857
    expect(chill?.weight).toBe(1.857);
    expect(chill?.share).toBe(0.788);
    const friends = aggregate.audiences.find((a) => a.tag === "friends");
    expect(friends?.weight).toBe(0.5);
    expect(friends?.share).toBe(0.212);
  });

  it("sorts ties by tag for stable output", () => {
    const tied = aggregateVibes(
      "beach-1",
      [
        { vibe: "party", audienceTag: "solo", createdAtMs: NOW_MS },
        { vibe: "chill", audienceTag: "solo", createdAtMs: NOW_MS },
      ],
      NOW_MS,
    );
    expect(tied.vibes.map((v) => v.tag)).toEqual(["chill", "party"]);
  });

  it("is order-independent for identical vote sets", () => {
    const straight = aggregateVibes("beach-1", votes, NOW_MS);
    const shuffled = aggregateVibes(
      "beach-1",
      [...votes].reverse().concat().slice(), // reversed order
      NOW_MS,
    );
    expect(shuffled).toEqual(straight);
  });

  it("returns an empty, fresh aggregate when nobody has voted", () => {
    const aggregate = aggregateVibes("beach-1", [], NOW_MS);
    expect(aggregate.totalVotes).toBe(0);
    expect(aggregate.vibes).toEqual([]);
    expect(aggregate.audiences).toEqual([]);
    expect(aggregate.windowStartMs).toBe(NOW_MS - VOTE_WINDOW_MS);
    expect(aggregate.computedAtMs).toBe(NOW_MS);
  });
});

describe("toPulseSignal — Beach Pulse consumption shape", () => {
  const aggregate = aggregateVibes(
    "beach-1",
    [
      { vibe: "chill", audienceTag: "families", createdAtMs: NOW_MS },
      { vibe: "chill", audienceTag: "couples", createdAtMs: NOW_MS - DAY_MS },
      { vibe: "party", audienceTag: "friends", createdAtMs: NOW_MS },
    ],
    NOW_MS,
  );

  it("exposes the dominant vibe and audience with ISO freshness timestamps", () => {
    const signal = toPulseSignal(aggregate);
    expect(signal.kind).toBe("vibe_votes");
    expect(signal.beachId).toBe("beach-1");
    expect(signal.dominantVibe).toBe("chill");
    expect(signal.dominantAudience).toBe("families");
    expect(signal.computedAt).toBe(new Date(NOW_MS).toISOString());
    expect(signal.windowStart).toBe(
      new Date(NOW_MS - VOTE_WINDOW_MS).toISOString(),
    );
    expect(signal.totalVotes).toBe(3);
  });

  it("carries per-vibe and per-audience weights keyed for leaderboard reweighting", () => {
    const signal = toPulseSignal(aggregate);
    expect(signal.perVibe.chill).toBe(1.857);
    expect(signal.perVibe.party).toBe(1);
    expect(signal.perAudience.families).toBe(1);
    expect(signal.perAudience.couples).toBe(0.857);
  });

  it("reports null dominants when the beach has no live votes", () => {
    const signal = toPulseSignal(aggregateVibes("beach-1", [], NOW_MS));
    expect(signal.dominantVibe).toBeNull();
    expect(signal.dominantAudience).toBeNull();
    expect(signal.perVibe).toEqual({});
    expect(signal.perAudience).toEqual({});
  });
});

describe("serializeVibes — API response shape", () => {
  it("carries a freshness timestamp alongside the aggregate and pulse signal", () => {
    const aggregate = aggregateVibes(
      "beach-1",
      [{ vibe: "chill", audienceTag: "solo", createdAtMs: NOW_MS }],
      NOW_MS,
    );
    const body = serializeVibes(aggregate);
    expect(body.beachId).toBe("beach-1");
    expect(body.computedAt).toBe(new Date(NOW_MS).toISOString());
    expect(body.windowStart).toBe(
      new Date(NOW_MS - VOTE_WINDOW_MS).toISOString(),
    );
    expect(body.vibes[0]).toEqual({
      tag: "chill",
      votes: 1,
      weight: 1,
      share: 1,
    });
    expect(body.pulse.kind).toBe("vibe_votes");
  });
});
