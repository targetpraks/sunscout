import { ChevronDown, ChevronRight, Waves } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { tideData } from "./data";
import { daytimeLowest, tideExtrema } from "./tide";
import type { TidePoint } from "./types";

export function TidePanel({
  points,
  expanded,
  onToggle,
}: {
  points: TidePoint[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const data = points.length ? points : tideData;
  const extrema = tideExtrema(data);
  const lowest = daytimeLowest(data) ?? data[0];
  const startIdx = Math.max(
    0,
    data.findIndex((p) => p.time === lowest.time) - 1,
  );
  const endIdx = Math.min(data.length - 1, startIdx + 2);
  const windowEnd = data[endIdx]?.time ?? data[data.length - 1].time;
  const beachWidthMeters = Math.round(Math.max(8, 26 - lowest.level * 10));
  return (
    <section className={`tide-panel ${expanded ? "expanded" : ""}`}>
      <button className="section-heading tide-heading" onClick={onToggle}>
        <span className="heading-group">
          <Waves />
          <strong>Tide · Today</strong>
        </span>
        <span className="sandcastle">
          Best sandcastle window
          <strong>
            {lowest.time}–{windowEnd}
          </strong>
        </span>
        <span className="collapse-button">
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </span>
      </button>
      <div className="tide-chart" role="img" aria-label="Today's tide chart">
        <ResponsiveContainer width="100%" height={expanded ? 124 : 72}>
          <AreaChart
            data={data}
            margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} stroke="transparent" />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#5A6B7A", fontSize: 10 }}
              interval={1}
            />
            <YAxis
              hide
              domain={[0, Math.max(1.6, ...data.map((p) => p.level))]}
            />
            <ReferenceArea
              x1={lowest.time}
              x2={windowEnd}
              fill="#0A6E78"
              fillOpacity={0.08}
              stroke="#0A6E78"
              strokeDasharray="4 4"
            />
            <Area
              type="monotone"
              dataKey="level"
              stroke="#0A6E78"
              strokeWidth={2}
              fill="#0A6E78"
              fillOpacity={0.06}
              dot={{ r: 4, fill: "#0A6E78", strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={!reduceMotion}
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="tide-labels" aria-hidden="true">
          {extrema.slice(0, 4).map((point) => (
            <span key={point.time}>
              {point.time}
              <br />
              <b>
                {point.kind === "low" ? "Low" : "High"} ·{" "}
                {point.level.toFixed(1)} m
              </b>
            </span>
          ))}
        </div>
        {expanded ? (
          <p className="chart-note">
            All times WEST (UTC+1). Dry beach width near the daytime low: ~
            {beachWidthMeters} m. Source: tide_provider_demo.
          </p>
        ) : null}
      </div>
    </section>
  );
}
