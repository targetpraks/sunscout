import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  pool: { query: queryMock },
  withTransaction: vi.fn(),
}));

import express from "express";
import type { Server } from "node:http";
import {
  ACCURACY_CONDITIONS,
  ACCURATE_RATING_THRESHOLD,
  accuracyRouter,
  buildAccuracySignal,
  isAccuracyCondition,
} from "./accuracy";

/**
 * Router tests run real HTTP against the mounted router with a scripted
 * ./db mock (no Postgres in the test environment). Pure helpers are tested
 * directly. KEEP IN SYNC with src/accuracy/accuracy.test.ts — both suites
 * assert the same canonical constants and fixtures so the two deliberate
 * copies of the accuracy contract cannot drift.
 */

const VALID_USER_PUBLIC_ID = "00000000-0000-7000-8000-000000000001";
const KNOWN_SLUG = "praia-coelha";
const KNOWN_PUBLIC_ID = "11111111-2222-4333-8444-555555555555";
const BEACH_ROW_ID = 42;
const USER_ROW_ID = 7;

const scenario = {
  accuracyRows: [] as Array<{ condition: string; rating: number }>,
  captured: [] as Array<{ sql: string; params: unknown[] }>,
};

beforeEach(() => {
  scenario.accuracyRows = [];
  scenario.captured = [];
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
    scenario.captured.push({ sql, params });
    if (sql.includes("from app_user")) {
      const rows =
        params[0] === VALID_USER_PUBLIC_ID
          ? [{ id: USER_ROW_ID, public_id: params[0] }]
          : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from beach where slug")) {
      const rows = params[0] === KNOWN_SLUG ? [{ id: BEACH_ROW_ID }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from beach where public_id")) {
      const rows = params[0] === KNOWN_PUBLIC_ID ? [{ id: BEACH_ROW_ID }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("insert into condition_accuracy")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("from condition_accuracy")) {
      return {
        rows: scenario.accuracyRows,
        rowCount: scenario.accuracyRows.length,
      };
    }
    return { rows: [], rowCount: 0 };
  });
});

const app = express();
app.use(express.json());
app.use("/api/accuracy", accuracyRouter);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not bind a port");
  }
  baseUrl = `http://127.0.0.1:${address.port}/api/accuracy`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(
  method: "GET" | "POST",
  path = "",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { status: response.status, json };
}

function insertCall() {
  return scenario.captured.find((call) =>
    call.sql.includes("insert into condition_accuracy"),
  );
}

describe("canonical accuracy contract (mirror of src/accuracy)", () => {
  it("fixes the five ratable conditions in canonical order", () => {
    expect([...ACCURACY_CONDITIONS]).toEqual([
      "crowd",
      "water_quality",
      "wind",
      "temperature",
      "cloud_cover",
    ]);
  });

  it("treats ratings at or above 4 as accurate", () => {
    expect(ACCURATE_RATING_THRESHOLD).toBe(4);
  });
});

describe("buildAccuracySignal — aggregation math", () => {
  it("returns the honest degraded state when no ratings exist yet", () => {
    const result = buildAccuracySignal([]);
    expect(result.state).toBe("empty");
    expect(result.totalRatings).toBe(0);
    expect(result.signal).toHaveLength(5);
    for (const entry of result.signal) {
      expect(entry.ratingCount).toBe(0);
      expect(entry.averageRating).toBeNull();
      expect(entry.accuratePercent).toBeNull();
    }
  });

  it("aggregates per condition: mean rounded to 2 decimals, accurate share to whole percent", () => {
    const result = buildAccuracySignal([
      { condition: "wind", rating: 5 },
      { condition: "wind", rating: 4 },
      { condition: "wind", rating: 2 },
      { condition: "crowd", rating: 1 },
    ]);
    expect(result.state).toBe("ok");
    expect(result.totalRatings).toBe(4);
    const byCondition = new Map(
      result.signal.map((entry) => [entry.condition, entry]),
    );
    const wind = byCondition.get("wind");
    expect(wind?.ratingCount).toBe(3);
    expect(wind?.averageRating).toBe(3.67);
    expect(wind?.accuratePercent).toBe(67);
    const crowd = byCondition.get("crowd");
    expect(crowd?.ratingCount).toBe(1);
    expect(crowd?.averageRating).toBe(1);
    expect(crowd?.accuratePercent).toBe(0);
    const water = byCondition.get("water_quality");
    expect(water?.ratingCount).toBe(0);
    expect(water?.averageRating).toBeNull();
  });

  it("marks 100% accurate when every rating meets the threshold", () => {
    const result = buildAccuracySignal([
      { condition: "temperature", rating: 5 },
      { condition: "temperature", rating: 4 },
    ]);
    const entry = result.signal.find(
      (item) => item.condition === "temperature",
    );
    expect(entry?.averageRating).toBe(4.5);
    expect(entry?.accuratePercent).toBe(100);
  });

  it("drops unknown conditions and out-of-range ratings defensively", () => {
    const result = buildAccuracySignal([
      { condition: "waves", rating: 5 },
      { condition: "wind", rating: 6 },
      { condition: "wind", rating: 0 },
      null,
      "not-a-row",
    ]);
    expect(result.state).toBe("empty");
    expect(result.totalRatings).toBe(0);
  });
});

describe("isAccuracyCondition", () => {
  it("accepts exactly the five known conditions", () => {
    for (const condition of ACCURACY_CONDITIONS) {
      expect(isAccuracyCondition(condition)).toBe(true);
    }
  });

  it("rejects lookalikes and non-strings", () => {
    expect(isAccuracyCondition("wave")).toBe(false);
    expect(isAccuracyCondition("")).toBe(false);
    expect(isAccuracyCondition("CROWD")).toBe(false);
    expect(isAccuracyCondition(42)).toBe(false);
  });
});

