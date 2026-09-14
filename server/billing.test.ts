import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  aggregateSettlementRows,
  billingRouter,
  computeRefund,
  computeSettlement,
  renderSettlementCsv,
} from "./billing";

describe("settlement math", () => {
  it("splits gross into commission and net at the configured rate", () => {
    const result = computeSettlement(3200, 500); // 5%
    expect(result.grossCents).toBe(3200);
    expect(result.commissionCents).toBe(160);
    expect(result.netCents).toBe(3040);
  });

  it("rounds commission to the nearest cent", () => {
    const result = computeSettlement(333, 500);
    expect(result.commissionCents).toBe(Math.round((333 * 500) / 10_000));
    expect(result.netCents).toBe(333 - result.commissionCents);
  });

  it("charges zero commission at 0 bps", () => {
    const result = computeSettlement(1000, 0);
    expect(result.commissionCents).toBe(0);
    expect(result.netCents).toBe(1000);
  });

  it("rejects negative gross and out-of-range basis points", () => {
    expect(() => computeSettlement(-1, 500)).toThrow();
    expect(() => computeSettlement(1000, 10_001)).toThrow();
  });
});

describe("refund math", () => {
  const start = new Date("2026-07-01T10:00:00Z");
  it("refunds fully when cancelling more than 24h before start", () => {
    const result = computeRefund(3500, start, new Date("2026-06-30T09:00:00Z"));
    expect(result.tier).toBe("full");
    expect(result.refundCents).toBe(3500);
    expect(result.forfeitCents).toBe(0);
  });

  it("refunds 50% when cancelling inside 24h before start", () => {
    const result = computeRefund(3500, start, new Date("2026-07-01T09:00:00Z"));
    expect(result.tier).toBe("partial");
    expect(result.refundCents).toBe(1750);
    expect(result.forfeitCents).toBe(1750);
  });

  it("refunds nothing once the slot has started", () => {
    const result = computeRefund(3500, start, new Date("2026-07-01T10:30:00Z"));
    expect(result.tier).toBe("none");
    expect(result.refundCents).toBe(0);
    expect(result.forfeitCents).toBe(3500);
  });

  it("rejects negative totals", () => {
    expect(() =>
      computeRefund(-1, start, new Date("2026-06-30T09:00:00Z")),
    ).toThrow();
  });
});

describe("payout aggregation", () => {
  it("sums redeemed bookings so the payout equals gross minus the fee", () => {
    const totals = aggregateSettlementRows([
      {
        gross_cents: 3200,
        commission_cents: 160,
        net_cents: 3040,
        currency: "EUR",
      },
      {
        gross_cents: 1000,
        commission_cents: 50,
        net_cents: 950,
        currency: "EUR",
      },
      {
        gross_cents: 333,
        commission_cents: 17,
        net_cents: 316,
        currency: "EUR",
      },
    ]);
    expect(totals.bookingCount).toBe(3);
    expect(totals.grossCents).toBe(4533);
    expect(totals.commissionCents).toBe(227);
    expect(totals.netCents).toBe(4533 - 227);
    expect(totals.netCents).toBe(4306);
  });

  it("closes an empty period to a zero payout", () => {
    const totals = aggregateSettlementRows([]);
    expect(totals).toEqual({
      bookingCount: 0,
      grossCents: 0,
      commissionCents: 0,
      netCents: 0,
      currency: "EUR",
    });
  });

  it("defaults the currency to the first row's currency", () => {
    const totals = aggregateSettlementRows([
      {
        gross_cents: 500,
        commission_cents: 25,
        net_cents: 475,
        currency: "ZAR",
      },
    ]);
    expect(totals.currency).toBe("ZAR");
  });
});

describe("settlement CSV export", () => {
  const items = [
    {
      public_id: "s-1",
      booking_public_id: "bk-1",
      beach_name: 'Praia "Grande", North',
      booked_at: new Date("2026-09-01T10:00:00Z"),
      redeemed_at: new Date("2026-09-01T11:00:00Z"),
      starts_at: new Date("2026-09-02T10:00:00Z"),
      gross_cents: 3200,
      commission_cents: 160,
      net_cents: 3040,
      currency: "EUR",
    },
    {
      public_id: "s-2",
      booking_public_id: "bk-2",
      beach_name: "Cove",
      booked_at: new Date("2026-09-01T12:00:00Z"),
      redeemed_at: new Date("2026-09-01T13:00:00Z"),
      starts_at: new Date("2026-09-03T10:00:00Z"),
      gross_cents: 1000,
      commission_cents: 50,
      net_cents: 950,
      currency: "EUR",
    },
  ];

  it("renders one row per redeemed booking plus a totals row", () => {
    const csv = renderSettlementCsv(items, {
      grossCents: 4200,
      commissionCents: 210,
      netCents: 3990,
      currency: "EUR",
    });
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("booking_public_id,booked_at,redeemed_at");
    expect(lines[1]).toContain("bk-1");
    expect(lines[2]).toContain("bk-2");
    expect(lines[3]).toContain("TOTAL");
    expect(lines[3]).toContain("3990");
  });

  it("escapes embedded quotes and commas per RFC 4180", () => {
    const csv = renderSettlementCsv(items, {
      grossCents: 4200,
      commissionCents: 210,
      netCents: 3990,
      currency: "EUR",
    });
    const firstRow = csv.split("\r\n")[1];
    expect(firstRow).toContain('"Praia ""Grande"", North"');
  });
});

