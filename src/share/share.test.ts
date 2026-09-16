import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SightingRail } from "../sightings/SightingRail";
import type { Sighting } from "../sightings/types";
import {
  DEEP_LINK_BASE,
  MISSING_VALUE,
  SHARE_CONDITION_STALE_MS,
  SHARE_UTM_QUERY,
  assembleShareCard,
  buildDeepLink,
} from "./card";
import { ShareCard } from "./ShareCard";
import { ShareSheet } from "./ShareSheet";
import type { ShareBeachIdentity, ShareConditionSnapshot } from "./types";

const NOW = new Date("2026-06-24T15:00:00.000Z");
const HOUR = 60 * 60 * 1000;

/**
 * renderToStaticMarkup HTML-escapes `&` to `&amp;` in href attributes and
 * text nodes. Markup assertions must compare against the escaped URL;
 * pure-logic assertions use the raw string.
 */
const htmlEscaped = (value: string) => value.replace(/&/g, "&amp;");

const beach: ShareBeachIdentity = {
  id: "beach-1",
  slug: "praia-don-ana",
  name: "Praia Dona Ana",
  region: "Lagos, Algarve",
};

const fullConditions: ShareConditionSnapshot = {
  observedAt: new Date(NOW.getTime() - 1 * HOUR).toISOString(),
  score: 87,
  waterQuality: "Good",
  crowdPct: 35,
  goldenHour: "19:42–20:24",
  waveM: 0.6,
  windKmh: 12,
  waterTempC: 21,
  airTempC: 27,
  uvIndex: 7,
  cloudPct: 10,
};

const minimalSighting: Sighting = {
  id: "s1",
  beachId: "beach-1",
  audience: "friends",
  timeOfDay: "morning",
  moderationState: "approved",
  consent: { peopleInFrame: false, peopleConsent: false },
  media: {
    form: "native",
    url: "https://cdn.sunscout.app/s/a.jpg",
    mimeType: "image/jpeg",
  },
  caption: "Glassy morning",
  capturedAt: new Date(NOW.getTime() - HOUR).toISOString(),
  expiresAt: new Date(NOW.getTime() + 6 * 24 * HOUR).toISOString(),
};

describe("buildDeepLink", () => {
  it("uses the slug and the fixed share attribution query", () => {
    expect(buildDeepLink(beach)).toBe(
      `${DEEP_LINK_BASE}/b/praia-don-ana?${SHARE_UTM_QUERY}`,
    );
    expect(SHARE_UTM_QUERY).toBe(
      "utm_source=share_card&utm_medium=social&utm_campaign=organic_share",
    );
  });

  it("falls back to the id when the slug is missing or blank", () => {
    expect(buildDeepLink({ id: "beach-1" })).toBe(
      `${DEEP_LINK_BASE}/b/beach-1?${SHARE_UTM_QUERY}`,
    );
    expect(buildDeepLink({ id: "beach-1", slug: "   " })).toBe(
      `${DEEP_LINK_BASE}/b/beach-1?${SHARE_UTM_QUERY}`,
    );
  });

  it("encodes unsafe slug characters and trims a custom base", () => {
    expect(buildDeepLink({ id: "b/1", slug: "a b/c" })).toBe(
      `${DEEP_LINK_BASE}/b/a%20b%2Fc?${SHARE_UTM_QUERY}`,
    );
    expect(buildDeepLink({ id: "b1" }, { base: "https://x.dev///" })).toBe(
      `https://x.dev/b/b1?${SHARE_UTM_QUERY}`,
    );
  });
});

