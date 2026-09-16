/**
 * Near Me Now — browser geolocation hook.
 *
 * Request-driven, never on mount: the panel (and BeachMap) render on
 * Discovery and Trips as well, and a silent permission prompt on render
 * would be a UX regression. `request()` is the only entry point, matching
 * the explicit "Use my location" precedent in App.tsx and TripPlannerScreen.
 *
 * Error codes stay distinct (the panel's denial handling depends on it):
 * PERMISSION_DENIED (1) -> "denied", POSITION_UNAVAILABLE (2) ->
 * "unavailable", TIMEOUT (3) and anything else -> "error". SSR-safe: no
 * navigator access until request() is called.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeolocationStatus, NearMeOrigin } from "./types";

/** Position options: 10 s cap, allow a 5-minute cached fix. */
const GEOLOCATION_OPTIONS: PositionOptions = {
  timeout: 10_000,
  maximumAge: 300_000,
  enableHighAccuracy: false,
};

export type UseGeolocationResult = {
  /** Lifecycle of the most recent request. */
  status: GeolocationStatus;
  /** Set only after a successful fix; source is always "geolocation". */
  origin: NearMeOrigin | null;
  /** Human-readable message for the terminal failure states, null otherwise. */
  message: string | null;
  /** Trigger a geolocation request. Safe to call repeatedly. */
  request: () => void;
};

function messageFor(status: GeolocationStatus): string | null {
  switch (status) {
    case "denied":
      return "Location permission was denied — enter coordinates instead.";
    case "unavailable":
      return "Location is unavailable on this device — enter coordinates instead.";
    case "error":
      return "Could not get your location in time — try again or enter coordinates.";
    default:
      return null;
  }
}

export function useGeolocation(): UseGeolocationResult {
  const [status, setStatus] = useState<GeolocationStatus>("idle");
  const [origin, setOrigin] = useState<NearMeOrigin | null>(null);
  // Guards against late callbacks: sequence invalidates superseded requests,
  // mountedRef invalidates everything after unmount.
  const seq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      seq.current += 1;
    };
  }, []);

  const request = useCallback(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.geolocation ||
      typeof navigator.geolocation.getCurrentPosition !== "function"
    ) {
      setStatus("unavailable");
      return;
    }
    const current = ++seq.current;
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mounted.current || current !== seq.current) return;
        setOrigin({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          source: "geolocation",
        });
        setStatus("ready");
      },
      (error) => {
        if (!mounted.current || current !== seq.current) return;
        const next: GeolocationStatus =
          error.code === error.PERMISSION_DENIED
            ? "denied"
            : error.code === error.POSITION_UNAVAILABLE
              ? "unavailable"
              : "error";
        setStatus(next);
      },
      GEOLOCATION_OPTIONS,
    );
  }, []);

  return { status, origin, message: messageFor(status), request };
}
