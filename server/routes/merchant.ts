import express from "express";
import { z } from "zod";
import { audit } from "../audit";
import { pool } from "../db";
import { verifyBookingToken } from "../tokens";
export const merchantRouter = express.Router();

merchantRouter.get("/api/merchant/dashboard", async (request, response) => {
  const [summary, inventory, bookings] = await Promise.all([
    pool.query(
      `select
         count(*) filter (
           where bk.starts_at::date = (now() at time zone b.timezone)::date
             and bk.status in ('confirmed', 'redeemed')
         )::int as today_bookings,
         count(*) filter (
           where bk.starts_at >= now()
             and bk.status = 'confirmed'
         )::int as upcoming_bookings,
         coalesce(sum(bk.total_cents) filter (
           where bk.status in ('confirmed', 'redeemed')
         ), 0)::int as gross_cents,
         coalesce(sum(bk.total_cents) filter (
           where bk.status in ('confirmed', 'redeemed')
             and bk.starts_at >= now() - interval '7 days'
         ), 0)::int as weekly_gmv_cents,
         count(*) filter (where bk.user_id = $1)::int as self_bookings,
         count(distinct bk.user_id)::int as distinct_guests,
         count(distinct m.id)::int as locations
       from merchant m
       join beach b on b.id = m.beach_id
       left join booking bk on bk.merchant_id = m.id
       where m.owner_user_id = $1`,
      [request.userId],
    ),
    pool.query(
      `select
         ai.public_id, ai.amenity_type, ai.total_count, ai.available_count,
         ai.price_cents, ai.currency, ai.version, ai.updated_at,
         m.business_name, b.name as beach_name, b.public_id as beach_public_id
       from amenity_inventory ai
       join merchant m on m.id = ai.merchant_id
       join beach b on b.id = m.beach_id
       where m.owner_user_id = $1
       order by b.name, ai.amenity_type`,
      [request.userId],
    ),
    pool.query(
      `select
         bk.public_id, bk.starts_at, bk.status, bk.total_cents, bk.currency,
         bk.qr_token, b.name as beach_name, u.display_name as guest_name,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'type', ai.amenity_type,
               'quantity', bi.quantity
             )
             order by ai.amenity_type
           ) filter (where ai.id is not null),
           '[]'::jsonb
         ) as items
       from booking bk
       join merchant m on m.id = bk.merchant_id
       join beach b on b.id = bk.beach_id
       join app_user u on u.id = bk.user_id
       left join booking_item bi on bi.booking_id = bk.id
       left join amenity_inventory ai on ai.id = bi.inventory_id
       where m.owner_user_id = $1
       group by bk.id, b.id, u.id
       order by
         case when bk.status = 'confirmed' then 0 else 1 end,
         bk.starts_at desc
       limit 20`,
      [request.userId],
    ),
  ]);

  response.json({
    data: {
      summary: summary.rows[0],
      inventory: inventory.rows,
      bookings: bookings.rows,
    },
  });
});

const inventoryUpdateSchema = z
  .object({
    availableCount: z.number().int().min(0).optional(),
    priceCents: z.number().int().min(0).max(1_000_000).optional(),
    version: z.number().int().positive(),
  })
  .refine(
    (value) =>
      value.availableCount !== undefined || value.priceCents !== undefined,
    { message: "No inventory changes supplied" },
  );

merchantRouter.patch(
  "/api/merchant/inventory/:inventoryPublicId",
  async (request, response) => {
    const input = inventoryUpdateSchema.parse(request.body);
    const result = await pool.query(
      `update amenity_inventory ai
       set available_count = coalesce($1, ai.available_count),
           price_cents = coalesce($2, ai.price_cents),
           version = ai.version + 1,
           updated_at = now()
       from merchant m
       where ai.merchant_id = m.id
         and m.owner_user_id = $3
         and ai.public_id = $4
         and ai.version = $5
         and coalesce($1, ai.available_count) <= ai.total_count
       returning
         ai.public_id, ai.available_count, ai.price_cents, ai.version,
         ai.updated_at`,
      [
        input.availableCount ?? null,
        input.priceCents ?? null,
        request.userId,
        request.params.inventoryPublicId,
        input.version,
      ],
    );
    if (!result.rowCount) {
      const exists = await pool.query(
        `select ai.version
         from amenity_inventory ai
         join merchant m on m.id = ai.merchant_id
         where ai.public_id = $1 and m.owner_user_id = $2`,
        [request.params.inventoryPublicId, request.userId],
      );
      response.status(exists.rowCount ? 409 : 404).json({
        error: exists.rowCount
          ? "inventory_changed_refresh"
          : "inventory_not_found",
      });
      return;
    }
    await audit(
      request.userId,
      "inventory_updated",
      request.params.inventoryPublicId,
      {
        availableCount: input.availableCount,
        priceCents: input.priceCents,
        version: input.version,
      },
    );
    response.json({ data: result.rows[0] });
  },
);