describe("assembleShareCard", () => {
  it("assembles a full payload from a live condition snapshot", () => {
    const payload = assembleShareCard(
      { beach, conditions: fullConditions },
      NOW,
    );
    expect(payload).toEqual({
      beachId: "beach-1",
      beachName: "Praia Dona Ana",
      region: "Lagos, Algarve",
      deepLink: `${DEEP_LINK_BASE}/b/praia-don-ana?${SHARE_UTM_QUERY}`,
      observedAt: fullConditions.observedAt,
      degraded: false,
      staleConditions: false,
      score: 87,
      waterQuality: "Good",
      crowdPct: 35,
      goldenHour: "19:42–20:24",
      caption:
        "Praia Dona Ana right now: Pulse 87/100 · Good water · 35% full · golden hour 19:42–20:24 — live data on SunScout",
      lines: [
        { label: "Beach Pulse", value: "87/100" },
        { label: "Water quality", value: "Good" },
        { label: "Crowd", value: "35% full" },
        { label: "Golden hour", value: "19:42–20:24" },
      ],
    });
  });

  it("is deterministic — identical input, identical payload", () => {
    const a = assembleShareCard({ beach, conditions: fullConditions }, NOW);
    const b = assembleShareCard({ beach, conditions: fullConditions }, NOW);
    expect(a).toEqual(b);
  });

  it("clamps score and crowd into 0-100 and drops non-finite values", () => {
    const payload = assembleShareCard(
      {
        beach,
        conditions: {
          ...fullConditions,
          observedAt: new Date(NOW.getTime() - HOUR).toISOString(),
          score: 150,
          crowdPct: -5,
        },
      },
      NOW,
    );
    expect(payload.score).toBe(100);
    expect(payload.crowdPct).toBe(0);
    const invalid = assembleShareCard(
      {
        beach,
        conditions: {
          ...fullConditions,
          observedAt: new Date(NOW.getTime() - HOUR).toISOString(),
          score: Number.NaN,
          crowdPct: Number.NaN,
        },
      },
      NOW,
    );
    expect(invalid.score).toBeNull();
    expect(invalid.crowdPct).toBeNull();
  });

  it("trims blank text values to null", () => {
    const payload = assembleShareCard(
      {
        beach,
        conditions: {
          ...fullConditions,
          observedAt: fullConditions.observedAt,
          waterQuality: "  ",
          goldenHour: " 19:42  ",
        },
      },
      NOW,
    );
    expect(payload.waterQuality).toBeNull();
    expect(payload.goldenHour).toBe("19:42");
  });
});

describe("assembleShareCard degraded + stale cases", () => {
  it("degrades gracefully with no conditions at all", () => {
    const payload = assembleShareCard({ beach }, NOW);
    expect(payload.deepLink).toBe(
      `${DEEP_LINK_BASE}/b/praia-don-ana?${SHARE_UTM_QUERY}`,
    );
    expect(payload.degraded).toBe(true);
    expect(payload.staleConditions).toBe(true);
    expect(payload.score).toBeNull();
    expect(payload.caption).toBe(
      "Praia Dona Ana right now — live data on SunScout",
    );
    expect(payload.lines).toEqual([
      { label: "Beach Pulse", value: MISSING_VALUE },
      { label: "Water quality", value: MISSING_VALUE },
      { label: "Crowd", value: MISSING_VALUE },
      { label: "Golden hour", value: MISSING_VALUE },
    ]);
  });

  it("treats empty snapshot fields the same as no snapshot", () => {
    const payload = assembleShareCard(
      {
        beach,
        conditions: {
          observedAt: "",
          score: null,
          waterQuality: null,
          crowdPct: null,
          goldenHour: null,
        },
      },
      NOW,
    );
    expect(payload.degraded).toBe(true);
    expect(payload.observedAt).toBeNull();
    expect(payload.lines.every((l) => l.value === MISSING_VALUE)).toBe(true);
    // The link outlives the missing reading.
    expect(payload.deepLink).toContain("/b/praia-don-ana");
  });

  it("flags stale conditions past the 6h window without degrading", () => {
    const stale = assembleShareCard(
      {
        beach,
        conditions: {
          ...fullConditions,
          observedAt: new Date(
            NOW.getTime() - (SHARE_CONDITION_STALE_MS + HOUR),
          ).toISOString(),
        },
      },
      NOW,
    );
    expect(stale.degraded).toBe(false);
    expect(stale.staleConditions).toBe(true);
    expect(stale.score).toBe(87);

    const fresh = assembleShareCard(
      {
        beach,
        conditions: {
          ...fullConditions,
          observedAt: new Date(
            NOW.getTime() - (SHARE_CONDITION_STALE_MS - HOUR),
          ).toISOString(),
        },
      },
      NOW,
    );
    expect(fresh.staleConditions).toBe(false);
  });
});

