import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Beach } from "../types";
import { BeachMap } from "../BeachMap";
import { beachPulseScores } from "../api";
import {
  HEAT_MAX_OPACITY,
  HEAT_MIN_OPACITY,
  PULSE_TIER_COLORS,
  buildHeatClusters,
  crowdOpacity,
  emitBeachTap,
  filterByRadius,
  heatRadius,
  projectBeaches,
  pulseColor,
  pulseTier,
} from "./pulseHeat";
import type { MapOrigin } from "./types";

const NOW = new Date("2026-09-17T12:00:00Z");
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

const ORIGIN: MapOrigin = { label: "Lagos", latitude: 37.0, longitude: 9.0 };
const KM_PER_DEG_LAT = 111;
const kmToLng = (xKm: number) =>
  ORIGIN.longitude +
  xKm / (KM_PER_DEG_LAT * Math.cos((ORIGIN.latitude * Math.PI) / 180));
const kmToLat = (yKm: number) => ORIGIN.latitude + yKm / KM_PER_DEG_LAT;

const PROJECT = { size: 320, padding: 28, viewRadiusKm: 60 };

/** Minimal but fully-typed Beach row; overrides pin down the fixture. */
function makeBeach(overrides: Partial<Beach> = {}): Beach {
  return {
    id: "b-1",
    name: "Fixture Beach",
    location: "Algarve",
    image: "",
    decision: "",
    match: 50,
    drive: "",
    distance: "",
    seaTemp: "",
    waves: "",
    uv: "",
    crowd: 30,
    waterQuality: "",
    goldenHour: "",
    vibes: [],
    suitability: [],
    amenities: [],
    available: { sunbeds: 0, umbrellas: 0, clubs: 0 },
    ...overrides,
  };
}

/** Beach at a km offset from ORIGIN (equirectangular inverse projection). */
function beachAtKm(
  id: string,
  xKm: number,
  yKm: number,
  overrides: Partial<Beach> = {},
): Beach {
  return makeBeach({
    id,
    name: `Beach ${id}`,
    latitude: kmToLat(yKm),
    longitude: kmToLng(xKm),
    ...overrides,
  });
}

/** Extract the fill color of one beach pin from rendered map HTML. */
function pinFillOf(html: string, beachId: string): string | null {
  const match = new RegExp(`<circle[^>]*data-beach-id="${beachId}"[^>]*>`).exec(
    html,
  );
  if (!match) return null;
  const fill = /fill="(#[0-9A-Fa-f]{6})"/.exec(match[0]);
  return fill ? fill[1] : null;
}

describe("pulseHeat — pulse tier ladder and pin color", () => {
  it("uses the same boundaries as the Pulse leaderboard badge tiers", () => {
    expect(pulseTier(100)).toBe("great");
    expect(pulseTier(75)).toBe("great");
    expect(pulseTier(74)).toBe("good");
    expect(pulseTier(55)).toBe("good");
    expect(pulseTier(54)).toBe("fair");
    expect(pulseTier(35)).toBe("fair");
    expect(pulseTier(34)).toBe("poor");
    expect(pulseTier(0)).toBe("poor");
  });

  it("maps pin color deterministically, flipping at tier boundaries", () => {
    expect(pulseColor(90)).toBe(PULSE_TIER_COLORS.great);
    expect(pulseColor(90)).toBe(pulseColor(90));
    expect(pulseColor(74)).toBe(PULSE_TIER_COLORS.good);
    expect(pulseColor(75)).toBe(PULSE_TIER_COLORS.great);
    expect(pulseColor(54)).toBe(PULSE_TIER_COLORS.fair);
    expect(pulseColor(55)).toBe(PULSE_TIER_COLORS.good);
    expect(pulseColor(34)).toBe(PULSE_TIER_COLORS.poor);
    expect(pulseColor(35)).toBe(PULSE_TIER_COLORS.fair);
  });
});

describe("pulseHeat — crowd heat scaling", () => {
  it("maps crowd percent monotonically onto a clamped opacity band", () => {
    expect(crowdOpacity(0)).toBe(HEAT_MIN_OPACITY);
    expect(crowdOpacity(100)).toBe(HEAT_MAX_OPACITY);
    expect(crowdOpacity(-5)).toBe(HEAT_MIN_OPACITY);
    expect(crowdOpacity(150)).toBe(HEAT_MAX_OPACITY);
    expect(crowdOpacity(50)).toBeGreaterThan(HEAT_MIN_OPACITY);
    expect(crowdOpacity(50)).toBeLessThan(HEAT_MAX_OPACITY);
    expect(crowdOpacity(80)).toBeGreaterThan(crowdOpacity(20));
  });

  it("grows heat radius with cluster size and caps it", () => {
    expect(heatRadius(1)).toBe(16);
    expect(heatRadius(3)).toBe(24);
    expect(heatRadius(10)).toBeLessThanOrEqual(34);
    expect(heatRadius(1000)).toBe(34);
  });
});

