import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic: stub the db pool and auth middleware before importing the module.
const { query, requireUser, resolveOptionalUser } = vi.hoisted(() => ({
  query: vi.fn(),
  requireUser: vi.fn(),
  resolveOptionalUser: vi.fn(),
}));
vi.mock("./db", () => ({ pool: { query } }));
vi.mock("./auth", () => ({ requireUser, resolveOptionalUser }));

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import {
  ACCURACY_CONDITIONS,
  accuracyRatingSchema,
  accuracyRouter,
  COOLDOWN_HOURS,
  DEFAULT_MIN_SAMPLE_SIZE,
  getBeachAccuracy,
  recordRating,
  resolveBeachId,
} from "./accuracy";

type Row = Record<string, unknown>;

function result(rows: Row[], rowCount = rows.length) {
  return { rows, rowCount };
}

const iso = (hoursFromNow: number) =>
  new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

const USER_PUBLIC_ID = "00000000-0000-7000-8000-000000000001";

beforeEach(() => {
  query.mockReset();
  requireUser
    .mockReset()
    .mockImplementation(
      (request: Request, _response: Response, next: NextFunction) => {
        request.userId = 42;
        request.userPublicId = USER_PUBLIC_ID;
        next();
      },
    );
  resolveOptionalUser.mockReset().mockResolvedValue(42);
});

afterEach(() => {
  query.mockReset();
});

describe("accuracyRatingSchema", () => {
  it("accepts a valid rating payload", () => {
    const input = accuracyRatingSchema.parse({
      beachId: "praia-da-coelha",
      condition: "waterQuality",
      rating: 0.8,
      userId: USER_PUBLIC_ID,
    });
    expect(input.condition).toBe("waterQuality");
    expect(input.rating).toBe(0.8);
  });

  it("rejects an unknown condition", () => {
    expect(() =>
      accuracyRatingSchema.parse({
        beachId: "praia-da-coelha",
        condition: "humidity",
        rating: 0.5,
      }),
    ).toThrowError(/invalid/i);
  });

  it("rejects ratings outside 0-1", () => {
    for (const rating of [-0.1, 1.01]) {
      expect(() =>
        accuracyRatingSchema.parse({
          beachId: "praia-da-coelha",
          condition: "crowd",
          rating,
        }),
      ).toThrowError();
    }
  });

  it("makes userId optional", () => {
    expect(() =>
      accuracyRatingSchema.parse({
        beachId: "praia-da-coelha",
        condition: "tide",
        rating: 0,
      }),
    ).not.toThrowError();
  });
});

describe("resolveBeachId", () => {
  it("resolves by slug or public id", async () => {
    query.mockResolvedValue(result([{ id: 7 }]));
    await expect(resolveBeachId({ query }, "praia-da-coelha")).resolves.toBe(7);
    await expect(resolveBeachId({ query }, "beach-uuid")).resolves.toBe(7);
  });

  it("returns null for an unknown beach", async () => {
    query.mockResolvedValue(result([]));
    await expect(resolveBeachId({ query }, "nope")).resolves.toBeNull();
  });
});

describe("recordRating", () => {
  it("stores the rating with a capture timestamp", async () => {
    const capturedAt = iso(0);
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("captured_at from condition_accuracy_rating")) {
        return result([]); // no recent rating -> cooldown clear
      }
      if (sql.includes("insert into condition_accuracy_rating")) {
        expect(params).toEqual([7, 42, "crowd", 0.75]);
        return result([{ captured_at: capturedAt }]);
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const outcome = await recordRating(
      { query },
      {
        userId: 42,
        beachId: 7,
        condition: "crowd",
        rating: 0.75,
      },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.capturedAt.toISOString()).toBe(capturedAt);
    }
  });

  it("clamps and rounds out-of-range ratings before storing", async () => {
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("insert into condition_accuracy_rating")) {
        expect(params[3]).toBe(1);
        return result([{ captured_at: iso(0) }]);
      }
      return result([]);
    });
    const outcome = await recordRating(
      { query },
      {
        userId: 42,
        beachId: 7,
        condition: "wind",
        rating: 1.5,
      },
    );
    expect(outcome.ok).toBe(true);
  });

  it("rejects a repeat rating inside the 24h cooldown", async () => {
    const last = new Date("2026-09-13T08:00:00.000Z");
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("captured_at from condition_accuracy_rating")) {
        return result([{ captured_at: last.toISOString() }], 1);
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const outcome = await recordRating(
      { query },
      {
        userId: 42,
        beachId: 7,
        condition: "crowd",
        rating: 0.9,
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("cooldown");
      expect(outcome.nextAllowedAt.toISOString()).toBe(
        "2026-09-14T08:00:00.000Z",
      );
    }
  });
});

