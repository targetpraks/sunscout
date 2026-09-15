/**
 * Beach compare — self-contained /compare route registration.
 *
 * Pure data + lazy component reference, structured to drop into the
 * src/routes.ts registry with a one-line orchestrator merge:
 *
 *   import { compareDestination } from "./compare/routes";
 *   // add to secondaryDestinations (or the shell's route switch):
 *   compareDestination
 *
 * The iconKey union in src/routes.ts may need widening to include
 * "compare" — that edit belongs to the orchestrator (hotspot file), not
 * this branch, which owns only src/compare/.
 */

import { lazy } from "react";
import type { ComponentType } from "react";

export const COMPARE_ROUTE_PATH = "/compare" as const;

export type CompareRoute = {
  path: typeof COMPARE_ROUTE_PATH;
  label: string;
  description: string;
  /** Resolved by the app shell — keeps this module testable. */
  iconKey: "compare";
  /** Lazy so the compare bundle splits out of the initial Today payload. */
  component: ComponentType;
};

/** Lazy reference to the compare screen; import-only, never edited inline. */
const CompareScreen = lazy(
  () => import("./CompareScreen"),
) as unknown as ComponentType;

export const compareDestination: CompareRoute = {
  path: COMPARE_ROUTE_PATH,
  label: "Compare beaches",
  description:
    "Put 2–3 beaches side by side — live conditions, amenities, Beach Pulse and drive time",
  iconKey: "compare",
  component: CompareScreen,
};
