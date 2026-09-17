import { MapPin } from "lucide-react";
import { useState } from "react";
import type { Beach } from "./types";
import { SponsoredRail } from "./ads/SponsoredRail";
import { HeatLayer } from "./map/HeatLayer";
import { MapLegend } from "./map/MapLegend";
import { RadiusFilter } from "./map/RadiusFilter";
import {
  buildHeatClusters,
  emitBeachTap,
  filterByRadius,
  projectBeaches,
  pulseColor,
} from "./map/pulseHeat";

/** SVG viewBox size (square) — unchanged from the pre-heat map. */
const MAP_SIZE = 320;
/** Padding between the view edge and the outermost ring in px. */
const MAP_PADDING = 28;
/** Km span from the origin to the view edge. */
const MAP_VIEW_RADIUS_KM = 60;
/** Heat grid cell size — beaches this close together share one heat disc. */
const HEAT_CELL_KM = 8;

export function BeachMap({
  origin,
  beaches,
  selectedIds,
  onSelect,
  sponsoredBeachId = null,
  onBeachSelect,
  pulseScores,
  initialRadiusKm = MAP_VIEW_RADIUS_KM,
  heatCellKm = HEAT_CELL_KM,
}: {
  origin: { label: string; latitude: number; longitude: number };
  beaches: Beach[];
  selectedIds: string[];
  onSelect: (beach: Beach) => void;
  /**
   * Beach to scope the sponsored rail to (beach public id). Null/omitted
   * renders the rail's honest empty state without a network request; App.tsx
   * owners can wire the focused beach in their own workstreams.
   */
  sponsoredBeachId?: string | null;
  /**
   * Heat-discovery emission: fired in addition to onSelect whenever a pin or
   * heat cluster is tapped, so the shell can open the existing beach-detail
   * flow without owning map internals. Optional — both App.tsx call sites
   * keep working unchanged.
   */
  onBeachSelect?: (beach: Beach) => void;
  /**
   * Live Beach Pulse score per beach id (0-100), e.g. from
   * beachPulseScores() in src/api.ts. Missing entries fall back to the
   * beach's match score; the pin fill is a pure function of this input.
   */
  pulseScores?: Record<string, number> | null;
  /** Initial distance-radius filter value in km. */
  initialRadiusKm?: number;
  /** Heat cluster grid cell size in km. */
  heatCellKm?: number;
}) {
  // Uncontrolled radius state keeps both App.tsx call sites compile-unchanged;
  // the shell can reset it by remounting or wire it up in its own workstream.
  const [radiusKm, setRadiusKm] = useState(initialRadiusKm);
  const size = MAP_SIZE;
  const center = size / 2;
  const scale = (center - MAP_PADDING) / MAP_VIEW_RADIUS_KM;

  const projected = projectBeaches(origin, beaches, {
    size,
    padding: MAP_PADDING,
    viewRadiusKm: MAP_VIEW_RADIUS_KM,
  });
  const points = filterByRadius(projected, radiusKm);
  const clusters = buildHeatClusters(points, { cellKm: heatCellKm });

  /** Deterministic pin-score input: live pulse score when present, else match. */
  const pulseScoreOf = (beach: Beach): number =>
    pulseScores?.[beach.id] ?? (Number.isFinite(beach.match) ? beach.match : 0);

  const tap = (beach: Beach) => emitBeachTap(beach, onSelect, onBeachSelect);

  const rings = [10, 25, 50];

  // Beach whose paid inventory the sponsored rail is scoped to (public id).
  // Derived from the same `beaches` prop the map already renders, so no new
  // coupling to App.tsx state.
  const sponsoredBeach =
    sponsoredBeachId == null
      ? null
      : (beaches.find((beach) => beach.id === sponsoredBeachId) ?? null);

  return (
    <>
      <RadiusFilter value={radiusKm} onChange={setRadiusKm} />
      <div
        className="beach-map"
        role="img"
        aria-label={`Beach map around ${origin.label}`}
      >
        <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%">
          {rings.map((km) => (
            <circle
              key={km}
              cx={center}
              cy={center}
              r={km * scale}
              fill="none"
              stroke="rgba(10,110,120,0.18)"
              strokeDasharray="3 4"
            />
          ))}
          {rings.map((km) => (
            <text
              key={`label-${km}`}
              x={center + 4}
              y={center - km * scale + 10}
              fill="#5A6B7A"
              fontSize="8"
            >
              {km} km
            </text>
          ))}
          <line
            x1={0}
            y1={center}
            x2={size}
            y2={center}
            stroke="rgba(15,30,46,0.06)"
          />
          <line
            x1={center}
            y1={0}
            x2={center}
            y2={size}
            stroke="rgba(15,30,46,0.06)"
          />
          {/* Crowd-density heat discs sit under the pins: background layer. */}
          <HeatLayer
            clusters={clusters}
            points={points}
            onClusterSelect={tap}
          />
          <circle cx={center} cy={center} r={6} fill="#FF6B5C" />
          <circle
            cx={center}
            cy={center}
            r={11}
            fill="none"
            stroke="#FF6B5C"
            strokeWidth={2}
            opacity={0.4}
          />
          {points.map((point) => {
            const score = pulseScoreOf(point.beach);
            const selected = selectedIds.includes(point.beach.id);
            return (
              <g
                key={point.beach.id}
                transform={`translate(${point.x}, ${point.y})`}
                onClick={() => tap(point.beach)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  data-testid="beach-pin"
                  data-beach-id={point.beach.id}
                  data-pulse-score={score}
                  r={selected ? 8 : 6}
                  fill={pulseColor(score)}
                  stroke="#FAF6F0"
                  strokeWidth={selected ? 3 : 2}
                />
                <text
                  y={-12}
                  textAnchor="middle"
                  fontSize="8"
                  fill="#0F1E2E"
                  fontWeight={600}
                >
                  {point.beach.name.split(" ").slice(-1)[0]}
                </text>
              </g>
            );
          })}
        </svg>
        <span className="beach-map-legend">
          <MapPin size={12} />
          {projected.length === 0
            ? `${origin.label} · no beaches with coordinates to plot yet`
            : points.length === 0
              ? `${origin.label} · no beaches within ${radiusKm} km`
              : `${origin.label} · showing ${points.length} beaches within ${radiusKm} km`}
        </span>
      </div>
      <MapLegend />
      {/* Sponsored rail sits OUTSIDE the role="img" container: interactive
          links inside an image role are unreachable to the a11y tree. */}
      <SponsoredRail
        beachPublicId={sponsoredBeachId}
        beachName={sponsoredBeach?.name ?? null}
      />
    </>
  );
}