/**
 * Router tests. The pool is stubbed so these run without Postgres (CI runs
 * `npm test` before migrations). requireUser is replaced with a header-based
 * stand-in so both authenticated and 401 paths are exercisable.
 */
const stub = vi.hoisted(() => {
  type Result = { rows: Record<string, unknown>[]; rowCount: number };
  type Handler = (sql: string, params: unknown[]) => Result | undefined;
  const s = {
    handlers: [] as Handler[],
    calls: [] as Array<{ sql: string; params: unknown[] }>,
    async query(sql: string, params: unknown[] = []): Promise<Result> {
      s.calls.push({ sql, params });
      for (const handler of s.handlers) {
        const result = handler(sql, params);
        if (result) return result;
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return s;
});

vi.mock("./db", () => ({
  pool: {
    query: (sql: string, params?: unknown[]) => stub.query(sql, params),
  },
  withTransaction: (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: (sql: string, params?: unknown[]) => stub.query(sql, params),
    }),
}));

vi.mock("./auth", () => ({
  requireUser: (
    request: { header: (name: string) => string | undefined } & Record<
      string,
      unknown
    >,
    response: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    const id = request.header("x-test-user");
    if (!id) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    request.userId = Number(id);
    next();
  },
  resolveOptionalUser: async () => null,
}));

function makeApp() {
  const app = express();
  app.use("/api/billing", billingRouter);
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        typeof error === "object" && error && "status" in error
          ? Number((error as { status: number }).status)
          : 500;
      response.status(status).json({
        error: error instanceof Error ? error.message : "internal_error",
      });
    },
  );
  return app;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer(makeApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/billing`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  stub.handlers = [];
  stub.calls = [];
});

function on(
  sqlFragment: string,
  result: { rows: Record<string, unknown>[]; rowCount: number },
) {
  stub.handlers.push((sql) =>
    sql.includes(sqlFragment)
      ? { rows: result.rows, rowCount: result.rowCount ?? result.rows.length }
      : undefined,
  );
}

describe("billing router", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await fetch(`${baseUrl}/settlements`);
    expect(response.status).toBe(401);
  });

  it("lists settlement periods with a summary", async () => {
    on("select id from merchant", { rows: [{ id: 7 }], rowCount: 1 });
    on("select id from settlement_period", { rows: [{ id: 1 }], rowCount: 1 });
    on("from settlement_period sp", {
      rows: [
        {
          public_id: "sp-1",
          merchant_id: 7,
          status: "open",
          opened_at: new Date(),
          closed_at: null,
          business_name: "Cove Club",
          pending_count: 2,
          settled_count: 0,
          gross_cents: 4200,
          commission_cents: 210,
          net_cents: 3990,
          currency: "EUR",
          payout_public_id: null,
          payout_status: null,
          payout_closed_at: null,
        },
      ],
      rowCount: 1,
    });
    on("from settlement s", {
      rows: [
        {
          open_item_count: 2,
          open_net_cents: 3990,
          awaiting_redemption_count: 1,
          awaiting_redemption_net_cents: 500,
        },
      ],
      rowCount: 1,
    });
    on("from payout p", {
      rows: [{ payout_count: 0, paid_net_cents: 0 }],
      rowCount: 1,
    });
    const response = await fetch(`${baseUrl}/settlements`, {
      headers: { "x-test-user": "1" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { periods: unknown[]; summary: Record<string, number> };
    };
    expect(body.data.periods).toHaveLength(1);
    expect(body.data.summary.open_net_cents).toBe(3990);
    // The lazy roll-in attached the merchant's redeemed bookings.
    expect(
      stub.calls.some((call) => call.sql.includes("set period_id = $2")),
    ).toBe(true);
  });

  it("returns 404 for another owner's settlement period", async () => {
    on("where sp.public_id = $1", { rows: [], rowCount: 0 });
    const response = await fetch(
      `${baseUrl}/settlements/00000000-0000-4000-8000-000000000001`,
      {
        headers: { "x-test-user": "1" },
      },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("settlement_not_found");

    const csv = await fetch(
      `${baseUrl}/settlements/00000000-0000-4000-8000-000000000001/export.csv`,
      { headers: { "x-test-user": "1" } },
    );
    expect(csv.status).toBe(404);

    const close = await fetch(
      `${baseUrl}/settlements/00000000-0000-4000-8000-000000000001/close`,
      { method: "POST", headers: { "x-test-user": "1" } },
    );
    expect(close.status).toBe(404);
  });

  it("closes an open period into a payout net of the platform fee", async () => {
    on("where sp.public_id = $1", {
      rows: [
        {
          id: 1,
          public_id: "sp-1",
          merchant_id: 7,
          status: "open",
          opened_at: new Date(),
          closed_at: null,
          business_name: "Cove Club",
        },
      ],
      rowCount: 1,
    });
    on("select id from settlement_period", { rows: [{ id: 1 }], rowCount: 1 });
    on("select gross_cents, commission_cents", {
      rows: [
        {
          gross_cents: 3200,
          commission_cents: 160,
          net_cents: 3040,
          currency: "EUR",
        },
        {
          gross_cents: 1000,
          commission_cents: 50,
          net_cents: 950,
          currency: "EUR",
        },
      ],
      rowCount: 2,
    });
    on("insert into payout(", {
      rows: [
        {
          public_id: "po-1",
          booking_count: 2,
          gross_cents: 4200,
          commission_cents: 210,
          net_cents: 3990,
          currency: "EUR",
          status: "scheduled",
          closed_at: new Date(),
        },
      ],
      rowCount: 1,
    });
    const response = await fetch(`${baseUrl}/settlements/sp-1/close`, {
      method: "POST",
      headers: { "x-test-user": "1" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        gross_cents: number;
        commission_cents: number;
        net_cents: number;
      };
    };
    expect(body.data.gross_cents).toBe(4200);
    expect(body.data.commission_cents).toBe(210);
    expect(body.data.net_cents).toBe(4200 - 210);
    expect(body.data.net_cents).toBe(3990);
    expect(
      stub.calls.some((call) => call.sql.includes("set status = 'settled'")),
    ).toBe(true);
    expect(
      stub.calls.some((call) =>
        call.sql.includes("update settlement_period set status = 'closed'"),
      ),
    ).toBe(true);
  });

  it("refuses to close an already-closed period with 409", async () => {
    on("where sp.public_id = $1", {
      rows: [
        {
          id: 1,
          public_id: "sp-1",
          merchant_id: 7,
          status: "closed",
          opened_at: new Date(),
          closed_at: new Date(),
          business_name: "Cove Club",
        },
      ],
      rowCount: 1,
    });
    const response = await fetch(`${baseUrl}/settlements/sp-1/close`, {
      method: "POST",
      headers: { "x-test-user": "1" },
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("period_already_closed");
  });

  it("exports a settlement period as CSV with one row per booking", async () => {
    on("where sp.public_id = $1", {
      rows: [
        {
          id: 1,
          public_id: "sp-1",
          merchant_id: 7,
          status: "open",
          opened_at: new Date(),
          closed_at: null,
          business_name: "Cove Club",
        },
      ],
      rowCount: 1,
    });
    on("select id from settlement_period", { rows: [{ id: 1 }], rowCount: 1 });
    on("select s.public_id, bk.public_id as booking_public_id", {
      rows: [
        {
          public_id: "s-1",
          booking_public_id: "bk-1",
          beach_name: "Cove",
          booked_at: new Date("2026-09-01T10:00:00Z"),
          redeemed_at: new Date("2026-09-01T11:00:00Z"),
          starts_at: new Date("2026-09-02T10:00:00Z"),
          gross_cents: 3200,
          commission_cents: 160,
          net_cents: 3040,
          currency: "EUR",
        },
        {
          public_id: "s-2",
          booking_public_id: "bk-2",
          beach_name: "Cove",
          booked_at: new Date("2026-09-01T12:00:00Z"),
          redeemed_at: new Date("2026-09-01T13:00:00Z"),
          starts_at: new Date("2026-09-03T10:00:00Z"),
          gross_cents: 1000,
          commission_cents: 50,
          net_cents: 950,
          currency: "EUR",
        },
      ],
      rowCount: 2,
    });
    const response = await fetch(`${baseUrl}/settlements/sp-1/export.csv`, {
      headers: { "x-test-user": "1" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "settlement-sp-1.csv",
    );
    const csv = await response.text();
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("booking_public_id,booked_at,redeemed_at");
    expect(lines[1]).toContain("bk-1");
    expect(lines[2]).toContain("bk-2");
    expect(lines[3]).toContain("TOTAL");
    expect(lines[3]).toContain("3990");
  });
});