describe("getBeachAccuracy", () => {
  const rows: Row[] = [
    {
      condition: "crowd",
      score: "0.5000000000000000",
      sample_size: 4,
      last_rated_at: new Date("2026-09-13T10:00:00Z"),
    },
    {
      condition: "wave",
      score: null,
      sample_size: 2,
      last_rated_at: new Date("2026-09-13T09:00:00Z"),
    },
  ];

  it("aggregates score, sample size, and last-rated timestamp per condition", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("user_id = $2")) {
        return result([
          {
            condition: "crowd",
            last_rated_at: new Date("2026-09-13T10:00:00Z"),
          },
        ]);
      }
      return result(rows);
    });
    const summary = await getBeachAccuracy({ query }, 7, { userId: 42 });
    expect(summary).toHaveLength(2);
    const crowd = summary.find((item) => item.condition === "crowd");
    const wave = summary.find((item) => item.condition === "wave");
    expect(crowd?.score).toBe(0.5);
    expect(crowd?.sampleSize).toBe(4);
    expect(crowd?.lastRatedAt).toBe("2026-09-13T10:00:00.000Z");
    expect(crowd?.yourLastRatedAt).toBe("2026-09-13T10:00:00.000Z");
    // below the default minimum sample size -> null, never a misleading score
    expect(wave?.score).toBeNull();
    expect(wave?.sampleSize).toBe(2);
    expect(wave?.yourLastRatedAt).toBeNull();
  });

  it("returns null scores when below a custom minimum sample size", async () => {
    query.mockResolvedValue(result(rows));
    const summary = await getBeachAccuracy({ query }, 7, {
      minSampleSize: 5,
    });
    expect(summary.every((item) => item.score === null)).toBe(true);
  });

  it("keeps the canonical condition ordering regardless of row order", async () => {
    query.mockResolvedValue(
      result(
        [...ACCURACY_CONDITIONS]
          .map((condition, i) => ({
            condition,
            score: "0.9000000000000000",
            sample_size: 10,
            last_rated_at: new Date("2026-09-13T10:00:00Z"),
            _i: i,
          }))
          .reverse(),
      ),
    );
    const summary = await getBeachAccuracy({ query }, 7);
    expect(summary.map((item) => item.condition)).toEqual([
      ...ACCURACY_CONDITIONS,
    ]);
  });
});

