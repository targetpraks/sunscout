import { MapPin, PartyPopper, Sunrise, Ticket, Waves } from "lucide-react";
import type { ComponentType } from "react";
import type { DayPlan, DayPlanItemKind } from "./types";

/**
 * Per-kind icons for the timeline stops. All lucide names already imported
 * elsewhere in the app (BeachMap, events, bookings) — no new icon surface.
 */
const KIND_ICONS: Record<DayPlanItemKind, ComponentType> = {
  arrival: MapPin,
  tide: Waves,
  event: PartyPopper,
  "golden-hour": Sunrise,
  booking: Ticket,
};

/**
 * TripDayTimeline — the presentational ordered stop list of the timed Beach
 * Day itinerary. Renders exactly the items the day-plan engine produced
 * (already time-ordered); it never re-sorts or re-composes, so what the
 * server sequenced is what the consumer sees.
 *
 * Honesty rule: an empty plan renders an explicit empty state, never
 * invented stops.
 */
export function TripDayTimeline({ plan }: { plan: DayPlan }) {
  if (!plan.items.length) {
    return (
      <p className="chart-note" role="status">
        No plan yet — no live tide, event, golden-hour or booking data for the
        rest of today.
      </p>
    );
  }
  return (
    <ol className="tripday-timeline" aria-label="Timed beach day plan">
      {plan.items.map((item) => {
        const Icon = KIND_ICONS[item.kind] ?? MapPin;
        return (
          <li key={item.id} className={`tripday-stop tripday-${item.kind}`}>
            <span className="tripday-time" aria-label="Time window">
              {item.startTime}–{item.endTime}
            </span>
            <span className="tripday-icon" aria-hidden="true">
              <Icon />
            </span>
            <span className="tripday-body">
              <strong>{item.label}</strong>
              {item.detail ? <span>{item.detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default TripDayTimeline;