const redeemSchema = z.object({
  qrToken: z.string().min(1).max(400),
});

merchantRouter.post(
  "/api/merchant/bookings/:bookingPublicId/redeem",
  async (request, response) => {
    const input = redeemSchema.parse(request.body);
    const verified = verifyBookingToken(input.qrToken);
    if (
      !verified ||
      verified.bookingPublicId !== request.params.bookingPublicId
    ) {
      response.status(401).json({ error: "qr_token_invalid" });
      return;
    }
    if (verified.expired) {
      response.status(409).json({ error: "qr_token_expired" });
      return;
    }
    const result = await pool.query(
      `update booking bk
       set status = 'redeemed', updated_at = now()
       from merchant m
       where bk.merchant_id = m.id
         and m.owner_user_id = $1
         and bk.public_id = $2
         and bk.qr_token = $3
         and bk.status = 'confirmed'
       returning bk.public_id, bk.status, bk.updated_at`,
      [request.userId, request.params.bookingPublicId, input.qrToken],
    );
    if (!result.rowCount) {
      response.status(409).json({ error: "booking_not_redeemable" });
      return;
    }
    await audit(
      request.userId,
      "booking_redeemed",
      result.rows[0].public_id,
      {},
    );
    response.json({ data: result.rows[0] });
  },
);

merchantRouter.get("/api/merchant/settlements", async (request, response) => {
  const result = await pool.query(
    `select s.public_id, s.gross_cents, s.commission_cents, s.net_cents,
       s.currency, s.status, s.settled_at, s.created_at,
       b.name as beach_name, bk.public_id as booking_public_id, bk.starts_at
     from settlement s
     join merchant m on m.id = s.merchant_id
     join booking bk on bk.id = s.booking_id
     join beach b on b.id = bk.beach_id
     where m.owner_user_id = $1
     order by s.created_at desc
     limit 50`,
    [request.userId],
  );
  const summary = await pool.query(
    `select coalesce(sum(s.net_cents), 0)::int as net_payable,
       count(*) filter (where s.status = 'pending')::int as pending,
       count(*) filter (where s.status = 'settled')::int as settled
     from settlement s
     join merchant m on m.id = s.merchant_id
     where m.owner_user_id = $1`,
    [request.userId],
  );
  response.json({
    data: { settlements: result.rows, summary: summary.rows[0] },
  });
});

const claimSchema = z.object({
  beachPublicId: z.string().uuid(),
  businessName: z.string().trim().min(1).max(120),
});

