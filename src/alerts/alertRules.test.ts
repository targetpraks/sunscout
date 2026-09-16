/**
 * Personal alert-rule client tests (node environment — no DOM deps).
 *
 * Covers the client-side acceptance criteria:
 *  - filterAlerts shows only alerts at or above the configured priority
 *    (the banner floor semantics),
 *  - describeRule humanises every rule kind, and unknown config values
 *    degrade to 0 instead of crashing,
 *  - the wire-contract drift guard: the client mirror pins the same kind
 *    and priority vocabularies as server/alertRules.ts,
 *  - a static render of AlertBanner and AlertRuleEditor is inert and
 *    honest (loading/empty states) under renderToStaticMarkup, and the
 *    DayScoreCard mounts the alert surfaces without breaking its verdict.
 *
 * JSX is avoided (React.createElement) so this file is a plain .ts test
 * matching the vitest include glob. makeDayScore mirrors the fixture in
 * dayOutlook/dayOutlook.test.ts deliberately — importing that test file
 * would couple the suites, so the small factory is inlined here.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlertBanner } from "./AlertBanner";
import { AlertRuleEditor } from "./AlertRuleEditor";
import {
  ALERT_RULE_KINDS,
  ALERT_RULE_PRIORITIES,
  PERSONAL_RULE_NOTIFICATION_KIND,
  PRIORITY_ORDER,
  alertPriority,
  describeRule,
  filterAlerts,
  type AlertRule,
  type PersonalAlert,
} from "./types";
import { DayScoreCard } from "../dayOutlook/DayScoreCard";
import type { DayScore } from "../dayOutlook/types";

function makeDayScore(): DayScore {
  const audiences = [
    "family",
    "friends",
    "solo",
    "couples",
    "party",
    "chill",
  ] as const;
  return {
    score: 82,
    tier: "go",
    audience: "family",
    audienceScores: audiences.map((audience) => ({
      audience,
      score: 82,
      tier: "go",
      confidence: 0.8,
      staleConditions: false,
      breakdown: {
        conditions: 70,
        community: 60,
        activity: 55,
        vibe: 50,
        freshness: 1,
        conditionFreshness: 1,
      },
    })),
    crowdForecast: [{ hour: 12, crowd: 40, eventBoost: false }],
    observedAt: new Date(Date.now() - 60_000).toISOString(),
    computedAt: new Date().toISOString(),
    stale: false,
    activeEvents: [],
  };
}

function alert(overrides: Partial<PersonalAlert> = {}): PersonalAlert {
  return {
    id: "n1",
    title: "Wind dropped at Praia da Coelha",
    body: "Wind is 10.0 km/h — below your 15 km/h rule.",
    priority: "normal",
    beachSlug: "praia-da-coelha",
    createdAt: "2026-09-16T12:00:00Z",
    ...overrides,
  };
}

describe("filterAlerts (banner priority floor)", () => {
  const alerts = [
    alert({ id: "low", priority: "low" }),
    alert({ id: "normal", priority: "normal" }),
    alert({ id: "high", priority: "high" }),
  ];

  it("default floor is normal: low is filtered out", () => {
    expect(filterAlerts(alerts).map((a) => a.id)).toEqual(["normal", "high"]);
  });

  it("an explicit floor shows only alerts at or above it", () => {
    expect(filterAlerts(alerts, "low").map((a) => a.id)).toEqual([
      "low",
      "normal",
      "high",
    ]);
    expect(filterAlerts(alerts, "high").map((a) => a.id)).toEqual(["high"]);
  });

  it("returns an empty list when nothing qualifies", () => {
    expect(filterAlerts([alert({ priority: "low" })], "high")).toEqual([]);
  });
});

describe("alertPriority (untrusted payload coercion)", () => {
  it("accepts the wire vocabulary", () => {
    expect(alertPriority("low")).toBe("low");
    expect(alertPriority("high")).toBe("high");
  });

  it("falls back to normal on unknown or missing values", () => {
    expect(alertPriority("urgent")).toBe("normal");
    expect(alertPriority(null)).toBe("normal");
    expect(alertPriority(undefined)).toBe("normal");
    expect(alertPriority(2)).toBe("normal");
  });
});

describe("describeRule", () => {
  const base: AlertRule = {
    id: 1,
    beachSlug: "praia-da-coelha",
    beachName: "Praia da Coelha",
    kind: "wind_below",
    config: {},
    priority: "normal",
    enabled: true,
    lastMatchedAt: null,
    createdAt: "2026-09-16T12:00:00Z",
  };

  it("humanises every rule kind", () => {
    expect(
      describeRule({
        ...base,
        kind: "wind_below",
        config: { thresholdKmh: 15 },
      }),
    ).toBe("Wind below 15 km/h");
    expect(
      describeRule({
        ...base,
        kind: "golden_hour_within",
        config: { offsetMinutes: 45 },
      }),
    ).toBe("Golden hour within 45 min");
    expect(describeRule({ ...base, kind: "hazard_clear" })).toBe(
      "Hazard clears",
    );
  });

  it("degrades unknown config values to 0 instead of crashing", () => {
    expect(describeRule({ ...base, kind: "wind_below" })).toBe(
      "Wind below 0 km/h",
    );
  });
});

describe("wire contract (drift guard with server/alertRules.ts)", () => {
  it("pins the kind and priority vocabularies", () => {
    expect([...ALERT_RULE_KINDS]).toEqual([
      "wind_below",
      "golden_hour_within",
      "hazard_clear",
    ]);
    expect([...ALERT_RULE_PRIORITIES]).toEqual(["low", "normal", "high"]);
    expect(PRIORITY_ORDER).toEqual({ low: 0, normal: 1, high: 2 });
    expect(PERSONAL_RULE_NOTIFICATION_KIND).toBe("personal-rule-alert");
  });
});

describe("AlertBanner (static render)", () => {
  it("renders nothing while loading — its inert initial state", () => {
    const html = renderToStaticMarkup(createElement(AlertBanner));
    expect(html).toBe("");
  });
});

describe("AlertRuleEditor (static render)", () => {
  it("renders its collapsed entry row without fetching anything", () => {
    const html = renderToStaticMarkup(createElement(AlertRuleEditor));
    expect(html).toContain("Beach alerts");
    // No fetch happens in a static render (effects do not run), so the
    // editor must not claim to have rules or show a broken form.
    expect(html).not.toContain("Loading");
  });
});

describe("DayScoreCard mount (acceptance smoke)", () => {
  it("still renders the verdict with the alert surfaces mounted", () => {
    const html = renderToStaticMarkup(
      createElement(DayScoreCard, { dayScore: makeDayScore() }),
    );
    // The Day Score verdict is untouched…
    expect(html).toContain("Day Score");
    expect(html).toContain("82");
    // …and the alert editor is reachable from the card with no props.
    expect(html).toContain("Beach alerts");
  });
});
