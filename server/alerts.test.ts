import { describe, expect, it } from "vitest";
import {
  evaluateAlerts,
  isMuted,
  localMinuteOfDay,
  type AlertsDb,
  type PushAdapter,
} from "./push";

const NOW = new Date("2026-06-15T12:00:00Z");
const minutes = (n: number) => n * 60_000;

/**
 * pg's query is a heavily overloaded generic, so a hand-rolled stub is not
 * directly assignable. Route the cast through unknown once, here, instead of
 * at every call site (same pattern as events.test.ts).
 */
function asQuery(
  fn: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>,
): AlertsDb["query"] {
  return fn as unknown as AlertsDb["query"];
}

type AdapterCall = {
  endpoint: string;
  p256dhKey: string | null;
  authSecret: string | null;
  payload: Record<string, unknown>;
};

function makeAdapter() {
  const calls: AdapterCall[] = [];
  const fn: PushAdapter = async (input) => {
    calls.push({
      endpoint: input.endpoint,
      p256dhKey: input.p256dhKey,
      authSecret: input.authSecret,
      payload: input.payload,
    });
    return true;
  };
  return { calls, adapter: fn };
}

function throwingAdapter(): { calls: AdapterCall[]; adapter: PushAdapter } {
  const calls: AdapterCall[] = [];
  const adapter: PushAdapter = async (input) => {
    calls.push(input as AdapterCall);
    throw new Error("push_service_unavailable");
  };
  return { calls, adapter };
}

type Row = Record<string, unknown>;

/**
 * In-memory stand-in for the SQL the evaluator issues. Routes on the same
 * table fragments the real queries use, simulates the alert_dispatch
 * `on conflict do nothing` semantics, and records every notification insert
 * so tests can assert delivery rather than absence of errors.
 */
class FakeAlertsDb {
  conditionRows: Row[] = [];
  eventRows: Row[] = [];
  hazardRows: Row[] = [];
  bookingRows: Row[] = [];
  preferences = new Map<string, Row>();
  subscriptions = new Map<number, Row[]>();
  conditionQueryThrows = false;
  ledger = new Set<string>();
  notifications: Array<{
    kind: unknown;
    title: unknown;
    body: unknown;
    payload: unknown;
  }> = [];

  setPreference(
    userId: number,
    kind: string,
    preference: Partial<{
      timezone: string;
      enabled: boolean | null;
      mute_start_minute: number | null;
      mute_end_minute: number | null;
    }> = {},
  ) {
    this.preferences.set(`${userId}:${kind}`, {
      timezone: "Europe/Lisbon",
      enabled: null,
      mute_start_minute: null,
      mute_end_minute: null,
      ...preference,
    });
  }

  db(): AlertsDb {
    return { query: this.query() };
  }

