import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Sunrise } from "lucide-react";
import { fetchBeaches, createTrip } from "../api";
import { beaches as fallbackBeaches } from "../data";
import { ACTIVITY_OPTIONS, PRESET_LOCATIONS } from "../logic";
import type { Beach } from "../types";
import { BeachDistanceRow } from "./BeachDistanceRow";
import { PLANNER_AUDIENCES, planBeaches } from "./distance";
import { LocationPicker } from "./LocationPicker";
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

        <LocationPicker origin={origin} onChange={setOrigin} />
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
          {planned.map((entry) => (
            <BeachDistanceRow
              key={entry.beach.id}
              planned={entry}
              selected={selected.includes(entry.beach.id)}
              onOpen={openBeachDetail}
              onToggle={toggleSelected}
            />
          ))}
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
