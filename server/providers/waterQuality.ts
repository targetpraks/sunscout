import type { BeachLocation } from "./types";

export type WaterQualityReading = {
  observedAt: Date;
  source: string;
  state: "excellent" | "good" | "advisory" | "closed" | "unknown";
  blueFlagEligible: boolean;
};

export interface WaterQualityProvider {
  name: string;
  fetchWaterQuality(location: BeachLocation): Promise<WaterQualityReading>;
}

/**
 * Mocked water-quality provider. Deterministic from latitude so seeded
 * beaches keep a stable classification. Replace with a Blue Flag / national
 * authority adapter once data rights are cleared.
 */
export const mockedWaterQualityProvider: WaterQualityProvider = {
  name: "water_quality_demo",

  async fetchWaterQuality(
    location: BeachLocation,
  ): Promise<WaterQualityReading> {
    const observedAt = new Date();
    const excellent = Math.abs(location.latitude - 37.09) < 0.05;
    return {
      observedAt,
      source: this.name,
      state: excellent ? "excellent" : "good",
      blueFlagEligible: excellent,
    };
  },
};
