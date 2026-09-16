/**
 * Self-registration for the consumer "What's happening" events screen —
 * mirrors src/bookings/routes.tsx. src/routes.ts owns the URL registry
 * (EVENTS_ROUTE_PATH "/events", resolveAppRoute); this module owns the lazy
 * view the app shell renders for that route, so wiring it up in App.tsx stays
 * a one-branch orchestrator merge.
 */
import { Suspense, lazy } from "react";
import type { ComponentType, ReactNode } from "react";
import { EVENTS_ROUTE_PATH } from "../routes";
import type { EventsBeachOption, EventsScreenProps } from "./EventsScreen";

export type EventsRoute = {
  id: "events-calendar";
  path: typeof EVENTS_ROUTE_PATH;
  label: string;
  description: string;
  /** Icon key resolved by the app shell — keeps this module testable. */
  iconKey: "calendar";
  /** Lazy view so importing this descriptor never pulls the screen in. */
  load: () => Promise<{ EventsScreen: ComponentType<EventsScreenProps> }>;
};

const EventsScreen = lazy(() =>
  import("./EventsScreen").then((module) => ({
    default: module.EventsScreen,
  })),
);

export const eventsRoute: EventsRoute = {
  id: "events-calendar",
  path: EVENTS_ROUTE_PATH,
  label: "Beach events calendar",
  description: "Parties, competitions and takeovers near you",
  iconKey: "calendar",
  load: () => import("./EventsScreen"),
};

export type EventsRouteViewProps = {
  /** Beaches to scan for events (the shell passes the full catalog). */
  beachCatalog: readonly EventsBeachOption[];
  onBack: () => void;
  /** Fired with a beach public id; the shell navigates to Beach Detail. */
  onOpenBeach: (beachPublicId: string) => void;
};

/**
 * Drop-in view for the app shell: renders EventsScreen inside Suspense.
 */
export function EventsRouteView({
  beachCatalog,
  onBack,
  onOpenBeach,
}: EventsRouteViewProps): ReactNode {
  return (
    <Suspense fallback={<p className="bk-empty">Loading events…</p>}>
      <EventsScreen
        beachCatalog={beachCatalog}
        onBack={onBack}
        onOpenBeach={onOpenBeach}
      />
    </Suspense>
  );
}
