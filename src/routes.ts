/**
 * Typed registry of consumer app routes and Beach Detail sections.
 *
 * Pure data — no React imports — so it can be asserted directly in node
 * tests and reused by any surface (app shell, tests, deep-link handling).
 * Icons are referenced by key and resolved in the app shell.
 */
import type { PulseAudience } from "./pulse/types";

export type SecondaryDestinationId = "pulse-leaderboard" | "events-calendar";

export type SecondaryDestination = {
  id: SecondaryDestinationId;
  label: string;
  description: string;
  /** Icon key resolved by the app shell — keeps this module React-free. */
  iconKey: "activity" | "calendar";
};

/** Top-level destinations reachable from the Today screen action list. */
export const secondaryDestinations: readonly SecondaryDestination[] = [
  {
    id: "pulse-leaderboard",
    label: "Beach Pulse leaderboard",
    description: "Live rankings per audience — families, solo, party & more",
    iconKey: "activity",
  },
  {
    id: "events-calendar",
    label: "Beach events calendar",
    description: "Parties, competitions and takeovers near you",
    iconKey: "calendar",
  },
];

export type BeachDetailSectionId = "pulse" | "sightings" | "events";

export type BeachDetailSection = {
  id: BeachDetailSectionId;
  label: string;
};

/** Sections rendered on Beach Detail, in order. */
export const beachDetailSections: readonly BeachDetailSection[] = [
  { id: "pulse", label: "Beach Pulse" },
  { id: "sightings", label: "Sightings" },
  { id: "events", label: "What's happening" },
];

// === URL-addressable app routes ===
//
// The app shell is state-driven (no router library); these helpers keep the
// URL in sync via pushState and give tests a React-free surface to assert
// reachability and param parsing against.

/** URL path of the per-audience Beach Pulse leaderboard. */
export const PULSE_ROUTE_PATH = "/pulse";

/** URL path of the beach events calendar. */
export const EVENTS_ROUTE_PATH = "/events";

/**
 * Audiences selectable on the /pulse route. Exactly the PulseAudience enum —
 * the scoring core is a client/server mirror, so no audience may be added or
 * removed here without desyncing the two trees.
 */
export const PULSE_AUDIENCES: readonly PulseAudience[] = [
  "family",
  "friends",
  "solo",
  "couples",
  "party",
  "chill",
];

export function isPulseAudience(value: unknown): value is PulseAudience {
  return (
    typeof value === "string" &&
    PULSE_AUDIENCES.includes(value as PulseAudience)
  );
}

/** Resolved app route for a location. `audience` is null when unspecified. */
export type AppRoute =
  | { kind: "pulse"; audience: PulseAudience | null }
  | { kind: "events" }
  | { kind: "shell" };

/** Canonical /pulse URL carrying the audience so the view is shareable. */
export function pulseRoutePath(audience: PulseAudience): string {
  return `${PULSE_ROUTE_PATH}?audience=${audience}`;
}

/**
 * Resolve a pathname (+ optional "?query" string) to an app route. Unknown
 * paths fall back to the shell — the app never 404s on its own URLs.
 */
export function resolveAppRoute(pathname: string, search = ""): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === PULSE_ROUTE_PATH) {
    const param = new URLSearchParams(search.replace(/^\?/, "")).get(
      "audience",
    );
    return {
      kind: "pulse",
      audience: isPulseAudience(param) ? param : null,
    };
  }
  if (path === EVENTS_ROUTE_PATH) return { kind: "events" };
  return { kind: "shell" };
}
