import { Router } from "express";
import type { Pool } from "pg";
import { requireUser } from "./auth";
import { pool, withTransaction } from "./db";

export type SettlementBreakdown = {
  grossCents: number;
  commissionCents: number;
  netCents: number;
};

export function computeSettlement(
  grossCents: number,
  commissionBasisPoints: number,
): SettlementBreakdown {
  if (grossCents < 0) throw new Error("gross_cents_negative");
  if (commissionBasisPoints < 0 || commissionBasisPoints > 10_000) {
    throw new Error("commission_basis_points_out_of_range");
  }
  const commissionCents = Math.round(
    (grossCents * commissionBasisPoints) / 10_000,
  );
  return {
    grossCents,
    commissionCents,
    netCents: grossCents - commissionCents,
  };
}

export type RefundResult = {
  refundCents: number;
  forfeitCents: number;
  tier: "full" | "partial" | "none";
};

/**
 * PRD §8.8: free cancellation until 24 hours before start; 50% refund inside
 * 24 hours; no refund once the slot has started (treated as no-show).
 */
export function computeRefund(
  totalCents: number,
  startsAt: Date,
  now: Date = new Date(),
): RefundResult {
  if (totalCents < 0) throw new Error("total_cents_negative");
  const msUntilStart = startsAt.getTime() - now.getTime();
  if (msUntilStart >= 24 * 60 * 60 * 1_000) {
    return { refundCents: totalCents, forfeitCents: 0, tier: "full" };
  }
  if (msUntilStart > 0) {
    const refundCents = Math.round(totalCents / 2);
    return {
      refundCents,
      forfeitCents: totalCents - refundCents,
      tier: "partial",
    };
  }
  return { refundCents: 0, forfeitCents: totalCents, tier: "none" };
}

/**
 * Merchant settlement engine.
 *
 * Redeemed bookings roll into one open settlement period per merchant
 * (`settlement_period`, partial unique index on open periods). Closing a
 * period produces a `payout` record whose amounts are the sum of the period's
 * redeemed line items minus the platform commission already recorded per
 * booking at checkout time. The roll-in is lazy: the redemption endpoint lives
 * in index.ts, so attachment happens on read/close via `syncMerchantSettlements`.
 *
 * All queries are merchant-owner scoped: a period that does not belong to the
 * requesting user is reported as 404 (no enumeration), matching the
 * /api/me/trips/:tripId precedent.
 */

/** Anything that can run SQL — a pool for reads, a client inside a transaction. */
type Queryable = Pick<Pool, "query">;

type PeriodCoreRow = {
  id: number;
  merchant_id: number;
  status: "open" | "closed";
  public_id: string;
  opened_at: Date;
  closed_at: Date | null;
  business_name: string;
};

type SettlementItemRow = {
  public_id: string;
  booking_public_id: string;
  beach_name: string;
  booked_at: Date;
  redeemed_at: Date;
  starts_at: Date;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  currency: string;
};

type PayoutRow = {
  public_id: string;
  booking_count: number;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  currency: string;
  status: string;
  closed_at: Date;
};

type PeriodListRow = PeriodCoreRow & {
  pending_count: number;
  settled_count: number;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  currency: string;
  payout_public_id: string | null;
  payout_status: string | null;
  payout_closed_at: Date | null;
};

function notFound(): Error {
  return Object.assign(new Error("settlement_not_found"), { status: 404 });
}

/**
 * Get (or create) the merchant's single open period and lock it for the rest
 * of the current transaction. The FOR UPDATE serializes close against
 * roll-in: a concurrent sync blocks here until the close commits, then sees
 * the freshly closed period and attaches to a new open one instead.
 */
async function ensureOpenPeriod(
  client: Queryable,
  merchantId: number,
): Promise<number> {
  await client.query(
    `insert into settlement_period(merchant_id) values ($1)
     on conflict (merchant_id) where status = 'open' do nothing`,
    [merchantId],
  );
  const result = await client.query<{ id: number }>(
    `select id from settlement_period
     where merchant_id = $1 and status = 'open'
     for update`,
    [merchantId],
  );
  return result.rows[0].id;
}

