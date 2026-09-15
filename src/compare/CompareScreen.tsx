/**
 * Beach compare — main screen.
 *
 * Pick 2-3 beaches from the wishlist and/or search, see them side by side
 * with aligned live-condition, amenity, Beach Pulse and drive-distance rows,
 * and add any of them to the current trip. Pure composition over the
 * helpers in ./types, the client pulse scoring core (../pulse, imported
 * only) and the API wrappers in ./api.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Beach } from "../types";
import { computePulse, AUDIENCE_LABELS } from "../pulse/scoring";
import type { PulseAudience, PulseResult } from "../pulse/types";
import { PRESET_LOCATIONS } from "../logic";
import CompareRow from "./CompareRow";
import { commitTripDraft, fetchCompareCatalog, fetchWishlistIds } from "./api";
import {
  driveEstimate,
  filterByQuery,
  MAX_COMPARE_BEACHES,
  MIN_COMPARE_BEACHES,
  toPulseInput,
  topScoreIds,
  upsertBeachInDraft,
  type Origin,
  type TripDraft,
} from "./types";

const SCREEN_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  padding: "16px",
  fontFamily: "inherit",
  color: "#0F1E2E",
};

const GRID_STYLE: CSSProperties = {
  display: "flex",
  gap: "12px",
  overflowX: "auto",
  alignItems: "stretch",
};

const PICKER_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  margin: 0,
  padding: 0,
  listStyle: "none",
  maxHeight: "180px",
  overflowY: "auto",
};

const BANNER_STYLE: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "12px",
  textAlign: "center",
};

const AUDIENCES: PulseAudience[] = [
  "family",
  "friends",
  "solo",
  "couples",
  "party",
  "chill",
];

type LoadState = "loading" | "error" | "ready";

/**
 * Compare screen. Fetches the live catalog + wishlist once, computes the
 * per-audience Pulse client-side (the audience selector re-scores instantly,
 * no refetch), and enforces the 2-3 selection bound.
 */
