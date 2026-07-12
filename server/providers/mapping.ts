import type { BeachLocation } from "./types";

export type TravelEstimate = {
  source: string;
  driveMinutes: number;
  distanceKm: number;
};

export interface MappingProvider {
  name: string;
  estimateTravel(
    origin: BeachLocation,
    destination: BeachLocation,
  ): TravelEstimate;
}

/**
 * Mocked mapping/travel-time provider using a haversine distance and a
 * conservative average speed. Replace with a Mapbox/OSRM adapter once the
 * mapping provider is selected.
 */
export const mockedMappingProvider: MappingProvider = {
  name: "mapping_demo",

  estimateTravel(
    origin: BeachLocation,
    destination: BeachLocation,
  ): TravelEstimate {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const radiusKm = 6371;
    const dLat = toRad(destination.latitude - origin.latitude);
    const dLng = toRad(destination.longitude - origin.longitude);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(origin.latitude)) *
        Math.cos(toRad(destination.latitude)) *
        Math.sin(dLng / 2) ** 2;
    const distanceKm =
      Math.round(2 * radiusKm * Math.asin(Math.sqrt(a)) * 10) / 10;
    const driveMinutes = Math.max(5, Math.round(distanceKm / 0.55));
    return { source: this.name, driveMinutes, distanceKm };
  },
};
