import express from "express";
import { z } from "zod";
import { audit } from "../audit";
import { evaluateCheckInBadges } from "../badges";
import { pool } from "../db";
export const checkinsRouter = express.Router();

const checkInSchema = z.object({
  beachPublicId: z.string().uuid(),
  coarseLocationBucket: z.string().trim().max(50).optional(),
  photoUrl: z.string().url().max(2048).optional(),
  caption: z.string().trim().max(200).optional(),
});

checkinsRouter.post("/api/check-ins", async (request, response) => {
  const input = checkInSchema.parse(request.body);
  const result = await pool.query(
    `insert into beach_check_in(
      user_id, beach_id, local_day, coarse_location_bucket, photo_url, caption
     )
     select $1, id, (now() at time zone timezone)::date, $3, $4, $5
     from beach where public_id = $2
     on conflict (user_id, beach_id, local_day) do update
       set checked_in_at = excluded.checked_in_at,
           photo_url = excluded.photo_url,
           caption = excluded.caption
     returning public_id, checked_in_at, points_awarded`,
    [
      request.userId,
      input.beachPublicId,
      input.coarseLocationBucket ?? null,
      input.photoUrl ?? null,
      input.caption ?? null,
    ],
  );
  if (!result.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const newBadges = await evaluateCheckInBadges(pool, request.userId);
  for (const slug of newBadges) {
    const badge = await pool.query<{ name: string }>(
      "select name from badge where slug = $1",
      [slug],
    );
    if (badge.rows[0]) {
      await pool.query(
        `insert into notification(user_id, kind, title, body, payload)
         values ($1, 'badge', $2, $3, $4)`,
        [
          request.userId,
          `Badge unlocked: ${badge.rows[0].name}`,
          "Keep checking in to earn more.",
          JSON.stringify({ badge: slug }),
        ],
      );
    }
  }
  await audit(request.userId, "check_in_created", input.beachPublicId, {
    photo: Boolean(input.photoUrl),
    badges: newBadges,
  });
  response.status(201).json({
    data: { ...result.rows[0], newBadges },
  });
});