describe("ShareCard", () => {
  it("renders the live values, caption and the sponsored-free deep link", () => {
    const payload = assembleShareCard(
      { beach, conditions: fullConditions },
      NOW,
    );
    const markup = renderToStaticMarkup(createElement(ShareCard, { payload }));
    expect(markup).toContain("Praia Dona Ana");
    expect(markup).toContain("Lagos, Algarve");
    expect(markup).toContain("87/100");
    expect(markup).toContain("Good");
    expect(markup).toContain("35% full");
    expect(markup).toContain("19:42–20:24");
    expect(markup).toContain("Sponsored-free, data-side");
    // The deep link renders as a plain, copyable URL — literal text, not a
    // shortened or pretty form. renderToStaticMarkup escapes `&` in both
    // the href and the text node, so assert against the escaped form.
    expect(markup).toContain(
      `href="${htmlEscaped(`${DEEP_LINK_BASE}/b/praia-don-ana?${SHARE_UTM_QUERY}`)}"`,
    );
    expect(markup).toContain(
      `${htmlEscaped(`${DEEP_LINK_BASE}/b/praia-don-ana?${SHARE_UTM_QUERY}`)}</a>`,
    );
    expect(markup).toContain("Paste into TikTok / Instagram");
    expect(markup).toContain("live data on SunScout");
  });

  it("renders the degraded note and placeholders when values are missing", () => {
    const payload = assembleShareCard({ beach }, NOW);
    const markup = renderToStaticMarkup(createElement(ShareCard, { payload }));
    expect(markup).toContain(MISSING_VALUE);
    expect(markup).toContain("Live values are unavailable right now");
    expect(markup).toContain("The link still points at the beach");
    // The deep link survives the degraded case (escaped for markup).
    expect(markup).toContain(
      htmlEscaped(`${DEEP_LINK_BASE}/b/praia-don-ana?${SHARE_UTM_QUERY}`),
    );
  });

  it("renders the stale note instead of the degraded note when data is old", () => {
    const payload = assembleShareCard(
      {
        beach,
        conditions: {
          ...fullConditions,
          observedAt: new Date(NOW.getTime() - 7 * HOUR).toISOString(),
        },
      },
      NOW,
    );
    const markup = renderToStaticMarkup(createElement(ShareCard, { payload }));
    expect(markup).toContain("Last observed a while ago");
    expect(markup).not.toContain("Live values are unavailable");
  });
});

describe("ShareSheet", () => {
  const payload = assembleShareCard({ beach, conditions: fullConditions }, NOW);

  it("renders nothing when closed or when there is no payload", () => {
    expect(
      renderToStaticMarkup(
        createElement(ShareSheet, {
          open: false,
          payload,
          onClose: () => {},
        }),
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        createElement(ShareSheet, {
          open: true,
          payload: null,
          onClose: () => {},
        }),
      ),
    ).toBe("");
  });

  it("renders the card, close control and copy action when open", () => {
    const markup = renderToStaticMarkup(
      createElement(ShareSheet, {
        open: true,
        payload,
        onClose: () => {},
      }),
    );
    expect(markup).toContain("Share this beach");
    expect(markup).toContain("Copy link");
    expect(markup).toContain("Praia Dona Ana");
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("no sponsored placement");
  });
});

describe("SightingRail share action", () => {
  it("renders a beach-level and per-sighting share action when a beach is provided", () => {
    const markup = renderToStaticMarkup(
      createElement(SightingRail, {
        sightings: [minimalSighting],
        status: "ready",
        now: NOW,
        beach,
        conditions: fullConditions,
      }),
    );
    expect(markup).toContain("Share beach");
    expect(markup).toContain('aria-label="Share Praia Dona Ana conditions"');
    expect(markup).toContain('class="sighting-item-share"');
    expect(markup.match(/class="sighting-item-share"/g)?.length ?? 0).toBe(1);
  });

  it("renders no share actions when no beach identity is provided", () => {
    const markup = renderToStaticMarkup(
      createElement(SightingRail, {
        sightings: [minimalSighting],
        status: "ready",
        now: NOW,
      }),
    );
    expect(markup).not.toContain("Share beach");
    expect(markup).not.toContain("sighting-item-share");
    expect(markup).not.toContain("share-card");
  });

  it("keeps the share action for an empty rail so the beach is still shareable", () => {
    const markup = renderToStaticMarkup(
      createElement(SightingRail, {
        sightings: [],
        status: "ready",
        now: NOW,
        beach,
        conditions: null,
      }),
    );
    expect(markup).toContain("Share beach");
    expect(markup).not.toContain("sighting-item-share");
  });
});
