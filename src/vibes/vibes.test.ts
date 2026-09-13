// Node-environment test (vitest has no jsdom here): the component is
// exercised via renderToStaticMarkup and this file is .ts, so React elements
// are built with createElement — no JSX syntax.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VibeBar, vibeBarState } from "./VibeBar";
import type { BeachVibesResponse } from "./types";

const NOW_MS = 100 * 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

const aggregate = (overrides: {
  totalVotes?: number;
  vibes?: BeachVibesResponse["vibes"];
  viewer?: BeachVibesResponse["viewer"];
}): BeachVibesResponse => ({
  beachId: "11111111-2222-3333-4444-555555555555",
  totalVotes: overrides.totalVotes ?? 1,
  windowStart: new Date(NOW_MS - 7 * 24 * HOUR_MS).toISOString(),
  computedAt: new Date(NOW_MS).toISOString(),
  vibes: overrides.vibes ?? [
    { tag: "chill", votes: 2, weight: 1.857, share: 0.788 },
    { tag: "party", votes: 1, weight: 0.5, share: 0.212 },
  ],
  audiences: [
    { tag: "families", votes: 2, weight: 1.857, share: 0.788 },
    { tag: "friends", votes: 1, weight: 0.5, share: 0.212 },
  ],
  pulse: {
    kind: "vibe_votes",
    beachId: "11111111-2222-3333-4444-555555555555",
    computedAt: new Date(NOW_MS).toISOString(),
    windowStart: new Date(NOW_MS - 7 * 24 * HOUR_MS).toISOString(),
    totalVotes: overrides.totalVotes ?? 1,
    dominantVibe: "chill",
    dominantAudience: "families",
    perVibe: { chill: 1.857, party: 0.5 },
    perAudience: { families: 1.857, friends: 0.5 },
  },
  viewer: overrides.viewer,
});

describe("vibeBarState — pure view-state derivation", () => {
  it("reports loading when no aggregate has arrived yet", () => {
    const state = vibeBarState(null, 0, null);
    expect(state.status).toBe("loading");
    expect(state.disabled).toBe(true);
    expect(state.signal).toBeNull();
    expect(state.empty).toBe(false);
  });

  it("reports error and disables voting when loading fails", () => {
    const state = vibeBarState(null, 0, "api_500");
    expect(state.status).toBe("error");
    expect(state.disabled).toBe(true);
    expect(state.signal).toBeNull();
  });

  it("marks an aggregate with zero votes as empty but votable", () => {
    const state = vibeBarState(
      aggregate({ totalVotes: 0, vibes: [] }),
      0,
      null,
    );
    expect(state.status).toBe("ready");
    expect(state.empty).toBe(true);
    expect(state.disabled).toBe(false);
  });

  it("disables voting while the 24h cooldown is active", () => {
    const state = vibeBarState(aggregate({}), 23 * HOUR_MS, null);
    expect(state.status).toBe("ready");
    expect(state.empty).toBe(false);
    expect(state.disabled).toBe(true);
    expect(state.cooldownRemainingMs).toBe(23 * HOUR_MS);
    expect(state.dominantVibe).toBe("chill");
  });

  it("exposes the aggregate as a Pulse-shaped signal object", () => {
    const data = aggregate({});
    const state = vibeBarState(data, 0, null);
    expect(state.signal).toEqual(data.pulse);
    expect(state.signal?.kind).toBe("vibe_votes");
    expect(state.signal?.perVibe.chill).toBe(1.857);
    expect(state.signal?.perAudience.friends).toBe(0.5);
  });
});

describe("VibeBar — rendered output (static markup)", () => {
  const beachId = "11111111-2222-3333-4444-555555555555";

  it("renders a loading state while the aggregate is being fetched", () => {
    const markup = renderToStaticMarkup(
      createElement(VibeBar, { beachId, audienceTag: "families" }),
    );
    expect(markup).toContain("Loading beach vibes");
    expect(markup).toContain('aria-busy="true"');
  });

  it("renders an error state with a retry action", () => {
    const markup = renderToStaticMarkup(
      createElement(VibeBar, {
        beachId,
        audienceTag: "families",
        initialError: "api_500",
      }),
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("api_500");
    expect(markup).toContain("Retry");
  });

  it("renders an empty state when nobody has voted yet", () => {
    const markup = renderToStaticMarkup(
      createElement(VibeBar, {
        beachId,
        audienceTag: "families",
        initialAggregate: aggregate({ totalVotes: 0, vibes: [] }),
      }),
    );
    expect(markup).toContain("No votes yet");
    expect(markup).toContain('data-cooldown="false"');
  });

  it("renders the aggregate with enabled vote buttons and the Pulse signal", () => {
    const data = aggregate({});
    const markup = renderToStaticMarkup(
      createElement(VibeBar, {
        beachId,
        audienceTag: "families",
        initialAggregate: data,
      }),
    );
    expect(markup).toContain('data-cooldown="false"');
    expect(markup).toContain('data-beach-id="' + beachId + '"');
    expect(markup).toContain("vibe_votes");
    expect(markup).toContain("chill");
    // Vote buttons are enabled: no disabled attribute on any option.
    expect(markup).not.toContain('disabled=""');
    expect(markup).toContain('data-vibe="hidden-gem"');
    expect(markup).toContain('data-vibe="beach-club"');
  });

  it("renders the disabled cooldown state after voting", () => {
    const markup = renderToStaticMarkup(
      createElement(VibeBar, {
        beachId,
        audienceTag: "families",
        initialAggregate: aggregate({
          viewer: {
            voted: true,
            cooldownUntil: null,
            cooldownRemainingMs: 23 * HOUR_MS,
          },
        }),
      }),
    );
    expect(markup).toContain('data-cooldown="true"');
    expect(markup).toContain("Voted — new vote in ~23h");
    // Every option button is disabled with aria-disabled reflected.
    const disabledCount = (markup.match(/disabled=""/g) ?? []).length;
    expect(disabledCount).toBe(6);
    expect(markup).toContain('aria-disabled="true"');
  });
});