describe("POST /api/accuracy — auth scoping", () => {
  const validRating = {
    beachId: KNOWN_SLUG,
    condition: "wind",
    rating: 5,
  };

  it("rejects unauthenticated calls with 401 and persists nothing", async () => {
    // The dev auth adapter resolves a missing header to the default user, so
    // "unauthenticated" is exercised with an unrecognized user identifier —
    // the same 401 path requireUser takes for unknown subjects.
    const { status, json } = await call("POST", "", validRating, {
      "x-sunscout-user-id": "99999999-9999-9999-9999-999999999999",
    });
    expect(status).toBe(401);
    expect(json.error).toBe("unknown_user");
    expect(insertCall()).toBeUndefined();
  });

  it("persists one rating per (user, beach, condition) via an upsert on that triple", async () => {
    scenario.accuracyRows = [{ condition: "wind", rating: 5 }];
    const { status, json } = await call("POST", "", validRating, {
      "x-sunscout-user-id": VALID_USER_PUBLIC_ID,
    });
    expect(status).toBe(201);
    const data = json.data as Record<string, unknown>;
    expect(data.recorded).toBe(true);
    expect(data.condition).toBe("wind");
    const insert = insertCall();
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("on conflict (user_id, beach_id, condition)");
    expect(insert!.sql).toContain("do update");
    // Stores the resolved internal ids, not the raw identifier strings.
    expect(insert!.params).toEqual([USER_ROW_ID, BEACH_ROW_ID, "wind", 5]);
    const signal = data.signal as { state: string; totalRatings: number };
    expect(signal.state).toBe("ok");
    expect(signal.totalRatings).toBe(1);
  });

  it("rejects out-of-range ratings with 400", async () => {
    const { status, json } = await call(
      "POST",
      "",
      { ...validRating, rating: 6 },
      { "x-sunscout-user-id": VALID_USER_PUBLIC_ID },
    );
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_request");
    expect(insertCall()).toBeUndefined();
  });

  it("rejects unknown conditions with 400", async () => {
    const { status, json } = await call(
      "POST",
      "",
      { ...validRating, condition: "waves" },
      { "x-sunscout-user-id": VALID_USER_PUBLIC_ID },
    );
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_request");
    expect(insertCall()).toBeUndefined();
  });

  it("rejects an empty body with 400", async () => {
    const { status, json } = await call(
      "POST",
      "",
      {},
      {
        "x-sunscout-user-id": VALID_USER_PUBLIC_ID,
      },
    );
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_request");
  });

  it("returns 404 when the beach does not exist", async () => {
    const { status, json } = await call(
      "POST",
      "",
      { ...validRating, beachId: "praia-nowhere" },
      { "x-sunscout-user-id": VALID_USER_PUBLIC_ID },
    );
    expect(status).toBe(404);
    expect(json.error).toBe("beach_not_found");
    expect(insertCall()).toBeUndefined();
  });
});

describe("GET /api/accuracy — aggregated signal", () => {
  it("requires a beachId", async () => {
    const { status, json } = await call("GET");
    expect(status).toBe(400);
    expect(json.error).toBe("beach_id_required");
  });

  it("returns 404 for an unknown beach", async () => {
    const { status, json } = await call("GET", "?beachId=praia-nowhere");
    expect(status).toBe(404);
    expect(json.error).toBe("beach_not_found");
  });

  it("serves the honest degraded state when no ratings exist yet", async () => {
    const { status, json } = await call("GET", `?beachId=${KNOWN_SLUG}`);
    expect(status).toBe(200);
    const data = json.data as {
      state: string;
      totalRatings: number;
      signal: Array<{
        condition: string;
        ratingCount: number;
        averageRating: number | null;
        accuratePercent: number | null;
      }>;
    };
    expect(data.state).toBe("empty");
    expect(data.totalRatings).toBe(0);
    expect(data.signal).toHaveLength(5);
    for (const entry of data.signal) {
      expect(entry.ratingCount).toBe(0);
      expect(entry.averageRating).toBeNull();
      expect(entry.accuratePercent).toBeNull();
    }
  });

  it("aggregates recent ratings per condition without authentication", async () => {
    scenario.accuracyRows = [
      { condition: "wind", rating: 5 },
      { condition: "wind", rating: 4 },
      { condition: "wind", rating: 2 },
      { condition: "crowd", rating: 1 },
    ];
    const { status, json } = await call("GET", `?beachId=${KNOWN_SLUG}`);
    expect(status).toBe(200);
    const data = json.data as {
      state: string;
      totalRatings: number;
      signal: Array<{
        condition: string;
        averageRating: number | null;
        accuratePercent: number | null;
      }>;
    };
    expect(data.state).toBe("ok");
    expect(data.totalRatings).toBe(4);
    const wind = data.signal.find((entry) => entry.condition === "wind");
    expect(wind?.averageRating).toBe(3.67);
    expect(wind?.accuratePercent).toBe(67);
    const crowd = data.signal.find((entry) => entry.condition === "crowd");
    expect(crowd?.averageRating).toBe(1);
    expect(crowd?.accuratePercent).toBe(0);
  });

  it("resolves the beach by public UUID as well as slug", async () => {
    const { status } = await call("GET", `?beachId=${KNOWN_PUBLIC_ID}`);
    expect(status).toBe(200);
  });
});
