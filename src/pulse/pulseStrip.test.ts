import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PulseStrip, topFactors } from "./PulseStrip";
import {
  catalogToPulseInputs,
  fetchBeachPulse,
  parseDisplayNumber,
  pulseInputFromCatalogRow,
  type PulseBeachRow,
} from "./api";
import { rankByPulse } from "./scoring";
import { BeachCommunitySection } from "../community/BeachCommunitySection";
import type { BeachPulseEntry } from "./api";
import type { PulseBreakdown } from "./types";

const NOW = new Date("2026-09-16T12:00:00Z");

const breakdown: PulseBreakdown = {
  conditions: 88,
  community: 40,
  activity: 60,
  vibe: 70,
  freshness: 1,
  conditionFreshness: 1,
  liveNow: 1.05,
};

const entry: BeachPulseEntry = {
  id: "cove",
  audience: "family",
  score: 61,
  confidence: 0.8,
  staleConditions: false,
  conditionAgeH: 1,
  lastSignalAgeH: 1,
  lastLiveSignalAgeH: 1,
  breakdown,
  label: "Families",
};

describe("topFactors", () => {
  it("returns the two highest sub-scores, highest first", () => {
    const factors = topFactors(breakdown, 2);
    expect(factors).toHaveLength(2);
    expect(factors[0]).toEqual({
      key: "conditions",
      label: "Live conditions",
      score: 88,
    });
    expect(factors[1]).toEqual({
      key: "vibe",
      label: "Vibe votes",
      score: 70,
    });
  });

  it("rounds sub-scores to integers", () => {
    const factors = topFactors(
      {
        ...breakdown,
        conditions: 87.6,
        community: 62.4,
        activity: 10,
        vibe: 20,
      },
      2,
    );
    expect(factors[0].score).toBe(88);
    expect(factors[1].score).toBe(62);
  });

  it("is deterministic on equal scores: conditions before community", () => {
    const factors = topFactors(
      { ...breakdown, conditions: 50, community: 50, activity: 50, vibe: 50 },
      4,
    );
    expect(factors.map((factor) => factor.key)).toEqual([
      "conditions",
      "community",
      "activity",
      "vibe",
    ]);
  });
});

describe("parseDisplayNumber", () => {
  it("extracts the leading number from display strings", () => {
    expect(parseDisplayNumber("19°C")).toBe(19);
    expect(parseDisplayNumber("0.4m")).toBe(0.4);
    expect(parseDisplayNumber("6 High")).toBe(6);
    expect(parseDisplayNumber("12 km/h")).toBe(12);
  });

  it("passes finite numbers through and rejects everything else", () => {
    expect(parseDisplayNumber(42)).toBe(42);
    expect(parseDisplayNumber(null)).toBeNull();
    expect(parseDisplayNumber("")).toBeNull();
    expect(parseDisplayNumber("no digits")).toBeNull();
    expect(parseDisplayNumber(Number.NaN)).toBeNull();
  });
});

describe("catalog row mapping", () => {
  it("maps display strings onto nullable condition signals", () => {
    const row: PulseBeachRow = {
      id: "cove",
      name: "Calm Cove",
      waves: "0.3m",
      windSpeed: "8 km/h",
      seaTemp: "23°C",
      airTemp: "26°C",
      uv: "5 High",
      cloudCover: "10%",
      crowd: 25,
      provenance: { observedAt: NOW.toISOString() },
    };
    expect(pulseInputFromCatalogRow(row)).toEqual({
      id: "cove",
      name: "Calm Cove",
      conditions: {
        observedAt: NOW.toISOString(),
        waveM: 0.3,
        windKmh: 8,
        waterTempC: 23,
        airTempC: 26,
        uvIndex: 5,
        crowdPct: 25,
        cloudPct: 10,
      },
    });
  });

  it("keeps unparseable signals null so scorer defaults apply", () => {
    const input = pulseInputFromCatalogRow({ id: "x", name: "X" });
    expect(input.conditions?.waveM).toBeNull();
    expect(input.conditions?.observedAt).toBe("");
  });
});

