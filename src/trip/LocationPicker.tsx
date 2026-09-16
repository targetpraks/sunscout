import { useState } from "react";
import { MapPin, Navigation } from "lucide-react";
import { PRESET_LOCATIONS } from "../logic";
import { parseCoordinates } from "./distance";
import type { PlannerLocation } from "./types";

/**
 * Origin picker for the trip planner: preset areas, typed GPS coordinates
 * and browser geolocation. Owns coordinate validation and the locating
 * state; every successful pick surfaces through onChange.
 */
export function LocationPicker({
  origin,
  onChange,
}: {
  origin: PlannerLocation | null;
  onChange: (origin: PlannerLocation) => void;
}) {
  const [manualCoords, setManualCoords] = useState("");
  const [coordError, setCoordError] = useState("");
  const [locating, setLocating] = useState(false);

  const pick = (place: PlannerLocation) => {
    onChange(place);
    setManualCoords("");
    setCoordError("");
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setCoordError("Location is not available on this device");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          label: "My location",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setManualCoords("");
        setCoordError("");
        setLocating(false);
      },
      () => {
        setCoordError("Could not get your location");
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  const applyManualCoords = (raw: string) => {
    const parsed = parseCoordinates(raw);
    if (!parsed) {
      setCoordError("Enter coordinates as lat, lng (e.g. 37.103, -8.674)");
      return;
    }
    onChange({ label: raw.trim(), ...parsed });
    setCoordError("");
  };

  return (
    <>
      <div className="location-row">
        <MapPin />
        <span className="location-presets">
          {PRESET_LOCATIONS.map((place) => (
            <button
              key={place.label}
              className={origin?.label === place.label ? "active" : ""}
              onClick={() => pick(place)}
            >
              {place.label}
            </button>
          ))}
          <button onClick={useMyLocation} disabled={locating}>
            <Navigation size={14} /> {locating ? "Locating…" : "My location"}
          </button>
        </span>
      </div>
      <label className="search-field">
        <input
          value={manualCoords}
          placeholder="Or enter GPS coordinates: 37.103, -8.674"
          onChange={(event) => setManualCoords(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") applyManualCoords(manualCoords);
          }}
        />
        <button
          className="secondary-button"
          onClick={() => applyManualCoords(manualCoords)}
        >
          Set pin
        </button>
      </label>
      {origin ? (
        <p className="muted">
          Staying near <strong>{origin.label}</strong> · distances are
          straight-line estimates (haversine)
        </p>
      ) : null}
      {coordError ? <p className="form-error">{coordError}</p> : null}
    </>
  );
}
