import type { BeachLocation } from "./types";

export type TideReading = {
  observedAt: Date;
  source: string;
  points: Array<{ timeLabel: string; heightM: number }>;
};

export interface TideProvider {
  name: string;
  fetchTide(location: BeachLocation): Promise<TideReading>;
}

/**
 * Mocked tide provider. Produces a deterministic semi-diurnal tide curve
 * derived from the beach longitude so every beach gets a plausible, stable
 * 24-hour series without an external licence. Swap for a licensed tide
 * provider (e.g. WorldTides / Stormglass) once access is secured.
 */
export const mockedTideProvider: TideProvider = {
  name: "tide_provider_demo",

  async fetchTide(location: BeachLocation): Promise<TideReading> {
    const observedAt = new Date();
    const phase = (location.longitude % 360) * (Math.PI / 180);
    const points = Array.from({ length: 8 }, (_, i) => {
      const hour = i * 3;
      const height = 0.9 + 0.55 * Math.sin((hour / 12) * Math.PI * 2 + phase);
      return {
        timeLabel: `${String(hour).padStart(2, "0")}:00`,
        heightM: Math.round(height * 100) / 100,
      };
    });
    return { observedAt, source: this.name, points };
  },
};
