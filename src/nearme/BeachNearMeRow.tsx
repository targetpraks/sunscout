/**
 * Near Me Now — one ranked beach row.
 *
 * Presentational, pure props: name, walk/drive estimates, a live condition
 * badge and the right-now Beach Pulse score, all from the NearMeBeach the
 * ranking core produced. Standalone by convention (mirrors src/pulse):
 * imports only from this folder, ../pulse and ../types. Styled inline
 * (styles.css is not part of this workstream's owned files) against the
 * brand palette documented in AGENTS.md.
 */

import type { CSSProperties } from "react";
import { CarFront, Footprints, Waves } from "lucide-react";
import PulseBadge from "../pulse/PulseBadge";
import type { NearMeBeach } from "./types";

type Props = {
  item: NearMeBeach;
  /** Optional click-through — wired to the parent map's beach selection. */
  onSelect?: (beach: NearMeBeach["beach"]) => void;
};

const shellStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--line, #E3DDD3)",
  borderRadius: 12,
  backgroundColor: "rgba(10, 110, 120, 0.03)",
  fontFamily: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

const nameBlockStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
  flex: "1 1 auto",
};

const nameStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: "#0F1E2E",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const regionStyle: CSSProperties = {
  fontSize: 12,
  color: "#5A6B7A",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const travelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  fontSize: 12,
  color: "#5A6B7A",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

const travelRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const badgeWrapStyle: CSSProperties = {
  flex: "0 0 auto",
};

/** Compact live-condition badge: the headline signal from the condition row. */
function ConditionBadge({ item }: { item: NearMeBeach }) {
  const beach = item.beach;
  const waves = beach.waves?.trim();
  if (!waves) return null;
  const shell: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    borderRadius: 999,
    backgroundColor: "rgba(46, 139, 107, 0.12)",
    border: "1px solid rgba(46, 139, 107, 0.35)",
    fontSize: 12,
    fontWeight: 600,
    color: "#0F1E2E",
    whiteSpace: "nowrap",
  };
  return (
    <span
      className="nearme-condition-badge"
      style={shell}
      title={`Live: waves ${waves}${beach.wind ? `, wind ${beach.wind}` : ""}${
        beach.uv ? `, UV ${beach.uv}` : ""
      }`}
    >
      <Waves size={12} aria-hidden="true" /> {waves}
    </span>
  );
}

/** Walk/drive summary line: walking only inside ~30 min; drive beyond that. */
function travelLine(item: NearMeBeach): string {
  const { walkMinutes, driveMinutes } = item.travel;
  if (walkMinutes <= 30) {
    return `Walk ${walkMinutes} min · Drive ${driveMinutes} min`;
  }
  return `Drive ${driveMinutes} min`;
}

export default function BeachNearMeRow({ item, onSelect }: Props) {
  const beach = item.beach;
  const label = `${beach.name} — ${travelLine(item)}, ${item.distanceKm} km away, right-now score ${item.pulseScore}`;

  return (
    <li>
      <button
        type="button"
        className="nearme-beach-row"
        style={shellStyle}
        aria-label={label}
        onClick={() => onSelect?.(beach)}
      >
        <span style={nameBlockStyle}>
          <span style={nameStyle}>{beach.name}</span>
          <span style={regionStyle}>
            {item.distanceKm} km · {beach.location}
          </span>
        </span>
        <span style={travelStyle}>
          <span style={travelRowStyle}>
            <Footprints size={12} aria-hidden="true" />
            {item.travel.walkMinutes} min walk
          </span>
          <span style={travelRowStyle}>
            <CarFront size={12} aria-hidden="true" />
            {item.travel.driveMinutes} min drive
          </span>
        </span>
        <ConditionBadge item={item} />
        <span style={badgeWrapStyle}>
          <PulseBadge
            score={item.pulseScore}
            staleConditions={item.staleConditions}
            className="nearme-pulse"
          />
        </span>
      </button>
    </li>
  );
}