/**
 * Attach redeemed-but-unattached settlement rows to the merchant's open
 * period. Rows keep status 'pending' (still owed) until the period closes.
 * Runs in its own transaction so the period lock covers the attach.
 */
async function syncMerchantSettlements(merchantId: number): Promise<void> {
  await withTransaction(async (client) => {
    const periodId = await ensureOpenPeriod(client, merchantId);
    await client.query(
      `update settlement s
       set period_id = $2
       from booking bk
       where s.booking_id = bk.id
         and s.merchant_id = $1
         and s.period_id is null
         and s.status = 'pending'
         and bk.status = 'redeemed'`,
      [merchantId, periodId],
    );
  });
}

async function loadPeriod(
  client: Queryable,
  periodPublicId: string,
  ownerUserId: number,
  lock: boolean,
): Promise<PeriodCoreRow> {
  const result = await client.query<PeriodCoreRow>(
    `select sp.id, sp.public_id, sp.merchant_id, sp.status,
       sp.opened_at, sp.closed_at, m.business_name
     from settlement_period sp
     join merchant m on m.id = sp.merchant_id
     where sp.public_id = $1 and m.owner_user_id = $2
     ${lock ? "for update of sp" : ""}`,
    [periodPublicId, ownerUserId],
  );
  if (!result.rowCount) throw notFound();
  return result.rows[0];
}

function periodItemsQuery() {
  return `select s.public_id, bk.public_id as booking_public_id,
      b.name as beach_name, s.created_at as booked_at,
      bk.updated_at as redeemed_at, bk.starts_at,
      s.gross_cents, s.commission_cents, s.net_cents, s.currency
    from settlement s
    join booking bk on bk.id = s.booking_id
    join beach b on b.id = bk.beach_id
    where s.period_id = $1 and s.status in ('pending', 'settled')
    order by bk.updated_at asc, s.id asc`;
}