describe("per-audience reshuffle (scoring.ts weights)", () => {
  // The exact data path PulseLeaderboardScreen uses: catalog rows →
  // PulseInputs → rankByPulse. Calm Cove is a family dream; Bay is a
  // packed party beach. The same two rows must flip order between
  // audiences — this is the acceptance criterion for re-ranking.
  const rows: PulseBeachRow[] = [
    {
      id: "cove",
      name: "Calm Cove",
      waves: "0.3m",
      windSpeed: "8 km/h",
      seaTemp: "23°C",
      airTemp: "26°C",
      uv: "5 High",
      cloudCover: "10%",
      crowd: 25,
      provenance: { observedAt: NOW.toISOString() },
    },
    {
      id: "bay",
      name: "Party Bay",
      waves: "1.0m",
      windSpeed: "18 km/h",
      seaTemp: "24°C",
      airTemp: "30°C",
      uv: "8 Very high",
      cloudCover: "10%",
      crowd: 90,
      provenance: { observedAt: NOW.toISOString() },
    },
  ];
  const inputs = catalogToPulseInputs(rows);

  const orderFor = (audience: "family" | "party") =>
    rankByPulse(inputs, { audience, now: NOW }).map((result) => result.id);

  it("ranks the calm beach first for families", () => {
    expect(orderFor("family")).toEqual(["cove", "bay"]);
  });

  it("reshuffles to the packed beach first for party", () => {
    expect(orderFor("party")).toEqual(["bay", "cove"]);
  });

  it("re-ranks without mutating the input order", () => {
    orderFor("party");
    expect(inputs.map((input) => input.id)).toEqual(["cove", "bay"]);
  });
});

describe("PulseStrip — rendered output (static markup)", () => {
  it("renders an honest loading state before data arrives", () => {
    const markup = renderToStaticMarkup(
      createElement(PulseStrip, { beachId: "cove" }),
    );
    expect(markup).toContain("Beach Pulse");
    expect(markup).toContain("Loading the live Beach Pulse");
    expect(markup).toContain('aria-busy="true"');
  });

  it("renders an honest error state with a retry action", () => {
    const markup = renderToStaticMarkup(
      createElement(PulseStrip, { beachId: "cove", initialError: "api_500" }),
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("api_500");
    expect(markup).toContain("Retry");
  });

  it("renders the numeric score and the top 2 contributing factors", () => {
    const markup = renderToStaticMarkup(
      createElement(PulseStrip, {
        beachId: "cove",
        audience: "family",
        initialEntry: entry,
      }),
    );
    expect(markup).toContain('data-pulse-score="61"');
    expect(markup).toContain("Live conditions");
    expect(markup).toContain("88");
    expect(markup).toContain("Vibe votes");
    expect(markup).toContain("70");
    expect(markup).not.toContain("Community signals");
  });

  it("says which audience the score is for", () => {
    const markup = renderToStaticMarkup(
      createElement(PulseStrip, {
        beachId: "cove",
        audience: "family",
        initialEntry: entry,
      }),
    );
    expect(markup).toContain("Families");
  });
});

describe("BeachCommunitySection mounts the strip", () => {
  it("renders the Beach Pulse strip above the vibe bar", () => {
    const markup = renderToStaticMarkup(
      createElement(BeachCommunitySection, {
        beachId: "cove",
        beach: { suitability: [{ id: "families" }] },
      }),
    );
    // PulseStrip heading + its loading state (effects don't run in a
    // static render, so the strip is still in its honest loading phase).
    expect(markup).toContain("Beach Pulse");
    expect(markup.indexOf("Beach Pulse")).toBeLessThan(
      markup.indexOf("Beach vibe"),
    );
  });
});

describe("pulse api", () => {
  it("fetches the per-beach pulse for all audiences", async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ ...entry }],
        meta: { now: NOW.toISOString() },
      }),
    };
    const fetchMock = vi.fn(
      async (_path: string, _init?: RequestInit) =>
        response as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const data = await fetchBeachPulse("cove");
    expect(data).toHaveLength(1);
    expect(data[0].audience).toBe("family");
    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname.endsWith("/beaches/cove/pulse")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