  private query() {
    const self = this;
    return asQuery(async (sql: string, params?: unknown[]) => {
      if (sql.includes("insert into alert_dispatch")) {
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
      if (sql.includes("c.golden_hour_start")) {
        if (self.conditionQueryThrows) {
          throw new Error("condition_query_failed");
        }
        return {
          rows: self.conditionRows,
          rowCount: self.conditionRows.length,
        };
      }
      if (sql.includes("from beach_event")) {
        return { rows: self.eventRows, rowCount: self.eventRows.length };
      }
      if (sql.includes("from hazard_alert")) {
        return { rows: self.hazardRows, rowCount: self.hazardRows.length };
      }
      if (sql.includes("from booking bk")) {
        return { rows: self.bookingRows, rowCount: self.bookingRows.length };
      }
      throw new Error(`fake_db_unexpected_query: ${sql.slice(0, 80)}`);
    });
  }
}

function conditionRow(overrides: Row = {}): Row {
  return {
    user_id: 1,
    beach_id: 10,
    slug: "praia-da-coelha",
    beach_name: "Praia da Coelha",
    condition_id: 100,
    golden_hour_start: new Date(NOW.getTime() + minutes(30)),
    cloud_cover_percent: "20",
    water_quality: "good",
    wave_height_m: "0.4",
    prev_condition_id: 99,
    prev_water_quality: "good",
    prev_wave_height_m: "0.4",
    ...overrides,
  };
}

function goldenHourDb(overrides: Row[] = []) {
  const fake = new FakeAlertsDb();
  fake.conditionRows = overrides.length ? overrides : [conditionRow()];
  fake.setPreference(1, "golden-hour-imminent");
  fake.setPreference(1, "event-starting-soon");
  fake.setPreference(1, "condition-change");
  fake.setPreference(1, "booking-reminder");
  fake.subscriptions.set(1, [
    { endpoint: "https://push.example/1", p256dh_key: "k1", auth_secret: "a1" },
    { endpoint: "https://push.example/2", p256dh_key: "k2", auth_secret: "a2" },
  ]);
  return fake;
}

describe("localMinuteOfDay", () => {
  it("maps a UTC instant to the minute of day in the given timezone", () => {
    // 12:00 UTC in June is 13:00 WEST in Lisbon.
    expect(localMinuteOfDay(NOW, "Europe/Lisbon")).toBe(13 * 60);
    expect(localMinuteOfDay(new Date("2026-06-15T23:59:00Z"), "UTC")).toBe(
      23 * 60 + 59,
    );
  });

  it("uses h23 so UTC midnight is minute 0, never 1440", () => {
    expect(localMinuteOfDay(new Date("2026-06-16T00:00:00Z"), "UTC")).toBe(0);
  });
});

describe("isMuted", () => {
  const atMinute = (minute: number) =>
    new Date(new Date("2026-06-15T00:00:00Z").getTime() + minute * minutes(1));

  it("mutes inside a same-day window and not outside it", () => {
    const window = { startMinute: 700, endMinute: 800 };
    expect(isMuted(window, atMinute(750), "UTC")).toBe(true);
    expect(isMuted(window, atMinute(500), "UTC")).toBe(false);
    expect(isMuted(window, atMinute(900), "UTC")).toBe(false);
  });

  it("wraps windows that cross midnight", () => {
    const window = { startMinute: 22 * 60, endMinute: 7 * 60 };
    expect(isMuted(window, atMinute(23 * 60), "UTC")).toBe(true);
    expect(isMuted(window, atMinute(3 * 60), "UTC")).toBe(true);
    expect(isMuted(window, atMinute(12 * 60), "UTC")).toBe(false);
  });

  it("mutes nothing for a zero-length or unbounded window", () => {
    expect(
      isMuted({ startMinute: 700, endMinute: 700 }, atMinute(700), "UTC"),
    ).toBe(false);
    expect(
      isMuted({ startMinute: null, endMinute: 800 }, atMinute(750), "UTC"),
    ).toBe(false);
    expect(
      isMuted({ startMinute: 700, endMinute: null }, atMinute(750), "UTC"),
    ).toBe(false);
  });
});

describe("golden-hour alerts", () => {
  it("fires when golden hour starts inside the window, fanning out to every subscription", async () => {
    const fake = goldenHourDb();
    const { calls, adapter } = makeAdapter();
    const result = await evaluateAlerts(fake.db(), { now: NOW, adapter });

    expect(result.candidates).toBe(1);
    expect(result.dispatched).toBe(1);
    expect(result.errors).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[0].endpoint).toBe("https://push.example/1");
    expect(calls[0].payload).toMatchObject({
      kind: "golden-hour-imminent",
      beachSlug: "praia-da-coelha",
      startsInMinutes: 30,
    });
    expect(fake.notifications).toHaveLength(1);
    expect(fake.notifications[0].kind).toBe("golden-hour-imminent");
    expect(String(fake.notifications[0].title)).toContain(
      "Golden hour at Praia da Coelha",
    );
  });

  it("still fires when golden hour starts exactly now", async () => {
    const fake = goldenHourDb([
      conditionRow({ golden_hour_start: new Date(NOW.getTime()) }),
    ]);
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.dispatched).toBe(1);
  });

  it("stays silent under heavy overcast even inside the window", async () => {
    const fake = goldenHourDb([conditionRow({ cloud_cover_percent: "80" })]);
    const { calls, adapter } = makeAdapter();
    const result = await evaluateAlerts(fake.db(), { now: NOW, adapter });
    expect(result.candidates).toBe(0);
    expect(result.dispatched).toBe(0);
    expect(calls).toHaveLength(0);
    expect(fake.notifications).toHaveLength(0);
  });

