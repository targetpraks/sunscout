import { describe, expect, it } from "vitest";
import {
  EVENTS_ROUTE_PATH,
  PULSE_ROUTE_PATH,
  beachDetailSections,
  isPulseAudience,
  pulseRoutePath,
  resolveAppRoute,
  secondaryDestinations,
} from "./routes";

describe("app route registry", () => {
  it("contains navigation entries for the Pulse leaderboard and Events calendar", () => {
    const ids = secondaryDestinations.map((destination) => destination.id);
    expect(ids).toContain("pulse-leaderboard");
    expect(ids).toContain("events-calendar");
  });

  it("gives every secondary destination a label, description and icon key", () => {
    for (const destination of secondaryDestinations) {
      expect(destination.label.trim().length).toBeGreaterThan(0);
      expect(destination.description.trim().length).toBeGreaterThan(0);
      expect(["activity", "calendar"]).toContain(destination.iconKey);
    }
  });

  it("has no duplicate secondary destination ids", () => {
    const ids = secondaryDestinations.map((destination) => destination.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains Beach Detail sections for pulse, sightings and events", () => {
    const ids = beachDetailSections.map((section) => section.id);
    expect(ids).toContain("pulse");
    expect(ids).toContain("sightings");
    expect(ids).toContain("events");
  });

  it("renders each Beach Detail section exactly once with a label", () => {
    const ids = beachDetailSections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of beachDetailSections) {
      expect(section.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("Pulse leaderboard route (/pulse)", () => {
  it("registers the leaderboard on the /pulse route path", () => {
    const destination = secondaryDestinations.find(
      (item) => item.id === "pulse-leaderboard",
    );
    expect(destination).toBeDefined();
    // The registry entry and the route constant must stay locked together —
    // the shell deep-links through one, resolveAppRoute through the other.
    expect(destination?.routePath).toBe(PULSE_ROUTE_PATH);
    expect(PULSE_ROUTE_PATH).toBe("/pulse");
  });

  it("resolves /pulse to the pulse route with no audience preselected", () => {
    expect(resolveAppRoute("/pulse")).toEqual({
      kind: "pulse",
      audience: null,
    });
  });

  it("resolves /pulse?audience=<x> to the pulse route with that audience", () => {
    expect(resolveAppRoute("/pulse", "?audience=party")).toEqual({
      kind: "pulse",
      audience: "party",
    });
    expect(resolveAppRoute("/pulse", "?audience=family")).toEqual({
      kind: "pulse",
      audience: "family",
    });
  });

  it("rejects unknown audiences instead of guessing", () => {
    expect(resolveAppRoute("/pulse", "?audience=vip")).toEqual({
      kind: "pulse",
      audience: null,
    });
    expect(resolveAppRoute("/pulse", "?audience=")).toEqual({
      kind: "pulse",
      audience: null,
    });
  });

  it("canonicalizes an audience into a shareable /pulse URL", () => {
    expect(pulseRoutePath("party")).toBe("/pulse?audience=party");
  });

  it("keeps trailing-slash variants reachable (the app never 404s)", () => {
    expect(resolveAppRoute("/pulse/")).toEqual({
      kind: "pulse",
      audience: null,
    });
    expect(resolveAppRoute("/pulse///", "?audience=solo")).toEqual({
      kind: "pulse",
      audience: "solo",
    });
  });

  it("guards audience validation for route params", () => {
    for (const value of [
      "family",
      "friends",
      "solo",
      "couples",
      "party",
      "chill",
    ]) {
      expect(isPulseAudience(value)).toBe(true);
    }
    expect(isPulseAudience("clubs")).toBe(false);
    expect(isPulseAudience(undefined)).toBe(false);
    expect(isPulseAudience(7)).toBe(false);
  });

  it("keeps the events calendar route resolvable too", () => {
    expect(resolveAppRoute("/events")).toEqual({ kind: "events" });
    expect(EVENTS_ROUTE_PATH).toBe("/events");
  });

  it("falls back to the shell on unknown paths", () => {
    expect(resolveAppRoute("/")).toEqual({ kind: "shell" });
    expect(resolveAppRoute("/nowhere")).toEqual({ kind: "shell" });
  });
});
