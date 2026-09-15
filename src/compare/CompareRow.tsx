/**
 * Beach compare — one beach's column of aligned metric slots.
 *
 * Every row renders the same slots in the same order (live conditions,
 * amenities, Pulse score, drive distance), so 2-3 of them side by side in
 * CompareScreen read as aligned rows. The "Add to current trip" action
 * upserts this beach into the shared draft — pure callback, no I/O.
 */

import type { CSSProperties } from "react";
import type { Beach } from "../types";
import type { PulseResult } from "../pulse/types";
import {
  amenityFlags,
  COMPARE_AMENITY_LABELS,
  type CompareAmenityFlags,
  type DriveEstimate,
} from "./types";
import ScoreColumn from "./ScoreColumn";

type Props = {
  beach: Beach;
  /** Per-audience Pulse result for this beach (null while loading). */
  pulse: PulseResult | null;
  /** True when this beach holds the highest score of the comparison. */
  isTop: boolean;
  /** Drive estimate from the user's origin — null when no origin is set. */
  drive: DriveEstimate | null;
  /** True when the beach is already in the current trip draft. */
  inTrip: boolean;
  /** True while the add action is in flight. */
  adding?: boolean;
  /** Disabled when the draft is being committed to the server. */
  commitBusy?: boolean;
  onAddToTrip: (beach: Beach) => void;
};

const CARD_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "12px 12px 16px",
  borderRadius: "16px",
  border: "1px solid #0F1E2E14",
  backgroundColor: "#FAF6F0",
  minWidth: "220px",
  flex: "1 1 0",
  color: "#0F1E2E",
};

const SLOT_LIST_STYLE: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontSize: "13px",
};

const SLOT_LABEL_STYLE: CSSProperties = {
  opacity: 0.6,
  marginRight: "6px",
};

const SECTION_TITLE_STYLE: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  opacity: 0.55,
};

function Slot({ label, value }: { label: string; value: string }) {
  return (
    <li>
      <span style={SLOT_LABEL_STYLE}>{label}</span>
      <span>{value}</span>
    </li>
  );
}

function AmenitySlot({ flags }: { flags: CompareAmenityFlags }) {
  return (
    <li>
      <span style={SLOT_LABEL_STYLE}>
        {Object.values(COMPARE_AMENITY_LABELS).join(" / ")}
      </span>
      <span>
        {(
          Object.keys(COMPARE_AMENITY_LABELS) as Array<
            keyof CompareAmenityFlags
          >
        )
          .map(
            (key) =>
              `${COMPARE_AMENITY_LABELS[key]}: ${flags[key] ? "Yes" : "No"}`,
          )
          .join(" · ")}
      </span>
    </li>
  );
}

/**
 * One beach column. Conditions render from the live display strings on the
 * DTO ("—" when a signal is missing — the server's own missing marker);
 * the Pulse score comes from the client-side scoring core via CompareScreen.
 */
export default function CompareRow({
  beach,
  pulse,
  isTop,
  drive,
  inTrip,
  adding = false,
  commitBusy = false,
  onAddToTrip,
}: Props) {
  const flags = amenityFlags(beach);
  const driveLabel = drive
    ? `${drive.distanceKm} km · ${drive.driveMinutes} min drive`
    : "—";

  return (
    <article style={CARD_STYLE} aria-label={`Compare ${beach.name}`}>
      <header>
        <strong>{beach.name}</strong>
        <p style={{ margin: "2px 0 0", fontSize: "12px", opacity: 0.65 }}>
          {beach.location}
        </p>
      </header>

      <h4 style={SECTION_TITLE_STYLE}>Live conditions</h4>
      <ul style={SLOT_LIST_STYLE}>
        <Slot label="Air" value={beach.airTemp ?? "—"} />
        <Slot label="Water" value={beach.seaTemp} />
        <Slot label="Wind" value={beach.windSpeed ?? "—"} />
        <Slot label="Waves" value={beach.waves} />
        <Slot label="Water quality" value={beach.waterQuality} />
      </ul>

      <h4 style={SECTION_TITLE_STYLE}>Amenities</h4>
      <ul style={SLOT_LIST_STYLE}>
        <AmenitySlot flags={flags} />
      </ul>

      <h4 style={SECTION_TITLE_STYLE}>Beach Pulse</h4>
      {pulse ? (
        <ScoreColumn
          score={pulse.score}
          audience={pulse.audience}
          staleConditions={pulse.staleConditions}
          isTop={isTop}
          beachName={beach.name}
        />
      ) : (
        <ScoreColumn score={0} loading beachName={beach.name} />
      )}

      <h4 style={SECTION_TITLE_STYLE}>Distance</h4>
      <ul style={SLOT_LIST_STYLE}>
        <Slot label="Drive from you" value={driveLabel} />
      </ul>

      <button
        type="button"
        disabled={inTrip || adding || commitBusy}
        onClick={() => onAddToTrip(beach)}
        style={{
          marginTop: "auto",
          padding: "10px 12px",
          borderRadius: "10px",
          border: `1px solid ${inTrip ? "#2E8B6B" : "#0A6E78"}`,
          backgroundColor: inTrip ? "#2E8B6B1A" : "#0A6E78",
          color: inTrip ? "#2E8B6B" : "#FAF6F0",
          fontWeight: 600,
          cursor: inTrip || adding || commitBusy ? "default" : "pointer",
        }}
        aria-label={inTrip ? `${beach.name} added to current trip` : undefined}
      >
        {inTrip ? "Added to trip" : adding ? "Adding…" : "Add to current trip"}
      </button>
    </article>
  );
}
