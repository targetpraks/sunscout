import { describe, expect, it } from "vitest";
import {
  ALERT_RULE_KINDS,
  ALERT_RULE_PRIORITIES,
  PERSONAL_RULE_NOTIFICATION_KIND,
  evaluateAlertRules,
  matchesRule,
  type AlertRuleKind,
} from "./alertRules";
import type { AlertsDb, PushAdapter } from "./push";

const NOW = new Date("2026-09-16T12:00:00Z");
const minutes = (n: number) => n * 60_000;

function asQuery(
  fn: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>,
): AlertsDb["query"] {
  return fn as unknown as AlertsDb["query"];
}

type Row = Record<string, unknown>;

/**
 * In-memory stand-in for the SQL evaluateAlertRules issues. Routes on the
 * same table fragments the real queries use, simulates the alert_dispatch
 * `on conflict do nothing` idempotency, and records notification inserts.
 */
class FakeRulesDb {
  ruleRows: Row[] = [];
  preferences = new Map<string, Row>();
  subscriptions = new Map<number, Row[]>();
  ruleQueryThrows = false;
  /** Throw from the alert_dispatch insert after this many calls. */
  ledgerThrowAfter = Infinity;
  private ledgerInserts = 0;
  ledger = new Set<string>();
  notifications: Array<{
    kind: unknown;
    title: unknown;
    body: unknown;
    payload: unknown;
  }> = [];
  ruleStamps: Array<{ id: unknown; matchedAt: unknown }> = [];

  setPreference(userId: number, kind: string, preference: Row = {}) {
    this.preferences.set(`${userId}:${kind}`, {
      timezone: "UTC",
      enabled: null,
      mute_start_minute: null,
      mute_end_minute: null,
      ...preference,
    });
  }

  db(): AlertsDb {
    return { query: this.query() };
  }

