import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  MapPin,
  Navigation,
  Plus,
  Sunrise,
} from "lucide-react";
import { fetchBeaches, createTrip } from "../api";
import { beaches as fallbackBeaches } from "../data";
import { ACTIVITY_OPTIONS, PRESET_LOCATIONS } from "../logic";
import type { Beach } from "../types";
import { PLANNER_AUDIENCES, planBeaches } from "./distance";
import {
  PLANNER_OPEN_BEACH_KEY,
  type PlannerAudience,
  type PlannerLocation,
} from "./types";

const tomorrow = () =>
  new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);

/** Server trip schema caps beach picks at 10 (see tripSchema in server/index.ts). */
const TRIP_MAX_BEACHES = 10;

/**
 * Open the beach detail screen hosted inside the App shell: hand the beach id
 * over via sessionStorage (consumed by the App shell bridge) and leave the
 * planner hash route so the shell remounts.
 */
function openBeachDetail(beachId: string) {
  try {
    sessionStorage.setItem(PLANNER_OPEN_BEACH_KEY, beachId);
  } catch {
    /* storage unavailable — detail screen simply won't auto-open */
  }
  window.location.hash = "";
}

export function TripPlannerScreen() {
  const [beachCatalog, setBeachCatalog] = useState<Beach[]>(fallbackBeaches);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [origin, setOrigin] = useState<PlannerLocation | null>(
    PRESET_LOCATIONS[0] ?? null,
  );
  const [manualCoords, setManualCoords] = useState("");
  const [coordError, setCoordError] = useState("");
  const [locating, setLocating] = useState(false);
  const [audience, setAudience] = useState<PlannerAudience | "">("");
  const [activities, setActivities] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("Beach run from my stay");
  const [startsOn, setStartsOn] = useState(tomorrow);
  const [endsOn, setEndsOn] = useState(tomorrow);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // A stale handoff key from a previous planner visit must not open a beach.
    try {
      sessionStorage.removeItem(PLANNER_OPEN_BEACH_KEY);
    } catch {
      /* storage unavailable */
    }
    let cancelled = false;
    setLoading(true);
    fetchBeaches()
      .then((beaches) => {
        if (cancelled) return;
        if (beaches.length) setBeachCatalog(beaches);
        setLoadError("");
      })
      .catch(() => {
        if (!cancelled) setLoadError("Live beach data is unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setCoordError("Location is not available on this device");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({
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
    const parts = raw.split(",").map((part) => Number.parseFloat(part.trim()));
    if (
      parts.length !== 2 ||
      parts.some((value) => Number.isNaN(value)) ||
      parts[0] < -90 ||
      parts[0] > 90 ||
      parts[1] < -180 ||
      parts[1] > 180
    ) {
      setCoordError("Enter coordinates as lat, lng (e.g. 37.103, -8.674)");
      return;
    }
    setOrigin({
      label: raw.trim(),
      latitude: parts[0],
      longitude: parts[1],
    });
    setCoordError("");
  };

  const planned = useMemo(
    () => planBeaches(beachCatalog, origin, { audience, activities }),
    [beachCatalog, origin, audience, activities],
  );

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= TRIP_MAX_BEACHES) {
        setMessage(`Trips can hold at most ${TRIP_MAX_BEACHES} beaches`);
        return current;
      }
      return [...current, id];
    });

  const saveTrip = async () => {
    if (submitting || !selected.length || !name.trim()) return;
    setSubmitting(true);
    setMessage("");
    try {
      await createTrip({
        name: name.trim(),
        startsOn,
        endsOn,
        beachPublicIds: selected,
        locationLabel: origin?.label,
        latitude: origin?.latitude,
        longitude: origin?.longitude,
      });
      setSelected([]);
      setMessage("Trip saved — see it under My Trips in the app.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "Could not save trip",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="detail-screen">
      <header className="app-header compact">
        <div className="header-row">
          <button
            className="icon-button"
            onClick={() => {
              window.location.hash = "";
            }}
            aria-label="Back to SunScout"
          >
            <ArrowLeft />
          </button>
          <div className="brand" aria-label="SunScout">
            <span className="brand-mark">
              <Sunrise />
            </span>
            <span>SunScout</span>
          </div>
        </div>
      </header>
      <main className="screen-content trips-screen">
        <div className="screen-title trip-title">
          <span>
            <h1>Plan from where you stay</h1>
            <p>
              Drop a pin or pick a town — every beach nearby, sorted by real
              walk and drive distance.
            </p>
          </span>
        </div>

        <div className="location-row">
          <MapPin />
          <span className="location-presets">
            {PRESET_LOCATIONS.map((place) => (
              <button
                key={place.label}
                className={origin?.label === place.label ? "active" : ""}
                onClick={() => {
                  setOrigin(place);
                  setManualCoords("");
                  setCoordError("");
                }}
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
        {loadError ? <p className="form-error">{loadError}</p> : null}

        <div className="filter-group">
          <small>Who's going</small>
          <div className="filter-row">
            <button
              className={audience === "" ? "active" : ""}
              onClick={() => setAudience("")}
            >
              Anyone
            </button>
            {PLANNER_AUDIENCES.map((option) => (
              <button
                key={option.id}
                className={audience === option.id ? "active" : ""}
                onClick={() => setAudience(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <small>What the group feels like doing</small>
          <div className="filter-row">
            {ACTIVITY_OPTIONS.map((option) => (
              <button
                key={option}
                className={activities.includes(option) ? "active" : ""}
                onClick={() =>
                  setActivities((current) =>
                    current.includes(option)
                      ? current.filter((item) => item !== option)
                      : [...current, option],
                  )
                }
              >
                {option.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="trip-picker">
          <strong>
            {loading
              ? "Loading beaches…"
              : `Beaches near ${origin?.label ?? "you"} (${planned.length})`}
          </strong>
          {!loading && planned.length === 0 ? (
            <div className="empty-state">
              <h2>No beaches match</h2>
              <p>Try clearing the audience or activity filters.</p>
            </div>
          ) : null}
          {planned.map(({ beach, travel }) => {
            const isSelected = selected.includes(beach.id);
            return (
              <article className="result-row" key={beach.id}>
                <button
                  className="result-main"
                  onClick={() => openBeachDetail(beach.id)}
                >
                  <img src={beach.image} alt="" />
                  <span className="result-copy">
                    <span className="result-topline">
                      <strong>{beach.name}</strong>
                    </span>
                    <span>{beach.decision}</span>
                    <small className="result-meta">
                      {travel
                        ? `Walk ${travel.walkMinutes} min · ${travel.walkDistanceKm} km — Drive ${travel.driveMinutes} min · ${travel.driveDistanceKm} km`
                        : `${beach.drive} · ${beach.distance} · straight-line distance unavailable`}
                    </small>
                  </span>
                </button>
                <button
                  className={`result-save ${isSelected ? "saved" : ""}`}
                  onClick={() => toggleSelected(beach.id)}
                  aria-label={
                    isSelected
                      ? `Remove ${beach.name} from trip`
                      : `Add ${beach.name} to trip`
                  }
                >
                  {isSelected ? <Check /> : <Plus />}
                </button>
              </article>
            );
          })}
        </div>

        <div className="trip-date-grid">
          <label className="trip-field">
            <span>Trip name</span>
            <input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="trip-field">
            <span>Starts</span>
            <input
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </label>
          <label className="trip-field">
            <span>Ends</span>
            <input
              type="date"
              min={startsOn}
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
            />
          </label>
        </div>
        {message ? <p className="form-error">{message}</p> : null}
        {loadError ? (
          <p className="muted">
            Live data is offline, so beach picks can't be saved to your trips.
            Reconnect and try again.
          </p>
        ) : null}
        <button
          className="primary-button sheet-primary"
          disabled={
            submitting || !selected.length || !name.trim() || Boolean(loadError)
          }
          onClick={saveTrip}
        >
          {submitting
            ? "Saving trip…"
            : `Save trip · ${selected.length} beach${selected.length === 1 ? "" : "es"}`}
        </button>
      </main>
    </div>
  );
}
