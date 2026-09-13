/**
 * Typed registry of consumer app routes and Beach Detail sections.
 *
 * Pure data — no React imports — so it can be asserted directly in node
 * tests and reused by any surface (app shell, tests, deep-link handling).
 * Icons are referenced by key and resolved in the app shell.
 */

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