describe("accuracyRouter", () => {
  async function withTestServer(
    handler: (base: string) => Promise<void>,
  ): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use(accuracyRouter);
    app.use(
      (
        error: unknown,
        _request: Request,
        response: Response,
        _next: NextFunction,
      ) => {
        if (error instanceof z.ZodError) {
          response
            .status(400)
            .json({ error: "invalid_request", issues: error.issues });
          return;
        }
        const status =
          typeof error === "object" && error && "status" in error
            ? Number(error.status)
            : 500;
        response.status(status).json({
          error: error instanceof Error ? error.message : "internal_error",
        });
      },
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await handler(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("POST /api/accuracy rejects an invalid condition with 400", async () => {
    await withTestServer(async (base) => {
      const response = await fetch(`${base}/api/accuracy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          beachId: "praia-da-coelha",
          condition: "humidity",
          rating: 0.5,
        }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    });
  });

  it("POST /api/accuracy rejects a body userId that is not the caller", async () => {
    await withTestServer(async (base) => {
      const response = await fetch(`${base}/api/accuracy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          beachId: "praia-da-coelha",
          condition: "crowd",
          rating: 0.5,
          userId: "someone-else",
        }),
      });
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("user_mismatch");
    });
  });

  it("POST /api/accuracy returns 404 for an unknown beach", async () => {
    query.mockResolvedValue(result([]));
    await withTestServer(async (base) => {
      const response = await fetch(`${base}/api/accuracy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          beachId: "no-such-beach",
          condition: "crowd",
          rating: 0.5,
        }),
      });
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("beach_not_found");
    });
  });

  it("POST /api/accuracy records a rating and returns the aggregate", async () => {
    const capturedAt = iso(0);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("select id from beach")) return result([{ id: 7 }]);
      if (sql.includes("captured_at from condition_accuracy_rating"))
        return result([]); // cooldown clear
      if (sql.includes("insert into condition_accuracy_rating"))
        return result([{ captured_at: capturedAt }]);
      if (sql.includes("group by condition")) return result([]);
      if (sql.includes("user_id = $2")) return result([]);
      throw new Error(`unexpected query: ${sql}`);
    });
    await withTestServer(async (base) => {
      const response = await fetch(`${base}/api/accuracy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          beachId: "praia-da-coelha",
          condition: "crowd",
          rating: 0.8,
        }),
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        data: { recorded: boolean; capturedAt: string };
      };
      expect(body.data.recorded).toBe(true);
      expect(Date.parse(body.data.capturedAt)).not.toBeNaN();
    });
  });

  it("POST /api/accuracy enforces the cooldown with 429", async () => {
    const last = "2026-09-13T08:00:00.000Z";
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("select id from beach")) return result([{ id: 7 }]);
      if (sql.includes("captured_at from condition_accuracy_rating"))
        return result([{ captured_at: last }], 1);
      throw new Error(`unexpected query: ${sql}`);
    });
    await withTestServer(async (base) => {
      const response = await fetch(`${base}/api/accuracy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          beachId: "praia-da-coelha",
          condition: "crowd",
          rating: 0.8,
        }),
      });
      expect(response.status).toBe(429);
      const body = (await response.json()) as {
        error: string;
        nextAllowedAt: string;
      };
      expect(body.error).toBe("cooldown_active");
      expect(body.nextAllowedAt).toBe("2026-09-14T08:00:00.000Z");
    });
  });

  it("GET /api/beaches/:id/accuracy returns 404 for an unknown beach", async () => {
    query.mockResolvedValue(result([]));
    await withTestServer(async (base) => {
      const response = await fetch(
        `${base}/api/beaches/no-such-beach/accuracy`,
      );
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("beach_not_found");
    });
  });

  it("GET /api/beaches/:id/accuracy returns the per-condition aggregate", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("select id from beach")) return result([{ id: 7 }]);
      if (sql.includes("user_id = $2"))
        return result([
          {
            condition: "crowd",
            last_rated_at: new Date("2026-09-13T10:00:00Z"),
          },
        ]);
      if (sql.includes("group by condition"))
        return result([
          {
            condition: "crowd",
            score: "0.5500000000000000",
            sample_size: 4,
            last_rated_at: new Date("2026-09-13T10:00:00Z"),
          },
        ]);
      throw new Error(`unexpected query: ${sql}`);
    });
    await withTestServer(async (base) => {
      const response = await fetch(
        `${base}/api/beaches/praia-da-coelha/accuracy`,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { conditions: Array<{ condition: string; score: number }> };
      };
      expect(body.data.conditions).toEqual([
        {
          condition: "crowd",
          score: 0.55,
          sampleSize: 4,
          lastRatedAt: "2026-09-13T10:00:00.000Z",
          yourLastRatedAt: "2026-09-13T10:00:00.000Z",
        },
      ]);
    });
  });
});

describe("module constants", () => {
  it("exposes the cooldown and threshold contract", () => {
    expect(COOLDOWN_HOURS).toBe(24);
    expect(DEFAULT_MIN_SAMPLE_SIZE).toBeGreaterThanOrEqual(1);
  });
});