describe("pulseHeat — projection, radius filter and clustering", () => {
  it("projects km offsets deterministically onto the pixel grid", () => {
    const points = projectBeaches(
      ORIGIN,
      [beachAtKm("b-east", 10, 0), beachAtKm("b-north", 0, 10)],
      PROJECT,
    );
    expect(points).toHaveLength(2);
    const east = points.find((p) => p.beach.id === "b-east");
    const north = points.find((p) => p.beach.id === "b-north");
    expect(east?.x).toBeGreaterThan(PROJECT.size / 2);
    expect(east?.y).toBeCloseTo(PROJECT.size / 2, 5);
    expect(north?.y).toBeLessThan(PROJECT.size / 2);
    expect(east?.distanceKm).toBeCloseTo(10, 5);
  });

  it("skips beaches without coordinates", () => {
    const points = projectBeaches(
      ORIGIN,
      [makeBeach({ id: "b-nogeo", latitude: undefined, longitude: undefined })],
      PROJECT,
    );
    expect(points).toHaveLength(0);
  });

  it("filters by radius and passes everything through on null", () => {
    const points = projectBeaches(
      ORIGIN,
      [beachAtKm("b-near", 5, 0), beachAtKm("b-far", 30, 0)],
      PROJECT,
    );
    expect(filterByRadius(points, null)).toHaveLength(2);
    const near = filterByRadius(points, 10);
    expect(near.map((p) => p.beach.id)).toEqual(["b-near"]);
  });

  it("bins nearby beaches into one cluster and averages crowd honestly", () => {
    const points = projectBeaches(
      ORIGIN,
      [
        beachAtKm("b-a", 4, 4, { crowd: 40 }),
        beachAtKm("b-b", 6, 6, { crowd: 60 }),
        beachAtKm("b-c", 15, 4, { crowd: 20 }),
      ],
      PROJECT,
    );
    const clusters = buildHeatClusters(points, { cellKm: 10 });
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.key).sort()).toEqual(["0:0", "1:0"]);
    const merged = clusters.find((c) => c.key === "0:0");
    expect(merged?.count).toBe(2);
    expect(merged?.beachIds.sort()).toEqual(["b-a", "b-b"]);
    expect(merged?.avgCrowd).toBe(50);
  });

  it("reports null avgCrowd when no member has a finite crowd value", () => {
    const points = projectBeaches(
      ORIGIN,
      [beachAtKm("b-a", 4, 4, { crowd: Number.NaN })],
      PROJECT,
    );
    const clusters = buildHeatClusters(points, { cellKm: 10 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].avgCrowd).toBeNull();
  });

  it("focuses a cluster on the busiest member, lowest id on ties", () => {
    const points = projectBeaches(
      ORIGIN,
      [
        beachAtKm("b-z", 4, 4, { crowd: 10 }),
        beachAtKm("b-m", 5, 5, { crowd: 80 }),
        beachAtKm("b-a", 6, 6, { crowd: 80 }),
        beachAtKm("b-tie", 15, 4, { crowd: 50 }),
        beachAtKm("b-tie2", 16, 4, { crowd: 50 }),
      ],
      PROJECT,
    );
    const clusters = buildHeatClusters(points, { cellKm: 10 });
    const busy = clusters.find((c) => c.key === "0:0");
    const tie = clusters.find((c) => c.key === "1:0");
    expect(busy?.focusBeachId).toBe("b-a");
    expect(tie?.focusBeachId).toBe("b-tie");
  });

  it("is deterministic — same input, same output", () => {
    const beaches = [
      beachAtKm("b-a", 4, 4, { crowd: 40 }),
      beachAtKm("b-b", 15, -9, { crowd: 70 }),
    ];
    const points = projectBeaches(ORIGIN, beaches, PROJECT);
    const first = buildHeatClusters(points, { cellKm: 8 });
    const second = buildHeatClusters(projectBeaches(ORIGIN, beaches, PROJECT), {
      cellKm: 8,
    });
    expect(first).toEqual(second);
  });
});

