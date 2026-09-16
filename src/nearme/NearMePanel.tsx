/**
 * Near Me Now — geospatial beach picker panel rendered from BeachMap.
 *
 * One glance answers "the right beach right now, within a practical drive":
 * tap "Use my location" (browser geolocation), fall back to manual coordinates
 * when permission is denied or the device has no fix, then see every beach in
 * the 60 km view sorted by distance blended with the right-now Beach Pulse —
 * each row with walk/drive estimates, a live condition badge and its pulse
 * score.
 *
 * States handled explicitly — loading, empty, permission-denied, no geolocation
 * support, request timeout, zero matches — none of them crash. Standalone by
 * convention (mirrors src/pulse): imports only from this folder, ../pulse and
 * ../types; never from shared shell files. Styled inline (styles.css is not
 * part of this workstream's owned files) against the brand palette in
 * AGENTS.md.
 */

import { useMemo, useState, type CSSProperties } from "react";
import { Compass, LocateFixed, Search } from "lucide-react";
import { useGeolocation } from "./useGeolocation";
import {
  DEFAULT_NEAR_ME_AUDIENCE,
  NEAR_ME_RADIUS_KM,
  rankNearMeBeaches,
} from "./nearMe";
import BeachNearMeRow from "./BeachNearMeRow";
import type { Beach } from "../types";
import type { NearMeAudience, NearMeOrigin } from "./types";

type Props = {
  /** Beach catalog already rendered on the parent map (from /api/beaches). */
  beaches: Beach[];
  /** Optional click-through — wired to the parent map's beach selection. */
  onSelect?: (beach: Beach) => void;
  /**
   * Audience the right-now score is computed for. Defaults to the near-me
   * module default ("family") — the product's primary audience per AGENTS.md.
   */
  audience?: NearMeAudience;
};

const shellStyle: CSSProperties = {
  margin: "8px 18px 10px",
  padding: "10px 12px",
  border: "1px solid var(--line, #E3DDD3)",
  borderRadius: 14,
  backgroundColor: "rgba(250, 246, 240, 0.85)",
};

const headingStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 14,
  fontWeight: 700,
  color: "#0F1E2E",
};

const subStyle: CSSProperties = {
  fontSize: 12,
  color: "#5A6B7A",
  margin: "4px 0 8px",
};

const buttonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  borderRadius: 999,
  border: "1px solid #0A6E78",
  backgroundColor: "#0A6E78",
  color: "#FAF6F0",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const buttonSecondaryStyle: CSSProperties = {
  ...buttonStyle,
  padding: "8px 12px",
  backgroundColor: "rgba(10, 110, 120, 0.06)",
  color: "#0A6E78",
};

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid var(--line, #E3DDD3)",
  fontFamily: "inherit",
  fontSize: 13,
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

const manualGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr auto",
  gap: 8,
  alignItems: "center",
  marginTop: 10,
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: "10px 0 0",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const messageStyle: CSSProperties = {
  fontSize: 13,
  color: "#8B4A4A",
  margin: "8px 0 0",
};

function formatOrigin(origin: NearMeOrigin): string {
  return `${origin.latitude.toFixed(4)}, ${origin.longitude.toFixed(4)}`;
}

/**
 * Parse manual coordinates. Null (with a reason) on anything that is not a
 * finite lat in [-90, 90] and lng in [-180, 180] — never a NaN leak into the
 * haversine math.
 */
function parseManualOrigin(
  latText: string,
  lngText: string,
): { origin: NearMeOrigin } | { error: string } {
  const lat = Number.parseFloat(latText.trim());
  const lng = Number.parseFloat(lngText.trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: "Enter latitude and longitude as numbers." };
  }
  if (lat < -90 || lat > 90) {
    return { error: "Latitude must be between -90 and 90." };
  }
  if (lng < -180 || lng > 180) {
    return { error: "Longitude must be between -180 and 180." };
  }
  return { origin: { latitude: lat, longitude: lng, source: "manual" } };
}

export function NearMePanel({ beaches, onSelect, audience }: Props) {
  const { status, origin, message, request } = useGeolocation();
  const [manualOrigin, setManualOrigin] = useState<NearMeOrigin | null>(null);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  // A fresh geolocation fix takes precedence; the manual entry fills in
  // whenever the hook has no origin (denied, unavailable, never requested).
  const activeOrigin: NearMeOrigin | null = origin ?? manualOrigin;

  const ranked = useMemo(
    () =>
      activeOrigin == null
        ? []
        : rankNearMeBeaches(
            beaches,
            activeOrigin,
            audience ?? DEFAULT_NEAR_ME_AUDIENCE,
          ),
    [beaches, activeOrigin, audience],
  );

  const applyManual = () => {
    const parsed = parseManualOrigin(manualLat, manualLng);
    if ("error" in parsed) {
      setManualError(parsed.error);
      return;
    }
    setManualError(null);
    setManualOrigin(parsed.origin);
  };

  const showManual =
    status === "denied" || status === "unavailable" || manualOrigin !== null;

  return (
    <section
      className="nearme-panel"
      style={shellStyle}
      aria-label="Near me now"
    >
      <span style={headingStyle}>
        <Compass size={15} aria-hidden="true" /> Near me now
      </span>
      <p style={subStyle}>
        The right beach right now, within {NEAR_ME_RADIUS_KM} km — distance
        blended with the live Beach Pulse score.
      </p>

      <button
        type="button"
        style={buttonStyle}
        onClick={request}
        disabled={status === "locating"}
      >
        <LocateFixed size={14} aria-hidden="true" />
        {status === "locating" ? "Locating…" : "Use my location"}
      </button>

      {message != null ? (
        <p style={messageStyle} role="alert">
          {message}
        </p>
      ) : null}

      {showManual ? (
        <div style={manualGridStyle}>
          <input
            style={inputStyle}
            type="text"
            inputMode="decimal"
            placeholder="Latitude (e.g. 37.0896)"
            aria-label="Latitude"
            value={manualLat}
            onChange={(event) => setManualLat(event.target.value)}
          />
          <input
            style={inputStyle}
            type="text"
            inputMode="decimal"
            placeholder="Longitude (e.g. -8.3478)"
            aria-label="Longitude"
            value={manualLng}
            onChange={(event) => setManualLng(event.target.value)}
          />
          <button
            type="button"
            style={buttonSecondaryStyle}
            onClick={applyManual}
          >
            <Search size={13} aria-hidden="true" /> Go
          </button>
        </div>
      ) : null}

      {manualError != null ? (
        <p style={messageStyle} role="alert">
          {manualError}
        </p>
      ) : null}

      {status === "locating" ? (
        <p style={subStyle} role="status">
          Finding beaches near you…
        </p>
      ) : null}

      {activeOrigin == null ? null : ranked.length === 0 ? (
        <p style={subStyle} role="status">
          No beaches within {NEAR_ME_RADIUS_KM} km of{" "}
          {formatOrigin(activeOrigin)} right now. Try another location.
        </p>
      ) : (
        <>
          <p style={subStyle}>
            {activeOrigin.source === "geolocation"
              ? "Your location"
              : "Chosen location"}{" "}
            · {formatOrigin(activeOrigin)} · {ranked.length}{" "}
            {ranked.length === 1 ? "beach" : "beaches"} nearby, best right-now
            first
          </p>
          <ul style={listStyle}>
            {ranked.map((item) => (
              <BeachNearMeRow
                key={item.beach.id}
                item={item}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default NearMePanel;
