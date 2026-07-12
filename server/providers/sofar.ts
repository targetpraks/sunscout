import type { BeachLocation } from "./types";

export type SpotterReading = {
  observedAt: Date;
  source: string;
  waveHeightM: number | null;
  wavePeriodSeconds: number | null;
  seaTempC: number | null;
  freshness: "live" | "recent" | "stale";
};

export interface SoFarProvider {
  name: string;
  fetchSpotter(location: BeachLocation): Promise<SpotterReading>;
}

/**
 * SoFar Spotter adapter with mocked fallback. Per the PRD, no production
 * claim of Spotter verification is made until real data rights exist.
 * Deterministic values from longitude keep the demo stable.
 */
export const mockedSoFarProvider: SoFarProvider = {
  name: "sofar_demo",

  async fetchSpotter(location: BeachLocation): Promise<SpotterReading> {
    const observedAt = new Date(Date.now() - 4 * 60_000);
    const base = Math.abs(location.longitude) % 1;
    return {
      observedAt,
      source: this.name,
      waveHeightM: Math.round((0.4 + base * 0.4) * 100) / 100,
      wavePeriodSeconds: Math.round((8 + base * 3) * 10) / 10,
      seaTempC: Math.round((18 + base) * 10) / 10,
      freshness: "recent",
    };
  },
};