  it("treats a missing cloud reading as clear sky", async () => {
    const fake = goldenHourDb([conditionRow({ cloud_cover_percent: null })]);
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.dispatched).toBe(1);
  });

  it("stays silent once golden hour has already started or is too far out", async () => {
    const started = goldenHourDb([
      conditionRow({ golden_hour_start: new Date(NOW.getTime() - minutes(5)) }),
    ]);
    expect((await evaluateAlerts(started.db(), { now: NOW })).candidates).toBe(
      0,
    );

    const farOut = goldenHourDb([
      conditionRow({
        golden_hour_start: new Date(NOW.getTime() + minutes(90)),
      }),
    ]);
    expect((await evaluateAlerts(farOut.db(), { now: NOW })).candidates).toBe(
      0,
    );
  });

  it("stays silent when the beach has no golden-hour reading yet", async () => {
    const fake = goldenHourDb([conditionRow({ golden_hour_start: null })]);
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.candidates).toBe(0);
  });
});

describe("event-starting alerts", () => {
  function eventDb(rows: Row[]) {
    const fake = goldenHourDb();
    fake.conditionRows = [];
    fake.eventRows = rows;
    return fake;
  }
  const baseEvent: Row = {
    user_id: 1,
    event_id: 5,
    title: "Sunset party",
    start_at: new Date(NOW.getTime() - minutes(30)),
    end_at: new Date(NOW.getTime() + minutes(120)),
    beach_name: "Praia da Coelha",
    slug: "praia-da-coelha",
  };

  it("announces an event that is already happening", async () => {
    const fake = eventDb([baseEvent]);
    const { calls, adapter } = makeAdapter();
    const result = await evaluateAlerts(fake.db(), { now: NOW, adapter });

    expect(result.dispatched).toBe(1);
    expect(calls[0].payload).toMatchObject({
      kind: "event-starting-soon",
      eventId: 5,
    });
    expect(String(fake.notifications[0].title)).toContain("Happening now");
    expect(String(fake.notifications[0].title)).toContain("Sunset party");
  });

  it("announces an event starting soon with the countdown in the body", async () => {
    const fake = eventDb([
      {
        ...baseEvent,
        start_at: new Date(NOW.getTime() + minutes(30)),
        end_at: new Date(NOW.getTime() + minutes(300)),
      },
    ]);
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.dispatched).toBe(1);
    expect(String(fake.notifications[0].title)).toContain("Starting soon");
    expect(String(fake.notifications[0].body)).toContain(
      "starts in about 30 minutes",
    );
  });

  it("skips events already ended or starting beyond the lead window", async () => {
    const fake = eventDb([
      {
        ...baseEvent,
        start_at: new Date(NOW.getTime() - minutes(120)),
        end_at: new Date(NOW.getTime() - minutes(5)),
      },
      {
        ...baseEvent,
        start_at: new Date(NOW.getTime() + minutes(90)),
        end_at: new Date(NOW.getTime() + minutes(300)),
      },
    ]);
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.candidates).toBe(0);
  });
});