export default function CompareScreen({
  onToast,
}: {
  /** Optional shell toast — kept optional so tests can render standalone. */
  onToast?: (message: string) => void;
}) {
  const [catalog, setCatalog] = useState<Beach[]>([]);
  const [wishlistIds, setWishlistIds] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<PulseAudience>("family");
  const [origin, setOrigin] = useState<Origin | null>(
    PRESET_LOCATIONS[0] ?? null,
  );
  const [draft, setDraft] = useState<TripDraft | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const reloadRef = useRef(0);

  const load = useCallback(() => {
    setLoadState("loading");
    setLoadError("");
    const attempt = reloadRef.current;
    Promise.all([fetchCompareCatalog(origin), fetchWishlistIds()])
      .then(([beaches, saved]) => {
        if (reloadRef.current !== attempt) return;
        setCatalog(beaches);
        setWishlistIds(saved);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (reloadRef.current !== attempt) return;
        setLoadError(
          error instanceof Error
            ? error.message.replaceAll("_", " ")
            : "Could not load beaches",
        );
        setLoadState("error");
      });
  }, [origin]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSelected = (beachId: string) => {
    setSelectedIds((current) => {
      if (current.includes(beachId))
        return current.filter((id) => id !== beachId);
      if (current.length >= MAX_COMPARE_BEACHES) return current;
      return [...current, beachId];
    });
  };

  const addToTrip = (beach: Beach) => {
    setDraft((current) =>
      upsertBeachInDraft(
        current ?? { name: "Compare picks", beachIds: [] },
        beach.id,
      ),
    );
    setAddedIds((current) =>
      current.includes(beach.id) ? current : [...current, beach.id],
    );
    setCommitError("");
  };

  const commit = async () => {
    if (!draft || !draft.beachIds.length || committing) return;
    setCommitting(true);
    setCommitError("");
    try {
      await commitTripDraft(draft, origin);
      setCommitError("");
      onToast?.("Trip saved with your compare picks");
      setDraft(null);
    } catch (error: unknown) {
      setCommitError(
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "Could not save trip",
      );
    } finally {
      setCommitting(false);
    }
  };

  const byId = useMemo(() => {
    const map = new Map<string, Beach>();
    for (const beach of catalog) map.set(beach.id, beach);
    return map;
  }, [catalog]);

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => byId.get(id))
        .filter((beach): beach is Beach => Boolean(beach)),
    [selectedIds, byId],
  );

  const pulses = useMemo(() => {
    const map = new Map<string, PulseResult>();
    for (const beach of selected) {
      map.set(
        beach.id,
        computePulse(toPulseInput(beach), {
          audience,
          now: new Date(),
        }),
      );
    }
    return map;
  }, [selected, audience]);

  const topIds = useMemo(
    () =>
      topScoreIds(
        [...pulses.entries()].map(([id, result]) => ({
          id,
          score: result.score,
        })),
      ),
    [pulses],
  );

  const wishlist = useMemo(() => {
    const saved = wishlistIds
      .map((id) => byId.get(id))
      .filter((beach): beach is Beach => Boolean(beach));
    return filterByQuery(saved, query);
  }, [wishlistIds, byId, query]);

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    return filterByQuery(catalog, query).filter(
      (beach) => !wishlistIds.includes(beach.id),
    );
  }, [catalog, query, wishlistIds]);

  if (loadState === "loading") {
    return (
      <section style={SCREEN_STYLE} aria-busy="true" aria-label="Beach compare">
        <h2>Compare beaches</h2>
        <div
          style={{ ...BANNER_STYLE, backgroundColor: "#0F1E2E0D" }}
          aria-live="polite"
        >
          <p style={{ margin: 0 }}>Loading live beach data…</p>
        </div>
      </section>
    );
  }

  if (loadState === "error") {
    return (
      <section style={SCREEN_STYLE} role="alert" aria-label="Beach compare">
        <h2>Compare beaches</h2>
        <div style={{ ...BANNER_STYLE, backgroundColor: "#FF6B5C1A" }}>
          <p style={{ margin: "0 0 10px", fontWeight: 600 }}>
            Couldn’t load beaches to compare.
          </p>
          <p style={{ margin: "0 0 12px", fontSize: "13px", opacity: 0.8 }}>
            {loadError}
          </p>
          <button
            type="button"
            onClick={load}
            style={{
              padding: "8px 18px",
              borderRadius: "8px",
              border: "1px solid #0A6E78",
              backgroundColor: "#0A6E78",
              color: "#FAF6F0",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section style={SCREEN_STYLE} aria-label="Beach compare">
      <header>
        <h2 style={{ margin: "0 0 2px" }}>Compare beaches</h2>
        <p style={{ margin: 0, fontSize: "13px", opacity: 0.7 }}>
          Pick {MIN_COMPARE_BEACHES}–{MAX_COMPARE_BEACHES} beaches from your
          wishlist or search — conditions, amenities, Beach Pulse and drive
          time, side by side.
        </p>
      </header>

      <div>
        <label
          htmlFor="compare-origin"
          style={{ display: "block", fontSize: "12px", opacity: 0.7 }}
        >
          Where are you staying?
        </label>
        <select
          id="compare-origin"
          value={origin?.label ?? ""}
          onChange={(event) => {
            const place = PRESET_LOCATIONS.find(
              (item) => item.label === event.target.value,
            );
            setOrigin(place ?? null);
          }}
        >
          {PRESET_LOCATIONS.map((place) => (
            <option key={place.label} value={place.label}>
              {place.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="compare-audience"
          style={{ display: "block", fontSize: "12px", opacity: 0.7 }}
        >
          Pulse audience
        </label>
        <select
          id="compare-audience"
          value={audience}
          onChange={(event) => setAudience(event.target.value as PulseAudience)}
        >
          {AUDIENCES.map((value) => (
            <option key={value} value={value}>
              {AUDIENCE_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="compare-search"
          style={{ display: "block", fontSize: "12px", opacity: 0.7 }}
        >
          Add beaches ({selectedIds.length}/{MAX_COMPARE_BEACHES})
        </label>
        <input
          id="compare-search"
          type="search"
          placeholder="Search beaches by name or area"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div>
        <h4 style={{ ...BANNER_STYLE, fontSize: "12px", textAlign: "left" }}>
          From your wishlist
        </h4>
        {wishlist.length ? (
          <ul style={PICKER_STYLE}>
            {wishlist.map((beach) => (
              <li key={beach.id}>
                <button
                  type="button"
                  className={selectedIds.includes(beach.id) ? "active" : ""}
                  onClick={() => toggleSelected(beach.id)}
                >
                  {beach.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: "13px", opacity: 0.7 }}>
            {query
              ? "No saved beaches match that search."
              : "No saved beaches yet — search below instead."}
          </p>
        )}
      </div>

      {searchResults.length ? (
        <div>
          <h4 style={{ ...BANNER_STYLE, fontSize: "12px", textAlign: "left" }}>
            From search
          </h4>
          <ul style={PICKER_STYLE}>
            {searchResults.map((beach) => (
              <li key={beach.id}>
                <button
                  type="button"
                  className={selectedIds.includes(beach.id) ? "active" : ""}
                  onClick={() => toggleSelected(beach.id)}
                >
                  {beach.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {selected.length ? (
        <div style={GRID_STYLE}>
          {selected.map((beach) => (
            <CompareRow
              key={beach.id}
              beach={beach}
              pulse={pulses.get(beach.id) ?? null}
              isTop={topIds.includes(beach.id)}
              drive={driveEstimate(origin, beach)}
              inTrip={addedIds.includes(beach.id)}
              commitBusy={committing}
              onAddToTrip={addToTrip}
            />
          ))}
        </div>
      ) : (
        <div style={{ ...BANNER_STYLE, backgroundColor: "#0F1E2E0D" }}>
          <p style={{ margin: 0 }}>
            Select at least {MIN_COMPARE_BEACHES} beaches to compare.
          </p>
        </div>
      )}

      {draft && draft.beachIds.length ? (
        <div>
          <button
            type="button"
            disabled={committing}
            onClick={commit}
            style={{
              padding: "10px 16px",
              borderRadius: "10px",
              border: "1px solid #0A6E78",
              backgroundColor: "#0A6E78",
              color: "#FAF6F0",
              fontWeight: 600,
              cursor: committing ? "default" : "pointer",
            }}
          >
            {committing
              ? "Saving trip…"
              : `Save trip with ${draft.beachIds.length} beach${draft.beachIds.length === 1 ? "" : "es"}`}
          </button>
          <p style={{ margin: "6px 0 0", fontSize: "12px", opacity: 0.7 }}>
            Rows add to a draft trip, saved once through the existing
            create-trip endpoint — no duplicate trips.
          </p>
        </div>
      ) : null}

      {commitError ? (
        <p role="alert" style={{ margin: 0, color: "#FF6B5C" }}>
          {commitError}
        </p>
      ) : null}
    </section>
  );
}
