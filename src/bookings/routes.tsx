/**
 * Self-registration for the My Bookings screen.
 *
 * The app has no path router: src/routes.ts is a pure-data registry consumed
 * by the app shell (state-driven screen switching). This module exposes the
 * bookings route as the same kind of descriptor, plus a lazy-loaded view, so
 * that wiring it up in src/routes.ts + App.tsx is a one-line orchestrator
 * merge (HOTSPOT — this worktree does not own those files).
 */
import { Suspense, lazy, type ComponentType, type ReactNode } from "react";

export type BookingsRoute = {
  id: "my-bookings";
  path: "/bookings";
  label: string;
  description: string;
  /** Icon key resolved by the app shell — keeps this module testable. */
  iconKey: "ticket";
  /** Lazy view so importing this descriptor never pulls the screens in. */
  load: () => Promise<{
    default: ComponentType<{
      onBack: () => void;
      onToast: (message: string) => void;
    }>;
  }>;
};

const MyBookingsScreen = lazy(() =>
  import("./MyBookingsScreen").then((module) => ({
    default: module.MyBookingsScreen,
  })),
);

export const bookingsRoute: BookingsRoute = {
  id: "my-bookings",
  path: "/bookings",
  label: "My bookings",
  description:
    "Upcoming and past reservations, cancel with refund preview, receipts",
  iconKey: "ticket",
  load: () => import("./MyBookingsScreen"),
};

/**
 * Drop-in view for the app shell: renders MyBookingsScreen inside Suspense.
 * The orchestrator merges one screen branch into App.tsx using this.
 */
export function BookingsRouteView({
  onBack,
  onToast,
}: {
  onBack: () => void;
  onToast: (message: string) => void;
}): ReactNode {
  return (
    <Suspense fallback={<p className="bk-empty">Loading bookings…</p>}>
      <MyBookingsScreen onBack={onBack} onToast={onToast} />
    </Suspense>
  );
}