describe("condition-change alerts", () => {
  function changeDb(rows: Row[]) {
    const fake = goldenHourDb();
    fake.conditionRows = rows;
    return fake;
  }

  it("fires on a water-quality downgrade", async () => {
    const fake = changeDb([
      conditionRow({
        golden_hour_start: null,
        water_quality: "advisory",
        prev_water_quality: "good",
      }),
    ]);
    const { calls, adapter } = makeAdapter();
    const result = await evaluateAlerts(fake.db(), { now: NOW, adapter });

    expect(result.dispatched).toBe(1);
    expect(calls[0].payload.kind).toBe("condition-change");
    expect(String(fake.notifications[0].body)).toContain(
      "water quality moved from good to advisory",
    );
  });

  it("does not fire on a water-quality improvement", async () => {
    const fake = changeDb([
      conditionRow({
        golden_hour_start: null,
        water_quality: "good",
        prev_water_quality: "advisory",
      }),
    ]);
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.candidates).toBe(0);
  });

  it("fires on a wave-height spike of one metre or more", async () => {
    const fake = changeDb([
      conditionRow({
        golden_hour_start: null,
        wave_height_m: "2.5",
        prev_wave_height_m: "0.9",
      }),
    ]);
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.dispatched).toBe(1);
    expect(String(fake.notifications[0].body)).toContain(
      "waves jumped from 0.9m to 2.5m",
    );
  });

  it("ignores a sub-threshold wave rise and a first-ever reading", async () => {
    const smallRise = changeDb([
      conditionRow({
        golden_hour_start: null,
        wave_height_m: "1.5",
        prev_wave_height_m: "1.0",
      }),
    ]);
    expect(
      (await evaluateAlerts(smallRise.db(), { now: NOW })).candidates,
    ).toBe(0);

    const firstReading = changeDb([
      conditionRow({
        golden_hour_start: null,
        prev_condition_id: null,
        water_quality: "advisory",
      }),
    ]);
    expect(
      (await evaluateAlerts(firstReading.db(), { now: NOW })).candidates,
    ).toBe(0);
  });

  it("reports quality and wave changes together in one alert", async () => {
    const fake = changeDb([
      conditionRow({
        golden_hour_start: null,
        water_quality: "advisory",
        prev_water_quality: "excellent",
        wave_height_m: "3.0",
        prev_wave_height_m: "0.4",
      }),
    ]);
    await evaluateAlerts(fake.db(), { now: NOW });
    const body = String(fake.notifications[0].body);
    expect(body).toContain("water quality moved from excellent to advisory");
    expect(body).toContain("waves jumped from 0.4m to 3.0m");
    expect(fake.notifications).toHaveLength(1);
  });
});

describe("hazard alerts", () => {
  function hazardDb(rows: Row[]) {
    const fake = goldenHourDb();
    fake.conditionRows = [];
    fake.hazardRows = rows;
    return fake;
  }
  const baseHazard: Row = {
    user_id: 1,
    hazard_id: 7,
    severity: "warning",
    title: "Strong rip currents",
    detail: "Swim between the flags; lifeguard flag is red today.",
    created_at: new Date(NOW.getTime() - minutes(5)),
    expires_at: new Date(NOW.getTime() + minutes(120)),
    beach_name: "Praia da Coelha",
    slug: "praia-da-coelha",
  };

  it("fires for a fresh, still-active hazard as a condition-change alert", async () => {
    const fake = hazardDb([baseHazard]);
    const { calls, adapter } = makeAdapter();
    const result = await evaluateAlerts(fake.db(), { now: NOW, adapter });

    expect(result.dispatched).toBe(1);
    expect(calls[0].payload).toMatchObject({
      kind: "condition-change",
      severity: "warning",
      hazardId: 7,
    });
    expect(String(fake.notifications[0].title)).toContain(
      "Warning hazard at Praia da Coelha",
    );
  });

  it("skips hazards that have already expired", async () => {
    const fake = hazardDb([
      {
        ...baseHazard,
        expires_at: new Date(NOW.getTime() - minutes(1)),
      },
    ]);
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.candidates).toBe(0);
  });
});

describe("booking reminders", () => {
  function bookingDb(rows: Row[]) {
    const fake = goldenHourDb();
    fake.conditionRows = [];
    fake.bookingRows = rows;
    return fake;
  }
  const baseBooking: Row = {
    user_id: 1,
    booking_id: 21,
    starts_at: new Date(NOW.getTime() + minutes(60)),
    beach_name: "Praia da Coelha",
    slug: "praia-da-coelha",
  };

  it("reminds the booking owner inside the two-hour window", async () => {
    const fake = bookingDb([baseBooking]);
    const { calls, adapter } = makeAdapter();
    const result = await evaluateAlerts(fake.db(), { now: NOW, adapter });

    expect(result.dispatched).toBe(1);
    expect(calls[0].payload).toMatchObject({
      kind: "booking-reminder",
      bookingId: 21,
    });
    expect(String(fake.notifications[0].title)).toContain(
      "Your booking at Praia da Coelha starts soon",
    );
  });

  it("skips bookings outside the reminder window", async () => {
    const fake = bookingDb([
      { ...baseBooking, starts_at: new Date(NOW.getTime() + minutes(200)) },
      { ...baseBooking, starts_at: new Date(NOW.getTime() - minutes(10)) },
    ]);
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.candidates).toBe(0);
  });
});

