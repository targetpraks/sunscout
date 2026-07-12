export type BeachLocation = {
  id: number;
  slug: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type ConditionReading = {
  observedAt: Date;
  source: string;
  seaTempC: number | null;
  waveHeightM: number | null;
  uvIndex: number | null;
  goldenHourStart: Date | null;
  goldenHourEnd: Date | null;
  raw: Record<string, unknown>;
};

export interface ConditionsProvider {
  name: string;
  fetchCurrent(location: BeachLocation): Promise<ConditionReading>;
}