describe("pulseHeat — tap dispatch contract", () => {
  it("fires onSelect always and onBeachSelect in addition when provided", () => {
    const beach = makeBeach();
    const onSelect = vi.fn();
    const onBeachSelect = vi.fn();
    emitBeachTap(beach, onSelect, onBeachSelect);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(beach);
    expect(onBeachSelect).toHaveBeenCalledTimes(1);
    expect(onBeachSelect).toHaveBeenCalledWith(beach);
  });

  it("never throws when the onBeachSelect alias is absent", () => {
    const beach = makeBeach();
    const onSelect = vi.fn();
    emitBeachTap(beach, onSelect, undefined);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("api — beachPulseScores over seeded beach+condition fixtures", () => {
  const calm = makeBeach({
    id: "b-calm",
    name: "Calm Cove",
    waves: "0.3 m",
    wind: "8 km/h",
    windSpeed: "8",
    seaTemp: "23°C",
    airTemp: "26°C",
    uv: "5",
    cloudCover: "10%",
    crowd: 25,
    provenance: { observedAt: hoursAgo(1) },
  });
  const rough = makeBeach({
    id: "b-rough",
    name: "Rough Point",
    waves: "2.5 m",
    wind: "45 km/h",
    windSpeed: "45",
    seaTemp: "16°C",
    airTemp: "14°C",
    uv: "1",
    cloudCover: "90%",
    crowd: 95,
    provenance: { observedAt: hoursAgo(1) },
  });

  it("scores every beach finitely and ranks calm conditions above rough ones", () => {
    const scores = beachPulseScores([calm, rough], "family", NOW);
    expect(Object.keys(scores).sort()).toEqual(["b-calm", "b-rough"]);
    for (const score of Object.values(scores)) {
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
    expect(scores["b-calm"]).toBeGreaterThan(scores["b-rough"]);
  });

  it("feeds the map's deterministic pin colors through the score input", () => {
    const scores = beachPulseScores([calm, rough], "family", NOW);
    // Calm conditions land fair-or-better; rough conditions land poor — and
    // the two inputs never collapse onto the same pin color.
    expect(["fair", "good", "great"]).toContain(pulseTier(scores["b-calm"]));
    expect(pulseTier(scores["b-rough"])).toBe("poor");
    expect(pulseColor(scores["b-calm"])).not.toBe(
      pulseColor(scores["b-rough"]),
    );
  });
});

describe("BeachMap render — heat layer, legend, radius filter", () => {
  const near = beachAtKm("b-great", 4, 4, {
    name: "Great Sands",
    crowd: 70,
    match: 90,
  });
  const far = beachAtKm("b-poor", 12, -8, {
    name: "Poor Shingle",
    crowd: 20,
    match: 10,
  });

  function renderMap(props: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      createElement(BeachMap, {
        origin: ORIGIN,
        beaches: [near, far],
        selectedIds: [],
        onSelect: () => undefined,
        ...props,
      }),
    );
  }

  it("renders the HeatLayer, MapLegend and RadiusFilter together", () => {
    const html = renderMap();
    expect(html).toContain('data-testid="heat-layer"');
    expect(html).toContain('data-testid="map-legend"');
    expect(html).toContain('data-testid="radius-filter"');
  });

  it("renders one heat disc per populated cluster", () => {
    const html = renderMap();
    expect(html).toContain('data-testid="heat-cluster"');
    // 4 km / 12 km offsets land in distinct 8 km cells -> two discs.
    expect(html.match(/data-testid="heat-cluster"/g)?.length).toBe(2);
  });

  it("colors pins by the pulse score input, deterministically", () => {
    const html = renderMap({
      pulseScores: { "b-great": 90, "b-poor": 10 },
    });
    expect(pinFillOf(html, "b-great")).toBe(PULSE_TIER_COLORS.great);
    expect(pinFillOf(html, "b-poor")).toBe(PULSE_TIER_COLORS.poor);
    expect(html).toContain('data-pulse-score="90"');
  });

  it("falls back to the beach match score when no pulse scores are passed", () => {
    const html = renderMap();
    expect(pinFillOf(html, "b-great")).toBe(PULSE_TIER_COLORS.great);
    expect(pinFillOf(html, "b-poor")).toBe(PULSE_TIER_COLORS.poor);
  });

  it("changes pin color deterministically when the score input changes", () => {
    const before = renderMap({ pulseScores: { "b-great": 90 } });
    const after = renderMap({ pulseScores: { "b-great": 20 } });
    expect(pinFillOf(before, "b-great")).toBe(PULSE_TIER_COLORS.great);
    expect(pinFillOf(after, "b-great")).toBe(PULSE_TIER_COLORS.poor);
  });

  it("hides beaches outside the initial radius filter value", () => {
    // b-poor sits ~14.4 km out (12,-8) — outside a 10 km radius.
    const html = renderMap({ initialRadiusKm: 10 });
    expect(html).toContain('data-beach-id="b-great"');
    expect(html).not.toContain('data-beach-id="b-poor"');
    expect(html).toContain("within 10 km");
  });

  it("renders an honest empty state when the radius excludes everything", () => {
    const html = renderMap({ initialRadiusKm: 10, beaches: [far] });
    expect(html).not.toContain('data-beach-id="b-poor"');
    expect(html).toContain("no beaches within 10 km");
  });
});
