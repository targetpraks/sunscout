import { afterEach, describe, expect, it, vi } from "vitest";
import type { Beach } from "../types";
import {
  beachDeepLink,
  browserShareDeps,
  buildShareCard,
  crowdLabel,
  SHARE_BASE_URL,
  shareCard,
  shareCardText,
} from "./share";
import type { ShareConditions, ShareDeps } from "./types";

const makeBeach = (overrides: Partial<Beach> = {}): Beach => ({
  id: "b1",
  slug: "praia-da-coelha",
  name: "Praia da Coelha",
  location: "Algarve, Portugal",
  image: "/x.svg",
  decision: "A calm family cove",
  match: 80,
  drive: "30 min",
  distance: "20 km",
  seaTemp: "19°C",
  waves: "0.5 m",
  uv: "6 High",
  crowd: 35,
  waterQuality: "Good",
  goldenHour: "19:42–20:24",
  vibes: ["Quiet", "Family"],
  suitability: [],
  amenities: [],
  available: { sunbeds: 10, umbrellas: 5, clubs: 2 },
  ...overrides,
});

const conditions: ShareConditions = {
  seaTemp: "21°C",
  observedAt: "2026-09-14T10:00:00Z",
};

describe("buildShareCard", () => {
  it("deterministically assembles the same card from the same inputs", () => {
    const beach = makeBeach();
    const first = buildShareCard(beach, conditions);
    const second = buildShareCard(beach, conditions);
    expect(first).toEqual(second);
    expect(first.title).toBe("Praia da Coelha — right now");
    expect(first.url).toBe("https://sunscout.app/beach/praia-da-coelha");
    expect(first.caption).toBe(
      "Praia da Coelha right now (as of 2026-09-14T10:00:00Z) — A calm family cove",
    );
    expect(first.fields.map((field) => field.label)).toEqual([
      "Sea temp",
      "Waves",
      "UV",
      "Crowd",
      "Water",
      "Golden hour",
    ]);
    // does not mutate its inputs
    expect(beach.seaTemp).toBe("19°C");
    expect(beach.crowd).toBe(35);
  });

  it("prefers slug over id in the deep link and encodes it", () => {
    expect(beachDeepLink(makeBeach({ slug: "praia do camilo" }))).toBe(
      "https://sunscout.app/beach/praia%20do%20camilo",
    );
    expect(beachDeepLink({ slug: undefined, id: "b/42" })).toBe(
      "https://sunscout.app/beach/b%2F42",
    );
    expect(beachDeepLink({ slug: "x", id: "x" }, "https://example.com")).toBe(
      "https://example.com/beach/x",
    );
  });

  it("makes zero network calls", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const card = buildShareCard(makeBeach(), conditions);
      expect(card).toBeTruthy();
    } finally {
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it("overlays live conditions over the beach fields, filling gaps from the beach", () => {
    const card = buildShareCard(makeBeach(), {
      seaTemp: "22°C",
      waves: null,
    });
    const seaTemp = card.fields.find((field) => field.label === "Sea temp");
    const waves = card.fields.find((field) => field.label === "Waves");
    expect(seaTemp?.value).toBe("22°C"); // live wins
    expect(waves?.value).toBe("0.5 m"); // gap filled from the beach
  });

  it("degrades honestly when live conditions are missing (PRD §4.3)", () => {
    const sparse = makeBeach({
      // Non-nullable Beach fields degrade via empty values; optional ones
      // via null/undefined. crowd is invalid on purpose: 0 is a legitimate
      // "empty beach" reading and must still produce a Crowd field.
      seaTemp: "",
      waves: "",
      uv: "",
      crowd: Number.NaN,
      waterQuality: "",
      goldenHour: "",
      airTemp: null,
      wind: null,
      cloudCover: null,
      provenance: { receivedAt: null },
    });
    const card = buildShareCard(sparse);
    expect(card.fields).toEqual([]);
    expect(card.hasLiveConditions).toBe(false);
    expect(card.caption).toBe(
      "Live conditions for Praia da Coelha are temporarily unavailable — open the beach page for the latest.",
    );
    expect(card.url).toBe(`${SHARE_BASE_URL}/beach/praia-da-coelha`);
  });

  it("includes optional conditions fields the demo data degrades on", () => {
    const card = buildShareCard(
      makeBeach({
        airTemp: "24°C",
        wind: "12 km/h NW",
        cloudCover: "10%",
      }),
    );
    expect(card.fields.map((field) => field.label)).toEqual([
      "Sea temp",
      "Waves",
      "UV",
      "Crowd",
      "Water",
      "Air",
      "Wind",
      "Cloud",
      "Golden hour",
    ]);
    expect(card.hasLiveConditions).toBe(true);
  });

  it("drops out-of-range or non-finite crowd values instead of inventing data", () => {
    for (const crowd of [-5, 150, Number.NaN]) {
      const card = buildShareCard(makeBeach({ crowd }));
      expect(
        card.fields.find((field) => field.label === "Crowd"),
        `crowd ${crowd}`,
      ).toBeUndefined();
    }
    const card = buildShareCard(makeBeach({ crowd: 75 }));
    expect(card.fields.find((field) => field.label === "Crowd")?.value).toBe(
      "High (75%)",
    );
  });

  it("crowds into the same buckets as the conditions grid", () => {
    expect(crowdLabel(0)).toBe("Low");
    expect(crowdLabel(39)).toBe("Low");
    expect(crowdLabel(40)).toBe("Medium");
    expect(crowdLabel(69)).toBe("Medium");
    expect(crowdLabel(70)).toBe("High");
    expect(crowdLabel(89)).toBe("High");
    expect(crowdLabel(90)).toBe("Full");
    expect(crowdLabel(100)).toBe("Full");
  });

  it("falls back to beach provenance for the freshness stamp", () => {
    const card = buildShareCard(
      makeBeach({ provenance: { receivedAt: "2026-09-14T08:30:00Z" } }),
    );
    expect(card.caption).toBe(
      "Praia da Coelha right now (as of 2026-09-14T08:30:00Z) — A calm family cove",
    );
  });
});

describe("shareCardText", () => {
  it("serializes title, fields in order, caption, and the deep link", () => {
    const card = buildShareCard(makeBeach());
    expect(shareCardText(card)).toBe(
      [
        "Praia da Coelha — right now",
        "Sea temp: 19°C",
        "Waves: 0.5 m",
        "UV: 6 High",
        "Crowd: Low (35%)",
        "Water: Good",
        "Golden hour: 19:42–20:24",
        "",
        "Praia da Coelha right now — A calm family cove https://sunscout.app/beach/praia-da-coelha",
      ].join("\n"),
    );
  });
});

describe("shareCard fallback selection", () => {
  const card = buildShareCard(makeBeach());

  it("uses the Web Share API when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(
      shareCard(card, { share, writeText } satisfies ShareDeps),
    ).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: card.title,
      text: card.caption,
      url: card.url,
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("treats a dismissed share sheet as cancelled, without touching the clipboard", async () => {
    const abort = new Error("share cancelled");
    abort.name = "AbortError";
    const share = vi.fn().mockRejectedValue(abort);
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(
      shareCard(card, { share, writeText } satisfies ShareDeps),
    ).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when the share API fails", async () => {
    const share = vi.fn().mockRejectedValue(new Error("not allowed"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(
      shareCard(card, { share, writeText } satisfies ShareDeps),
    ).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(shareCardText(card));
  });

  it("copies to the clipboard when only the clipboard exists", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareCard(card, { writeText })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable when neither API exists", async () => {
    await expect(shareCard(card, {})).resolves.toBe("unavailable");
  });

  it("reports failed when the clipboard write rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    await expect(shareCard(card, { writeText })).resolves.toBe("failed");
  });
});

describe("browserShareDeps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collects both capabilities from a navigator", () => {
    const nav = {
      share: vi.fn(),
      clipboard: { writeText: vi.fn() },
    } as unknown as Navigator;
    const deps = browserShareDeps(nav);
    expect(typeof deps.share).toBe("function");
    expect(typeof deps.writeText).toBe("function");
  });

  it("returns empty deps when the navigator lacks capabilities", () => {
    const deps = browserShareDeps({} as Navigator);
    expect(deps.share).toBeUndefined();
    expect(deps.writeText).toBeUndefined();
  });

  it("returns empty deps outside a browser", () => {
    vi.stubGlobal("navigator", undefined);
    expect(browserShareDeps()).toEqual({});
  });
});