describe("preference and mute gating", () => {
  it("suppresses only the disabled alert kind", async () => {
    const fake = goldenHourDb([
      conditionRow(),
      conditionRow({
        beach_id: 11,
        condition_id: 101,
        golden_hour_start: null,
        water_quality: "advisory",
        prev_water_quality: "good",
      }),
    ]);
    fake.setPreference(1, "golden-hour-imminent", { enabled: false });

    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.dispatched).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(fake.notifications).toHaveLength(1);
    expect(fake.notifications[0].kind).toBe("condition-change");
  });

  it("suppresses alerts inside the user's local mute window", async () => {
    const fake = goldenHourDb();
    // NOW is 13:00 in Lisbon (minute 780). Mute 11:40–13:20 local.
    fake.setPreference(1, "golden-hour-imminent", {
      mute_start_minute: 700,
      mute_end_minute: 800,
    });

    const { calls, adapter } = makeAdapter();
    const result = await evaluateAlerts(fake.db(), { now: NOW, adapter });
    expect(result.suppressed).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(calls).toHaveLength(0);
    expect(fake.notifications).toHaveLength(0);
  });

  it("delivers when the mute window does not cover the local time", async () => {
    const fake = goldenHourDb();
    fake.setPreference(1, "golden-hour-imminent", {
      mute_start_minute: 420,
      mute_end_minute: 480,
    });
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.dispatched).toBe(1);
  });

  it("suppresses candidates for a user that no longer exists", async () => {
    const fake = goldenHourDb();
    fake.preferences.clear();
    fake.subscriptions.clear();
    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.suppressed).toBe(1);
    expect(fake.notifications).toHaveLength(0);
  });
});

describe("idempotency", () => {
  it("dispatches once and treats a second identical run as duplicates", async () => {
    const fake = goldenHourDb();
    const { calls, adapter } = makeAdapter();

    const first = await evaluateAlerts(fake.db(), { now: NOW, adapter });
    expect(first.dispatched).toBe(1);
    expect(first.duplicates).toBe(0);
    expect(calls).toHaveLength(2);
    expect(fake.notifications).toHaveLength(1);

    const second = await evaluateAlerts(fake.db(), { now: NOW, adapter });
    expect(second.candidates).toBe(1);
    expect(second.dispatched).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(calls).toHaveLength(2); // no new push fan-out
    expect(fake.notifications).toHaveLength(1); // no duplicate in-app alert
  });
});

describe("failure isolation", () => {
  it("records push adapter failures and keeps going", async () => {
    const fake = goldenHourDb();
    const { calls, adapter } = throwingAdapter();
    const result = await evaluateAlerts(fake.db(), { now: NOW, adapter });

    expect(result.dispatched).toBe(1);
    expect(calls).toHaveLength(2); // attempted every subscription
    expect(result.errors).toEqual([
      {
        source: "push:golden-hour-imminent",
        error: "push_service_unavailable",
      },
      {
        source: "push:golden-hour-imminent",
        error: "push_service_unavailable",
      },
    ]);
    // The in-app notification is the reliable fallback and must still exist.
    expect(fake.notifications).toHaveLength(1);
  });

  it("isolates a failing collector and still evaluates the others", async () => {
    const fake = goldenHourDb();
    fake.conditionQueryThrows = true;
    fake.eventRows = [
      {
        user_id: 1,
        event_id: 5,
        title: "Sunset party",
        start_at: new Date(NOW.getTime() - minutes(10)),
        end_at: new Date(NOW.getTime() + minutes(120)),
        beach_name: "Praia da Coelha",
        slug: "praia-da-coelha",
      },
    ];

    const result = await evaluateAlerts(fake.db(), { now: NOW });
    expect(result.errors).toEqual([
      { source: "conditions", error: "condition_query_failed" },
    ]);
    expect(result.dispatched).toBe(1);
    expect(fake.notifications[0].kind).toBe("event-starting-soon");
  });
});
