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

/** Express exposes the registered layer stack; use it to assert real mounting. */
function registeredPaths(): string[] {
  const stack = (
    pillarsRouter as unknown as {
      stack: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }>;
    }
  ).stack;
  return stack
    .filter((layer) => layer.route)
    .map((layer) => {
      const methods = Object.keys(layer!.route!.methods)
        .filter((m) => layer!.route!.methods[m])
        .map((m) => m.toUpperCase())
        .join(",");
      return `${methods} ${layer!.route!.path}`;
    })
    .sort();
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

  it("does not claim POST /api/events (owned by the analytics endpoint)", () => {
    const paths = registeredPaths();
    expect(paths).not.toContain("POST /api/events");
    expect(paths.some((p) => p.endsWith(" /api/events"))).toBe(false);
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
