import { MapPin } from "lucide-react";
import type { Beach } from "./types";

type Origin = { label: string; latitude: number; longitude: number };

function kmBetween(
  origin: Origin,
  lat: number,
  lng: number,
): { xKm: number; yKm: number } {
  const cosLat = Math.cos((origin.latitude * Math.PI) / 180);
  return {
    xKm: (lng - origin.longitude) * cosLat * 111,
    yKm: (lat - origin.latitude) * 111,
  };
}

export function BeachMap({
  origin,
  beaches,
  selectedIds,
  onSelect,
}: {
  origin: Origin;
  beaches: Beach[];
  selectedIds: string[];
  onSelect: (beach: Beach) => void;
}) {
  const size = 320;
  const center = size / 2;
  const radiusKm = 60;
  const scale = (center - 28) / radiusKm;

  const points = beaches
    .filter((beach) => beach.latitude != null && beach.longitude != null)
    .map((beach) => {
      const { xKm, yKm } = kmBetween(
        origin,
        beach.latitude as number,
        beach.longitude as number,
      );
      return {
        beach,
        x: center + xKm * scale,
        y: center - yKm * scale,
        distanceKm: Math.sqrt(xKm * xKm + yKm * yKm),
      };
    })
    .filter((point) => point.distanceKm <= radiusKm + 5);

  const rings = [10, 25, 50];

  return (
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
        {points.map((point) => (
          <g
            key={point.beach.id}
            transform={`translate(${point.x}, ${point.y})`}
            onClick={() => onSelect(point.beach)}
            style={{ cursor: "pointer" }}
          >
            <circle
              r={selectedIds.includes(point.beach.id) ? 8 : 6}
              fill={
                selectedIds.includes(point.beach.id) ? "#0A6E78" : "#2E8B6B"
              }
              stroke="#FAF6F0"
              strokeWidth={2}
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
        ))}
      </svg>
      <span className="beach-map-legend">
        <MapPin size={12} /> {origin.label} · showing {points.length} beaches
        within {radiusKm} km
      </span>
    </div>
  );
}