merchantRouter.post("/api/merchant/claim", async (request, response) => {
  const input = claimSchema.parse(request.body);
  const beach = await pool.query<{ id: number; name: string }>(
    "select id, name from beach where public_id = $1",
    [input.beachPublicId],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const existing = await pool.query(
    `select 1 from merchant m
     join institution_member im on im.user_id = m.owner_user_id
     where m.beach_id = $1 and m.kyc_status = 'verified'`,
    [beach.rows[0].id],
  );
  const claim = await pool.query<{ public_id: string }>(
    `insert into merchant_claim(user_id, beach_id, business_name)
     values ($1, $2, $3)
     on conflict (user_id, beach_id) do update set business_name = excluded.business_name
     returning public_id`,
    [request.userId, beach.rows[0].id, input.businessName],
  );
  await audit(request.userId, "merchant_claimed", input.beachPublicId, {
    business: input.businessName,
    contested: Boolean(existing.rowCount),
  });
  response.status(201).json({
    data: { public_id: claim.rows[0].public_id, status: "pending" },
  });
});

merchantRouter.get("/api/merchant/profile", async (request, response) => {
  const result = await pool.query(
    `select m.public_id, m.business_name, m.kyc_status, b.name as beach_name, b.public_id as beach_public_id
     from merchant m join beach b on b.id = m.beach_id
     where m.owner_user_id = $1
     order by m.created_at desc`,
    [request.userId],
  );
  response.json({ data: result.rows });
});

const createInventorySchema = z.object({
  beachPublicId: z.string().uuid(),
  amenityType: z.enum(["sunbed", "umbrella", "cabana", "activity"]),
  totalCount: z.number().int().min(0).max(500),
  priceCents: z.number().int().min(0).max(1_000_000),
  slotDurationMinutes: z.number().int().min(15).max(480).default(360),
  label: z.string().trim().max(80).optional(),
  description: z.string().trim().max(200).optional(),
});

merchantRouter.post("/api/merchant/inventory", async (request, response) => {
  const input = createInventorySchema.parse(request.body);
  const merchant = await pool.query<{ id: number }>(
    `select m.id from merchant m join beach b on b.id = m.beach_id
     where m.owner_user_id = $1 and b.public_id = $2 and m.kyc_status = 'verified'`,
    [request.userId, input.beachPublicId],
  );
  if (!merchant.rowCount) {
    response.status(404).json({ error: "merchant_not_found" });
    return;
  }
  const result = await pool.query(
    `insert into amenity_inventory(
       merchant_id, amenity_type, total_count, available_count,
       price_cents, slot_duration_minutes, label, description
     )
     values ($1, $2, $3, $3, $4, $5, $6, $7)
     on conflict (merchant_id, amenity_type) do update set
       total_count = excluded.total_count,
       available_count = least(excluded.total_count, amenity_inventory.available_count),
       price_cents = excluded.price_cents,
       slot_duration_minutes = excluded.slot_duration_minutes,
       label = excluded.label,
       description = excluded.description,
       version = amenity_inventory.version + 1,
       updated_at = now()
     returning public_id, amenity_type, total_count, available_count, price_cents, version`,
    [
      merchant.rows[0].id,
      input.amenityType,
      input.totalCount,
      input.priceCents,
      input.slotDurationMinutes,
      input.label ?? null,
      input.description ?? null,
    ],
  );
  await audit(request.userId, "inventory_created", result.rows[0].public_id, {
    amenityType: input.amenityType,
  });
  response.status(201).json({ data: result.rows[0] });
});

// ---------------------------------------------------------------------------
// Settlement ledger (merchant B2B payouts surface)
// ---------------------------------------------------------------------------

/** Merchant-facing ledger state: booked → redeemed → settled. */
export type LedgerState = "booked" | "redeemed" | "settled";

export type LedgerStatusInput = {
  booking_status: string;
  settlement_status: string | null;
};

/**
 * Maps the raw booking/settlement statuses onto the three merchant-facing
 * ledger states.
 *
 *   booked   — confirmed reservation, guest has not redeemed yet (still
 *               cancellable, so NOT part of the payout balance)
 *   redeemed — the merchant has served the booking; earned but not yet paid
 *   settled  — the settlement row closed as settled (paid out)
 *
 * Money that went back to the guest (refunded settlement or booking) is off
 * the ledger. Cancelled/no-show bookings with a still-pending settlement
 * are off the ledger too — but a cancelled booking whose settlement already
 * closed as settled stays in as settled: a no-refund cancellation is a
 * legitimate forfeiture (server/bookings.ts marks it settled), so that money
 * was really paid to the merchant and must not vanish from payouts.
 */
export function deriveLedgerState(row: LedgerStatusInput): LedgerState | null {
  if (
    row.settlement_status === "refunded" ||
    row.booking_status === "refunded"
  ) {
    return null;
  }
  if (row.settlement_status === "settled") return "settled";
  if (row.booking_status === "cancelled" || row.booking_status === "no_show") {
    return null;
  }
  if (row.booking_status === "redeemed") return "redeemed";
  return "booked";
}

export type SettlementBalances = {
  /** Net cents earned (redeemed, not yet paid out) — available for payout. */
  availableCents: number;
  /** Net cents booked but not yet redeemed — still cancellable, not payout money. */
  inProgressCents: number;
  /** Net cents already settled (paid out to the merchant). */
  paidCents: number;
};

export function computeSettlementBalances(
  rows: Array<{ state: LedgerState; netCents: number }>,
): SettlementBalances {
  const balances: SettlementBalances = {
    availableCents: 0,
    inProgressCents: 0,
    paidCents: 0,
  };
  for (const row of rows) {
    if (row.state === "redeemed") balances.availableCents += row.netCents;
    else if (row.state === "booked") balances.inProgressCents += row.netCents;
    else balances.paidCents += row.netCents;
  }
  return balances;
}

type LedgerEntry = {
  booking_public_id: string;
  beach_name: string;
  starts_at: Date;
  created_at: Date;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  currency: string;
  state: LedgerState;
  settled_at: Date | null;
};

type PayoutEntry = {
  settlement_public_id: string | null;
  booking_public_id: string;
  beach_name: string;
  net_cents: number;
  currency: string;
  settled_at: Date;
};

/**
 * GET /api/merchant/settlements/ledger — the B2B payouts surface backing the
 * merchant SettlementDashboard: the booked/redeemed/settled transaction
 * ledger, the derived payout history (one entry per settled settlement —
 * there is no separate payout table), and the computed balances. Owner-
 * scoped like every other merchant route (requireUser is mounted at
 * /api/merchant in index.ts; non-owners simply get an empty ledger).
 *
 * The balances are computed over the merchant's FULL history — only the
 * returned row lists are display-capped, so a high-volume merchant's
 * available-for-payout figure can never be truncated by the cap.
 */
const MAX_LEDGER_ROWS = 200;
const MAX_PAYOUT_ROWS = 50;

merchantRouter.get(
  "/api/merchant/settlements/ledger",
  async (request, response) => {
    const result = await pool.query(
      `select
         bk.public_id as booking_public_id, b.name as beach_name,
         bk.starts_at, bk.created_at, bk.status as booking_status,
         coalesce(s.gross_cents, bk.total_cents) as gross_cents,
         coalesce(s.commission_cents, bk.commission_cents) as commission_cents,
         coalesce(s.net_cents, bk.total_cents - bk.commission_cents) as net_cents,
         bk.currency, s.status as settlement_status, s.settled_at,
         s.public_id as settlement_public_id
       from merchant m
       join booking bk on bk.merchant_id = m.id
       join beach b on b.id = bk.beach_id
       left join settlement s on s.booking_id = bk.id
       where m.owner_user_id = $1
       order by bk.created_at desc`,
      [request.userId],
    );
    const ledger: LedgerEntry[] = [];
    const payouts: PayoutEntry[] = [];
    for (const row of result.rows) {
      const state = deriveLedgerState(row);
      if (!state) continue;
      ledger.push({
        booking_public_id: row.booking_public_id,
        beach_name: row.beach_name,
        starts_at: row.starts_at,
        created_at: row.created_at,
        gross_cents: row.gross_cents,
        commission_cents: row.commission_cents,
        net_cents: row.net_cents,
        currency: row.currency,
        state,
        settled_at: row.settled_at,
      });
      if (state === "settled" && row.settled_at) {
        payouts.push({
          settlement_public_id: row.settlement_public_id,
          booking_public_id: row.booking_public_id,
          beach_name: row.beach_name,
          net_cents: row.net_cents,
          currency: row.currency,
          settled_at: row.settled_at,
        });
      }
    }
    payouts.sort((a, b) => b.settled_at.getTime() - a.settled_at.getTime());
    response.json({
      data: {
        ledger: ledger.slice(0, MAX_LEDGER_ROWS),
        payouts: payouts.slice(0, MAX_PAYOUT_ROWS),
        balance: computeSettlementBalances(
          ledger.map((row) => ({ state: row.state, netCents: row.net_cents })),
        ),
      },
    });
  },
);
