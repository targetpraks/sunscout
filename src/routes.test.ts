import { describe, expect, it } from "vitest";
import { beachDetailSections, secondaryDestinations } from "./routes";

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