async function loadPayout(
  client: Queryable,
  periodId: number,
): Promise<PayoutRow | null> {
  const result = await client.query<PayoutRow>(
    `select public_id, booking_count, gross_cents, commission_cents,
       net_cents, currency, status, closed_at
     from payout where period_id = $1`,
    [periodId],
  );
  return result.rowCount ? result.rows[0] : null;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function iso(value: Date | null): string {
  return value ? new Date(value).toISOString() : "";
}

/**
 * CSV export body for a settlement period: one row per redeemed booking with
 * timestamps, plus a totals row. RFC 4180 quoting for every field.
 */
export function renderSettlementCsv(
  items: SettlementItemRow[],
  totals: {
    grossCents: number;
    commissionCents: number;
    netCents: number;
    currency: string;
  },
): string {
  const header = [
    "booking_public_id",
    "booked_at",
    "redeemed_at",
    "starts_at",
    "beach_name",
    "gross_cents",
    "commission_cents",
    "net_cents",
    "currency",
  ];
  const rows = items.map((item) =>
    [
      item.booking_public_id,
      iso(item.booked_at),
      iso(item.redeemed_at),
      iso(item.starts_at),
      item.beach_name,
      item.gross_cents,
      item.commission_cents,
      item.net_cents,
      item.currency,
    ]
      .map(csvCell)
      .join(","),
  );
  const total = [
    "TOTAL",
    "",
    "",
    "",
    items.length,
    totals.grossCents,
    totals.commissionCents,
    totals.netCents,
    totals.currency,
  ]
    .map(csvCell)
    .join(",");
  return [header.join(","), ...rows, total].join("\r\n");
}

export type PayoutTotals = {
  bookingCount: number;
  grossCents: number;
  commissionCents: number;
  netCents: number;
  currency: string;
};

/**
 * Sum the per-booking settlement rows into payout amounts. The per-row net is
 * the gross minus the platform fee recorded at checkout time (via
 * computeSettlement), so the payout is net of the fee by construction —
 * closing a period must never re-derive commission from the merchant's
 * *current* rate, which can change after the bookings were taken.
 */
export function aggregateSettlementRows(
  rows: Array<{
    gross_cents: number;
    commission_cents: number;
    net_cents: number;
    currency: string;
  }>,
): PayoutTotals {
  const totals = rows.reduce(
    (acc, row) => ({
      grossCents: acc.grossCents + row.gross_cents,
      commissionCents: acc.commissionCents + row.commission_cents,
      netCents: acc.netCents + row.net_cents,
    }),
    { grossCents: 0, commissionCents: 0, netCents: 0 },
  );
  return {
    bookingCount: rows.length,
    grossCents: totals.grossCents,
    commissionCents: totals.commissionCents,
    netCents: totals.netCents,
    currency: rows[0]?.currency ?? "EUR",
  };
}

export const billingRouter = Router();

/**
 * GET /api/billing/settlements
 * Every settlement period of the caller's merchants, after rolling any
 * redeemed bookings into their open periods. Merchants with no bookings see
 * an auto-created empty open period, so the surface is never a blank screen.
 */
billingRouter.get("/settlements", requireUser, async (request, response) => {
  const merchants = await pool.query<{ id: number }>(
    `select id from merchant where owner_user_id = $1 order by id`,
    [request.userId],
  );
  for (const merchant of merchants.rows) {
    await syncMerchantSettlements(merchant.id);
  }
  const periods = await pool.query<PeriodListRow>(
    `select sp.public_id, sp.merchant_id, sp.status, sp.opened_at, sp.closed_at,
       m.business_name,
       count(s.id) filter (where s.status = 'pending')::int as pending_count,
       count(s.id) filter (where s.status = 'settled')::int as settled_count,
       coalesce(sum(s.gross_cents), 0)::int as gross_cents,
       coalesce(sum(s.commission_cents), 0)::int as commission_cents,
       coalesce(sum(s.net_cents), 0)::int as net_cents,
       coalesce(min(s.currency), 'EUR') as currency,
       p.public_id as payout_public_id, p.status as payout_status,
       p.closed_at as payout_closed_at
     from settlement_period sp
     join merchant m on m.id = sp.merchant_id
     left join settlement s
       on s.period_id = sp.id and s.status in ('pending', 'settled')
     left join payout p on p.period_id = sp.id
     where m.owner_user_id = $1
     group by sp.id, m.business_name, p.public_id, p.status, p.closed_at
     order by (sp.status = 'open') desc, sp.closed_at desc, sp.opened_at desc`,
    [request.userId],
  );
  const [pending, paid] = await Promise.all([
    pool.query(
      `select
         count(*) filter (where s.period_id is not null)::int as open_item_count,
         coalesce(sum(s.net_cents) filter (where s.period_id is not null), 0)::int
           as open_net_cents,
         count(*) filter (where s.period_id is null)::int
           as awaiting_redemption_count,
         coalesce(sum(s.net_cents) filter (where s.period_id is null), 0)::int
           as awaiting_redemption_net_cents
       from settlement s
       join merchant m on m.id = s.merchant_id
       where m.owner_user_id = $1 and s.status = 'pending'`,
      [request.userId],
    ),
    pool.query(
      `select count(*)::int as payout_count,
         coalesce(sum(net_cents), 0)::int as paid_net_cents
       from payout p
       join merchant m on m.id = p.merchant_id
       where m.owner_user_id = $1`,
      [request.userId],
    ),
  ]);
  response.json({
    data: {
      periods: periods.rows,
      summary: { ...pending.rows[0], ...paid.rows[0] },
    },
  });
});

/**
 * GET /api/billing/settlements/:periodPublicId
 * One period with its line items and payout (when closed). A foreign owner's
 * period id is a 404, indistinguishable from an unknown one.
 */
billingRouter.get(
  "/settlements/:periodPublicId",
  requireUser,
  async (request, response) => {
    const period = await loadPeriod(
      pool,
      String(request.params.periodPublicId),
      request.userId!,
      false,
    );
    if (period.status === "open") {
      await syncMerchantSettlements(period.merchant_id);
    }
    const [items, payout] = await Promise.all([
      pool.query<SettlementItemRow>(periodItemsQuery(), [period.id]),
      loadPayout(pool, period.id),
    ]);
    response.json({
      data: { period, items: items.rows, payout },
    });
  },
);

/**
 * POST /api/billing/settlements/:periodPublicId/close
 * Atomically closes the period: attaches any last redemptions, aggregates the
 * pending line items, writes a payout (net of the per-booking platform fee
 * already recorded at checkout), marks the items settled, and closes the
 * period. Idempotence guard: a second close is a 409.
 */
billingRouter.post(
  "/settlements/:periodPublicId/close",
  requireUser,
  async (request, response) => {
    const payout = await withTransaction(async (client) => {
      const period = await loadPeriod(
        client,
        String(request.params.periodPublicId),
        request.userId!,
        true,
      );
      if (period.status !== "open") {
        throw Object.assign(new Error("period_already_closed"), {
          status: 409,
        });
      }
      // Attach any redemptions that raced in before aggregating.
      const periodId = await ensureOpenPeriod(client, period.merchant_id);
      await client.query(
        `update settlement s
         set period_id = $2
         from booking bk
         where s.booking_id = bk.id
           and s.merchant_id = $1
           and s.period_id is null
           and s.status = 'pending'
           and bk.status = 'redeemed'`,
        [period.merchant_id, periodId],
      );
      const pendingItems = await client.query<{
        gross_cents: number;
        commission_cents: number;
        net_cents: number;
        currency: string;
      }>(
        `select gross_cents, commission_cents, net_cents, currency
         from settlement
         where period_id = $1 and status = 'pending'`,
        [period.id],
      );
      const totals = aggregateSettlementRows(pendingItems.rows);
      let created;
      try {
        created = await client.query<PayoutRow>(
          `insert into payout(
             period_id, merchant_id, booking_count, gross_cents,
             commission_cents, net_cents, currency, closed_at
           )
           values ($1, $2, $3, $4, $5, $6, $7, now())
           returning public_id, booking_count, gross_cents,
             commission_cents, net_cents, currency, status, closed_at`,
          [
            period.id,
            period.merchant_id,
            totals.bookingCount,
            totals.grossCents,
            totals.commissionCents,
            totals.netCents,
            totals.currency,
          ],
        );
      } catch (error) {
        if (
          typeof error === "object" &&
          error &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw Object.assign(new Error("payout_already_exists"), {
            status: 409,
          });
        }
        throw error;
      }
      await client.query(
        `update settlement set status = 'settled', settled_at = now()
         where period_id = $1 and status = 'pending'`,
        [period.id],
      );
      await client.query(
        `update settlement_period set status = 'closed', closed_at = now()
         where id = $1`,
        [period.id],
      );
      return created.rows[0];
    });
    await pool.query(
      `insert into audit_log(actor_user_id, action, target, properties)
       values ($1, 'settlement_period_closed', $2, '{}'::jsonb)`,
      [request.userId, request.params.periodPublicId],
    );
    response.json({ data: payout });
  },
);

/**
 * GET /api/billing/settlements/:periodPublicId/export.csv
 * Line-item CSV download for one period: one row per redeemed booking with
 * timestamps, plus a totals row. Open periods export their pending roll-up;
 * closed periods export what was paid out.
 */
billingRouter.get(
  "/settlements/:periodPublicId/export.csv",
  requireUser,
  async (request, response) => {
    const period = await loadPeriod(
      pool,
      String(request.params.periodPublicId),
      request.userId!,
      false,
    );
    if (period.status === "open") {
      await syncMerchantSettlements(period.merchant_id);
    }
    const [items, payout] = await Promise.all([
      pool.query<SettlementItemRow>(periodItemsQuery(), [period.id]),
      loadPayout(pool, period.id),
    ]);
    const totals = payout
      ? {
          grossCents: payout.gross_cents,
          commissionCents: payout.commission_cents,
          netCents: payout.net_cents,
          currency: payout.currency,
        }
      : {
          grossCents: items.rows.reduce((sum, i) => sum + i.gross_cents, 0),
          commissionCents: items.rows.reduce(
            (sum, i) => sum + i.commission_cents,
            0,
          ),
          netCents: items.rows.reduce((sum, i) => sum + i.net_cents, 0),
          currency: items.rows[0]?.currency ?? "EUR",
        };
    response
      .type("text/csv")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="settlement-${period.public_id}.csv"`,
      )
      .send(renderSettlementCsv(items.rows, totals));
  },
);
