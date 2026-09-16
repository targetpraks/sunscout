import express from "express";
import { z } from "zod";
import { audit } from "../audit";
import { awardBadge } from "../badges";
import { computeSettlement } from "../billing";
import { pool, withTransaction } from "../db";
import { createCheckoutSession } from "../payments";
import { createBookingToken, newPublicId } from "../tokens";
export const bookingsCoreRouter = express.Router();

bookingsCoreRouter.get("/api/bookings", async (request, response) => {
  const result = await pool.query(
    `select
       bk.public_id, b.public_id as beach_public_id, b.name as beach_name,
       bk.starts_at, bk.ends_at, bk.status, bk.total_cents, bk.currency,
       bk.qr_token,
       coalesce(
         jsonb_agg(
           jsonb_build_object(
             'type', ai.amenity_type,
             'quantity', bi.quantity,
             'unitPriceCents', bi.unit_price_cents
           )
         ) filter (where ai.id is not null),
         '[]'::jsonb
       ) as items
     from booking bk
     join beach b on b.id = bk.beach_id
     left join booking_item bi on bi.booking_id = bk.id
     left join amenity_inventory ai on ai.id = bi.inventory_id
     where bk.user_id = $1
     group by bk.id, b.id
     order by bk.starts_at desc`,
    [request.userId],
  );
  response.json({ data: result.rows });
});

const bookingSchema = z
  .object({
    beachPublicId: z.string().uuid(),
    startsAt: z.string().datetime(),
    sunbeds: z.number().int().min(0).max(20),
    umbrellas: z.number().int().min(0).max(20),
  })
  .refine((value) => value.sunbeds + value.umbrellas > 0, {
    message: "At least one inventory item is required",
  });

bookingsCoreRouter.post("/api/bookings", async (request, response) => {
  const input = bookingSchema.parse(request.body);
  const booking = await withTransaction(async (client) => {
    const merchant = await client.query<{
      id: number;
      beach_id: number;
      commission_basis_points: number;
    }>(
      `select m.id, m.beach_id, m.commission_basis_points
       from merchant m
       join beach b on b.id = m.beach_id
       where b.public_id = $1 and m.kyc_status = 'verified'
       order by m.id
       limit 1
       for update of m`,
      [input.beachPublicId],
    );
    if (!merchant.rowCount)
      throw Object.assign(new Error("merchant_not_found"), { status: 409 });

    const inventory = await client.query<{
      id: number;
      amenity_type: "sunbed" | "umbrella";
      available_count: number;
      price_cents: number;
    }>(
      `select id, amenity_type, available_count, price_cents
       from amenity_inventory
       where merchant_id = $1 and amenity_type in ('sunbed', 'umbrella')
       order by id
       for update`,
      [merchant.rows[0].id],
    );

    const requested = new Map([
      ["sunbed", input.sunbeds],
      ["umbrella", input.umbrellas],
    ]);
    let subtotal = 0;
    for (const row of inventory.rows) {
      const quantity = requested.get(row.amenity_type) ?? 0;
      if (quantity > row.available_count) {
        throw Object.assign(
          new Error(`insufficient_${row.amenity_type}_inventory`),
          { status: 409 },
        );
      }
      subtotal += quantity * row.price_cents;
    }
    const settlement = computeSettlement(
      subtotal,
      merchant.rows[0].commission_basis_points,
    );
    const commission = settlement.commissionCents;
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + 6 * 60 * 60 * 1000);
    const bookingPublicId = newPublicId();
    const qrToken = createBookingToken(bookingPublicId, endsAt);

    const created = await client.query<{ id: number; public_id: string }>(
      `insert into booking(
        public_id, user_id, merchant_id, beach_id, starts_at, ends_at, status,
        subtotal_cents, commission_cents, total_cents, qr_token
       )
       values ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8, $7, $9)
       returning id, public_id`,
      [
        bookingPublicId,
        request.userId,
        merchant.rows[0].id,
        merchant.rows[0].beach_id,
        startsAt,
        endsAt,
        subtotal,
        commission,
        qrToken,
      ],
    );

    for (const row of inventory.rows) {
      const quantity = requested.get(row.amenity_type) ?? 0;
      if (!quantity) continue;
      await client.query(
        `update amenity_inventory
         set available_count = available_count - $1,
             version = version + 1,
             updated_at = now()
         where id = $2`,
        [quantity, row.id],
      );
      await client.query(
        `insert into booking_item(booking_id, inventory_id, quantity, unit_price_cents)
         values ($1, $2, $3, $4)`,
        [created.rows[0].id, row.id, quantity, row.price_cents],
      );
    }

    await client.query(
      `insert into settlement(
        booking_id, merchant_id, gross_cents, commission_cents, net_cents, status
       )
       values ($1, $2, $3, $4, $5, 'pending')
       on conflict (booking_id) do nothing`,
      [
        created.rows[0].id,
        merchant.rows[0].id,
        subtotal,
        commission,
        subtotal - commission,
      ],
    );

    return {
      id: created.rows[0].public_id,
      status: "confirmed",
      startsAt,
      endsAt,
      subtotalCents: subtotal,
      commissionCents: commission,
      totalCents: subtotal,
      currency: "EUR",
      qrToken,
    };
  });
  await audit(request.userId, "booking_created", booking.id, {
    beachPublicId: input.beachPublicId,
    totalCents: booking.totalCents,
  });
  await awardBadge(pool, request.userId, "booked_in");
  response.status(201).json({ data: booking });
});

bookingsCoreRouter.post(
  "/api/bookings/:bookingPublicId/checkout",
  async (request, response) => {
    const booking = await pool.query<{
      total_cents: number;
      beach_name: string;
    }>(
      `select bk.total_cents, b.name as beach_name
     from booking bk join beach b on b.id = bk.beach_id
     where bk.public_id = $1 and bk.user_id = $2 and bk.status = 'confirmed'`,
      [request.params.bookingPublicId, request.userId],
    );
    if (!booking.rowCount) {
      response.status(404).json({ error: "booking_not_found" });
      return;
    }
    const session = await createCheckoutSession({
      bookingPublicId: request.params.bookingPublicId,
      amountCents: booking.rows[0].total_cents,
      beachName: booking.rows[0].beach_name,
    });
    response.json({ data: session });
  },
);