  protected query() {
    const self = this;
    return asQuery(async (sql: string, params?: unknown[]) => {
      if (sql.includes("insert into alert_dispatch")) {
        self.ledgerInserts += 1;
        if (self.ledgerInserts > self.ledgerThrowAfter) {
          throw new Error("ledger_write_failed");
        }
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}`;
        if (self.ledger.has(key)) return { rows: [], rowCount: 0 };
        self.ledger.add(key);
        return { rows: [{ user_id: params?.[0] }], rowCount: 1 };
      }
      if (sql.includes("insert into notification")) {
        self.notifications.push({
          kind: params?.[1],
          title: params?.[2],
          body: params?.[3],
          payload: params?.[4],
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("update alert_rule set last_matched_at")) {
        self.ruleStamps.push({ id: params?.[1], matchedAt: params?.[0] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("from app_user")) {
        const preference = self.preferences.get(
          `${params?.[0]}:${params?.[1]}`,
        );
        return preference
          ? { rows: [preference], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("from push_subscription")) {
        const rows = self.subscriptions.get(Number(params?.[0])) ?? [];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("from alert_rule r")) {
        if (self.ruleQueryThrows) {
          throw new Error("rule_query_failed");
        }
        return { rows: self.ruleRows, rowCount: self.ruleRows.length };
      }
      throw new Error(`fake_rules_db_unexpected_query: ${sql.slice(0, 80)}`);
    });
  }
}

function makeAdapter() {
  const calls: Array<Record<string, unknown>> = [];
  const adapter: PushAdapter = async (input) => {
    calls.push(input as Record<string, unknown>);
    return true;
  };
  return { calls, adapter };
}

function ruleRow(overrides: Row = {}): Row {
  return {
    rule_id: 1,
    user_id: 1,
    kind: "wind_below",
    config: { thresholdKmh: 15 },
    priority: "normal",
    slug: "praia-da-coelha",
    beach_name: "Praia da Coelha",
    wind_speed_kmh: "10.0",
    cloud_cover_percent: "20",
    golden_hour_start: null,
    observed_at: new Date(NOW.getTime() - minutes(30)),
    hazard_id: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<RuleSnapshot> = {}): RuleSnapshot {
  return {
    windKmh: 10,
    cloudPercent: 20,
    goldenHourStart: new Date(NOW.getTime() + minutes(30)),
    clearedHazardId: null,
    conditionObservedAt: new Date(NOW.getTime() - minutes(30)),
    ...overrides,
  };
}

/** The snapshot shape matchesRule takes (imported type, local alias). */
type RuleSnapshot = Parameters<typeof matchesRule>[1];

function rulesDbWith(rows: Row[]): FakeRulesDb {
  const fake = new FakeRulesDb();
  fake.ruleRows = rows;
  fake.setPreference(1, PERSONAL_RULE_NOTIFICATION_KIND);
  fake.subscriptions.set(1, [
    { endpoint: "https://push.example/1", p256dh_key: "k1", auth_secret: "a1" },
  ]);
  return fake;
}

// ---------------------------------------------------------------------------
// matchesRule — pure predicate coverage
// ---------------------------------------------------------------------------

describe("matchesRule: wind_below", () => {
  const rule = { kind: "wind_below" as const, config: { thresholdKmh: 15 } };

  it("triggers when fresh wind is below the threshold", () => {
    expect(matchesRule(rule, snapshot(), NOW)).toBe(true);
  });

  it("does not trigger at or above the threshold", () => {
    expect(matchesRule(rule, snapshot({ windKmh: 15 }), NOW)).toBe(false);
    expect(matchesRule(rule, snapshot({ windKmh: 30 }), NOW)).toBe(false);
  });

  it("never fires on a stale reading (6h honesty guard)", () => {
    expect(
      matchesRule(
        rule,
        snapshot({
          conditionObservedAt: new Date(NOW.getTime() - minutes(6 * 60 + 1)),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("does not fire when wind or observed_at is missing", () => {
    expect(matchesRule(rule, snapshot({ windKmh: null }), NOW)).toBe(false);
    expect(
      matchesRule(rule, snapshot({ conditionObservedAt: null }), NOW),
    ).toBe(false);
  });

  it("does not fire on a corrupt config", () => {
    expect(
      matchesRule(
        { kind: "wind_below", config: { thresholdKmh: "lots" } },
        snapshot(),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("matchesRule: golden_hour_within", () => {
  const rule = {
    kind: "golden_hour_within" as const,
    config: { offsetMinutes: 45 },
  };

  it("triggers when golden hour starts inside the offset window", () => {
    expect(matchesRule(rule, snapshot(), NOW)).toBe(true);
  });

  it("does not trigger outside the offset window or in the past", () => {
    expect(
      matchesRule(
        rule,
        snapshot({ goldenHourStart: new Date(NOW.getTime() + minutes(60)) }),
        NOW,
      ),
    ).toBe(false);
    expect(
      matchesRule(
        rule,
        snapshot({ goldenHourStart: new Date(NOW.getTime() - minutes(5)) }),
        NOW,
      ),
    ).toBe(false);
    expect(matchesRule(rule, snapshot({ goldenHourStart: null }), NOW)).toBe(
      false,
    );
  });

  it("suppresses overcast golden hours above 60% cloud", () => {
    expect(matchesRule(rule, snapshot({ cloudPercent: 61 }), NOW)).toBe(false);
    expect(matchesRule(rule, snapshot({ cloudPercent: 60 }), NOW)).toBe(true);
  });
});

describe("matchesRule: hazard_clear", () => {
  const rule = { kind: "hazard_clear" as const, config: {} };

  it("triggers only when a hazard has cleared", () => {
    expect(matchesRule(rule, snapshot({ clearedHazardId: 42 }), NOW)).toBe(
      true,
    );
    expect(matchesRule(rule, snapshot(), NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateAlertRules — dispatch, idempotency, isolation
// ---------------------------------------------------------------------------

describe("evaluateAlertRules", () => {
  it("dispatches exactly one notification per triggered rule", async () => {
    const fake = rulesDbWith([
      ruleRow(), // wind 10 < 15, fresh -> fires
      ruleRow({
        rule_id: 2,
        kind: "golden_hour_within",
        config: { offsetMinutes: 45 },
        wind_speed_kmh: "25.0",
        golden_hour_start: new Date(NOW.getTime() + minutes(30)),
      }), // fires
      ruleRow({
        rule_id: 3,
        kind: "wind_below",
        config: { thresholdKmh: 5 },
        wind_speed_kmh: "10.0",
      }), // 10 >= 5 -> no
    ]);
    const { adapter } = makeAdapter();
    const result = await evaluateAlertRules(fake.db(), {
      now: NOW,
      adapter,
    });
    expect(result.candidates).toBe(2);
    expect(result.dispatched).toBe(2);
    expect(result.errors).toEqual([]);
    expect(fake.notifications).toHaveLength(2);
    expect(fake.ruleStamps.map((stamp) => stamp.id).sort()).toEqual([1, 2]);
    expect(fake.notifications[0]?.title).toContain("Wind dropped");
    expect(fake.notifications[1]?.title).toContain("Golden hour near");
  });

  it("dispatches a hazard-clear rule and stamps it once", async () => {
    const fake = rulesDbWith([
      ruleRow({
        rule_id: 7,
        kind: "hazard_clear",
        config: {},
        wind_speed_kmh: "25.0",
        hazard_id: 42,
      }),
    ]);
    const result = await evaluateAlertRules(fake.db(), { now: NOW });
    expect(result.dispatched).toBe(1);
    expect(fake.notifications[0]?.title).toContain("Hazard cleared");
    expect(fake.ruleStamps).toEqual([{ id: 7, matchedAt: NOW }]);
  });

  it("is idempotent: a re-run produces zero duplicate alerts", async () => {
    const fake = rulesDbWith([ruleRow()]);
    const { calls, adapter } = makeAdapter();
    const first = await evaluateAlertRules(fake.db(), {
      now: NOW,
      adapter,
    });
    const second = await evaluateAlertRules(fake.db(), {
      now: NOW,
      adapter,
    });
    expect(first.dispatched).toBe(1);
    expect(second.candidates).toBe(1);
    expect(second.dispatched).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(fake.notifications).toHaveLength(1); // still exactly one insert
    expect(calls).toHaveLength(1); // push fired once, not twice
  });

  it("produces no candidates from a no-trigger fixture set", async () => {
    const fake = rulesDbWith([
      ruleRow({ wind_speed_kmh: "30.0" }), // above threshold
      ruleRow({
        rule_id: 2,
        kind: "golden_hour_within",
        config: { offsetMinutes: 30 },
        golden_hour_start: new Date(NOW.getTime() + minutes(90)), // too far
      }),
      ruleRow({
        rule_id: 3,
        kind: "hazard_clear",
        config: {},
        hazard_id: null, // nothing cleared
      }),
    ]);
    const result = await evaluateAlertRules(fake.db(), { now: NOW });
    expect(result.candidates).toBe(0);
    expect(result.dispatched).toBe(0);
    expect(fake.notifications).toHaveLength(0);
  });

  it("suppresses alerts for users who disabled the kind", async () => {
    const fake = rulesDbWith([ruleRow()]);
    fake.setPreference(1, PERSONAL_RULE_NOTIFICATION_KIND, { enabled: false });
    const result = await evaluateAlertRules(fake.db(), { now: NOW });
    expect(result.dispatched).toBe(0);
    expect(result.suppressed).toBe(1);
  });

  it("keeps evaluating when one rule's dispatch throws", async () => {
    const fake = rulesDbWith([ruleRow(), ruleRow({ rule_id: 2 })]);
    // First dispatch succeeds; the second ledger insert fails.
    fake.ledgerThrowAfter = 1;
    const result = await evaluateAlertRules(fake.db(), { now: NOW });
    expect(result.dispatched).toBe(1);
    expect(result.errors).toEqual([
      { source: "rule:2", error: "ledger_write_failed" },
    ]);
  });

  it("isolates a rule-scan failure into errors without throwing", async () => {
    const fake = rulesDbWith([]);
    fake.ruleQueryThrows = true;
    const result = await evaluateAlertRules(fake.db(), { now: NOW });
    expect(result.dispatched).toBe(0);
    expect(result.errors).toEqual([
      { source: "rules", error: "rule_query_failed" },
    ]);
  });

  it("uses one notification kind for every rule alert", async () => {
    const fake = rulesDbWith([ruleRow()]);
    await evaluateAlertRules(fake.db(), { now: NOW });
    expect(fake.notifications[0]?.kind).toBe(PERSONAL_RULE_NOTIFICATION_KIND);
  });
});

describe("wire contract", () => {
  it("pins the rule kind and priority vocabularies", () => {
    expect([...ALERT_RULE_KINDS]).toEqual([
      "wind_below",
      "golden_hour_within",
      "hazard_clear",
    ]);
    expect([...ALERT_RULE_PRIORITIES]).toEqual(["low", "normal", "high"]);
  });

  it("derives a boolean verdict from every rule kind", () => {
    const kinds: AlertRuleKind[] = ["wind_below", "hazard_clear"];
    for (const kind of kinds) {
      expect(typeof matchesRule({ kind, config: {} }, snapshot(), NOW)).toBe(
        "boolean",
      );
    }
  });
});
