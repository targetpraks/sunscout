import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSightings, submitSighting } from "./api";
import { SightingCapture } from "./SightingCapture";
import { SightingRail } from "./SightingRail";
import {
  freshnessWeight,
  formatSightingAge,
  isExpiredSighting,
  selectRailSightings,
  validateCaptureInput,
  type NewSightingInput,
  type Sighting,
} from "./types";

const T0 = new Date("2026-06-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const makeSighting = (overrides: Partial<Sighting> = {}): Sighting => ({
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
  capturedAt: new Date(T0.getTime() - DAY).toISOString(),
  expiresAt: new Date(T0.getTime() + 6 * DAY).toISOString(),
  ...overrides,
});

const makeInput = (
  overrides: Partial<NewSightingInput> = {},
): NewSightingInput => ({
  beachId: "beach-1",
  audience: "friends",
  consent: { peopleInFrame: false, peopleConsent: false },
  caption: null,
  nativeMedia: {
    url: "https://cdn.sunscout.app/a.jpg",
    mimeType: "image/jpeg",
  },
  ...overrides,
});

describe("client sightings domain mirrors", () => {
  it("expires native media exactly 7 days after capture", () => {
    const sighting = makeSighting({
      capturedAt: T0.toISOString(),
      expiresAt: new Date(T0.getTime() + 7 * DAY).toISOString(),
    });
    expect(
      isExpiredSighting(sighting, new Date(T0.getTime() + 7 * DAY - 1)),
    ).toBe(false);
    expect(isExpiredSighting(sighting, new Date(T0.getTime() + 7 * DAY))).toBe(
      true,
    );
  });

  it("link sightings persist but their freshness weight decays monotonically", () => {
    const sighting = makeSighting({
      capturedAt: T0.toISOString(),
      expiresAt: null,
      media: {
        form: "link",
        platform: "tiktok",
        url: "https://www.tiktok.com/@c/video/1",
        attribution: "@c",
      },
    });
    const weights = [0, 1, 3.5, 7, 14, 30, 60, 365].map((days) =>
      freshnessWeight(sighting, new Date(T0.getTime() + days * DAY)),
    );
    expect(weights[0]).toBe(1);
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
      expect(weights[i]).toBeGreaterThan(0);
    }
  });

  it("selector excludes expired and non-approved sightings, caps at N most recent", () => {
    const sightings = [
      makeSighting({
        id: "expired",
        capturedAt: new Date(T0.getTime() - 10 * DAY).toISOString(),
        expiresAt: new Date(T0.getTime() - 3 * DAY).toISOString(),
      }),
      makeSighting({ id: "pending", moderationState: "pending" }),
      makeSighting({ id: "rejected", moderationState: "rejected" }),
      makeSighting({
        id: "a",
        capturedAt: new Date(T0.getTime() - 3 * DAY).toISOString(),
        expiresAt: new Date(T0.getTime() + 4 * DAY).toISOString(),
      }),
      makeSighting({
        id: "b",
        capturedAt: new Date(T0.getTime() - 1 * DAY).toISOString(),
        expiresAt: new Date(T0.getTime() + 6 * DAY).toISOString(),
      }),
      makeSighting({ id: "other-beach", beachId: "beach-2" }),
    ];
    const rail = selectRailSightings(sightings, {
      now: T0,
      limit: 2,
      beachId: "beach-1",
    });
    expect(rail.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("formats age labels compactly", () => {
    const captured = T0.toISOString();
    expect(formatSightingAge(captured, new Date(T0.getTime() + 30_000))).toBe(
      "just now",
    );
    expect(
      formatSightingAge(captured, new Date(T0.getTime() + 5 * 60_000)),
    ).toBe("5m ago");
    expect(
      formatSightingAge(captured, new Date(T0.getTime() + 3 * 60 * 60_000)),
    ).toBe("3h ago");
    expect(formatSightingAge(captured, new Date(T0.getTime() + 2 * DAY))).toBe(
      "2d ago",
    );
  });
});

describe("validateCaptureInput", () => {
  it("rejects a sighting with neither media nor a social URL", () => {
    const { nativeMedia: _native, ...neither } = makeInput();
    const result = validateCaptureInput(neither);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain(
      "Add a photo/video or a TikTok/Instagram link.",
    );
  });

  it("rejects a sighting with both native media and a social URL", () => {
    const both = makeInput({
      socialLink: {
        platform: "tiktok",
        url: "https://www.tiktok.com/@c/video/1",
        attribution: "@c",
      },
    });
    expect(validateCaptureInput(both).issues).toContain(
      "Choose either an upload or a social link, not both.",
    );
  });

  it("requires an audience tag", () => {
    const result = validateCaptureInput(
      makeInput({ audience: "" as NewSightingInput["audience"] }),
    );
    expect(result.issues).toContain(
      "Pick who this sighting is for (audience tag).",
    );
  });

  it("requires a valid https social URL matching the platform", () => {
    const result = validateCaptureInput(
      makeInput({
        nativeMedia: undefined,
        socialLink: {
          platform: "tiktok",
          url: "https://youtube.com/watch?v=1",
          attribution: "@c",
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toContain(
      "Link must be an https TikTok or Instagram URL matching the platform.",
    );
  });

  it("requires consent when people are recognizable in frame", () => {
    const result = validateCaptureInput(
      makeInput({ consent: { peopleInFrame: true, peopleConsent: false } }),
    );
    expect(result.issues).toContain(
      "People are recognizable in frame — their consent is required.",
    );
  });

  it("accepts a valid native capture and a valid attributed link", () => {
    expect(validateCaptureInput(makeInput()).ok).toBe(true);
    const link = validateCaptureInput(
      makeInput({
        nativeMedia: undefined,
        socialLink: {
          platform: "instagram",
          url: "https://www.instagram.com/reel/x/",
          attribution: "@creator",
        },
      }),
    );
    expect(link.ok).toBe(true);
  });
});

describe("SightingRail", () => {
  const native = (id: string, ageDays: number): Sighting =>
    makeSighting({
      id,
      caption: `caption-${id}`,
      capturedAt: new Date(T0.getTime() - ageDays * DAY).toISOString(),
      expiresAt: new Date(T0.getTime() - ageDays * DAY + 7 * DAY).toISOString(),
    });

  it("renders a loading state without a list", () => {
    const markup = renderToStaticMarkup(
      createElement(SightingRail, {
        sightings: [],
        status: "loading",
        now: T0,
      }),
    );
    expect(markup).toContain("Loading recent sightings");
    expect(markup).not.toContain("sighting-rail-list");
  });

  it("renders an error state with a retry button", () => {
    const markup = renderToStaticMarkup(
      createElement(SightingRail, {
        sightings: [],
        status: "error",
        now: T0,
        error: "Network down",
        onRetry: () => {},
      }),
    );
    expect(markup).toContain("Network down");
    expect(markup).toContain("Try again");
  });

  it("renders an empty state with an optional capture CTA", () => {
    const markup = renderToStaticMarkup(
      createElement(SightingRail, {
        sightings: [],
        status: "ready",
        now: T0,
        onCapture: () => {},
      }),
    );
    expect(markup).toContain("No sightings here yet");
    expect(markup).toContain("Post the first sighting");
  });

  it("renders only fresh approved sightings, most recent first", () => {
    const sightings = [
      native("older", 3),
      native("newest", 0.25),
      native("gone", 8),
      makeSighting({
        id: "pending",
        moderationState: "pending",
        caption: "caption-pending",
      }),
      makeSighting({
        id: "linked",
        caption: "caption-linked",
        expiresAt: null,
        media: {
          form: "link",
          platform: "instagram",
          url: "https://www.instagram.com/reel/x/",
          attribution: "@creator",
        },
      }),
    ];
    const markup = renderToStaticMarkup(
      createElement(SightingRail, {
        sightings,
        status: "ready",
        now: T0,
        limit: 10,
      }),
    );
    expect(markup).toContain("caption-newest");
    expect(markup).toContain("caption-older");
    expect(markup).toContain("caption-linked");
    expect(markup).not.toContain("caption-gone");
    expect(markup).not.toContain("caption-pending");
    expect(markup.indexOf("caption-newest")).toBeLessThan(
      markup.indexOf("caption-older"),
    );
    // Link sightings render as outbound references + attribution, never
    // as hosted media.
    expect(markup).toContain('href="https://www.instagram.com/reel/x/"');
    expect(markup).toContain("View on Instagram");
    expect(markup).toContain("Credit: @creator");
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("renders a native image sighting with its hosted media url", () => {
    const markup = renderToStaticMarkup(
      createElement(SightingRail, {
        sightings: [native("pic", 1)],
        status: "ready",
        now: T0,
      }),
    );
    expect(markup).toContain('src="https://cdn.sunscout.app/s/a.jpg"');
    expect(markup).toContain("1d ago");
  });
});

describe("SightingCapture", () => {
  it("renders the native upload form from props", () => {
    const markup = renderToStaticMarkup(
      createElement(SightingCapture, {
        beachId: "beach-1",
        onSubmit: () => {},
      }),
    );
    expect(markup).toContain("Share a sighting");
    expect(markup).toContain('type="file"');
    expect(markup).toContain("Post sighting");
    expect(markup).toContain("People are recognizable in this sighting");
    expect(markup).toContain("expires in 7 days");
  });

  it("renders the social-link form when the link mode is defaulted", () => {
    const markup = renderToStaticMarkup(
      createElement(SightingCapture, {
        beachId: "beach-1",
        onSubmit: () => {},
        defaults: { mode: "link" },
      }),
    );
    expect(markup).toContain('type="url"');
    expect(markup).toContain("tiktok.com");
    expect(markup).toContain("never re-hosts");
  });

  it("shows a parent-supplied submit error and the busy state", () => {
    const markup = renderToStaticMarkup(
      createElement(SightingCapture, {
        beachId: "beach-1",
        onSubmit: () => {},
        submitting: true,
        submitError: "Server said no",
      }),
    );
    expect(markup).toContain("Server said no");
    expect(markup).toContain("Posting…");
    expect(markup).toContain('disabled=""');
  });
});

describe("sightings api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits a sighting to POST /api/sightings with the capture payload", async () => {
    const fetchMock = vi.fn(
      async (_path: string, _init?: RequestInit) =>
        ({
          ok: true,
          status: 201,
          json: async () => ({ data: { id: "s-new" } }),
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const input = makeInput();
    const created = await submitSighting(input);
    expect(created).toEqual({ id: "s-new" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // apiBase comes from VITE_API_URL, which may be set (and may already end
    // in /api) — assert on the path suffix only.
    expect(new URL(path).pathname.endsWith("/sightings")).toBe(true);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("surfaces server validation issues as an error message", async () => {
    const fetchMock = vi.fn(
      async (_path: string, _init?: RequestInit) =>
        ({
          ok: false,
          status: 422,
          json: async () => ({
            issues: ["audience is required", "consent is required"],
          }),
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitSighting(makeInput())).rejects.toThrow(
      "audience is required consent is required",
    );
  });

  it("fetches a beach-scoped, capped sighting list", async () => {
    const fetchMock = vi.fn(
      async (_path: string, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ data: [makeSighting()] }),
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const sightings = await fetchSightings("beach-1", 6);
    expect(sightings).toHaveLength(1);
    const called = fetchMock.mock.calls[0][0] as string;
    const calledUrl = new URL(called);
    expect(calledUrl.pathname.endsWith("/sightings")).toBe(true);
    expect(calledUrl.searchParams.get("beachId")).toBe("beach-1");
    expect(calledUrl.searchParams.get("limit")).toBe("6");
  });
});
