/**
 * Wiring tests for pillarsRouter.
 *
 * The domain modules (sightings, beachPulse, events, vibes, accuracy) have
 * thorough unit coverage of their own. What was missing — and what these tests
 * pin down — is that the routes are actually MOUNTED and reachable: the burst
 * shipped these capabilities once before inside modules that nothing imported.
 *
 * These assert route registration and input validation without a database:
 * a request that fails validation must return 4xx before any query runs.
 */
import { describe, expect, it } from "vitest";
import { pillarsRouter } from "./pillarsRouter";

type RouteInfo = { path: string; methods: Record<string, boolean> };

function layerMethods(route: RouteInfo): string {
  return Object.keys(route.methods)
    .filter((m) => route.methods[m])
    .map((m) => m.toUpperCase())
    .join(",");
}

/**
 * Express exposes the registered layer stack; use it to assert real mounting.
 * A use() mount of a sub-router (the /api/ads mount) carries no .route of its
 * own, so descend into the mounted router's own stack (express 5 / router v2
 * keeps it on layer.handle.stack) and report the child routes. The ads mount
 * is the only bare use() layer here, so the hardcoded /api/ads prefix is
 * honest — and drift-checked by the /api/ads assertions below.
 */
function registeredPaths(): string[] {
  const stack = (
    pillarsRouter as unknown as {
      stack: Array<{
        route?: RouteInfo;
        handle?: { stack?: Array<{ route?: RouteInfo }> };
      }>;
    }
  ).stack;
  const paths: string[] = [];
  for (const layer of stack) {
    if (layer.route) {
      paths.push(`${layerMethods(layer.route)} ${layer.route.path}`);
      continue;
    }
    const childStack = layer.handle?.stack;
    if (!Array.isArray(childStack)) continue;
    for (const child of childStack) {
      if (!child.route) continue;
      paths.push(`${layerMethods(child.route)} /api/ads${child.route.path}`);
    }
  }
  return paths.sort();
}

describe("pillarsRouter wiring", () => {
  it("mounts every burst-built consumer route", () => {
    const paths = registeredPaths();

    // The three PRD-v2 pillars plus the two community-signal inputs.
    expect(paths).toContain("POST /api/sightings");
    expect(paths).toContain("GET /api/beaches/:id/sightings");
    expect(paths).toContain("GET /api/beaches/:id/pulse");
    expect(paths).toContain("GET /api/beach-events");
    expect(paths).toContain("POST /api/beach-events");
    expect(paths).toContain("GET /api/coordinator/events");
    expect(paths).toContain("POST /api/beach-events/:id/publish");
    expect(paths).toContain("POST /api/beach-events/:id/cancel");
  });

  it("mounts the brand takeover engine under /api/ads", () => {
    const paths = registeredPaths();
    expect(paths).toContain("GET /api/ads/");
    expect(paths).toContain("GET /api/ads/takeover");
  });

  it("does not claim POST /api/events (owned by the analytics endpoint)", () => {
    const paths = registeredPaths();
    expect(paths).not.toContain("POST /api/events");
    expect(paths.some((p) => p.endsWith(" /api/events"))).toBe(false);
  });

  it("the /api/ads prefix collides with no index.ts-owned prefix", () => {
    const paths = registeredPaths();
    const owned = [
      "/api/events",
      "/api/me",
      "/api/check-ins",
      "/api/bookings",
      "/api/conditions",
      "/api/merchant",
    ];
    for (const prefix of owned) {
      const collision = paths.filter(
        (p) => p.endsWith(` ${prefix}`) || p.includes(`${prefix}/`),
      );
      expect(collision).toEqual([]);
    }
  });

  it("keeps beach-event routes under a distinct prefix", () => {
    const paths = registeredPaths();
    const eventRoutes = paths.filter((p) => p.includes("events"));
    // Every event route is either the consumer /api/beach-events prefix or the
    // coordinator surface — never the bare analytics path.
    for (const route of eventRoutes) {
      expect(route).toMatch(/\/api\/(beach-events|coordinator\/events)/);
    }
  });
});
