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
