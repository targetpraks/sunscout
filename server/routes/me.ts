import express from "express";
import { z } from "zod";
import { audit } from "../audit";
import { awardBadge, getAwardedBadges, getUserPoints } from "../badges";
import { pool, withTransaction } from "../db";
import { pushConfigured, pushPublicKey } from "../push";
export const meRouter = express.Router();

meRouter.get("/api/me", async (request, response) => {
  const result = await pool.query(
    `select public_id, email, display_name, locale, timezone, is_premium, created_at
     from app_user where id = $1`,
    [request.userId],
  );
  response.json({ data: result.rows[0] });
});

meRouter.get("/api/me/saved", async (request, response) => {
  const result = await pool.query<{ public_id: string }>(
    `select b.public_id
     from user_saved_beach s
     join beach b on b.id = s.beach_id
     where s.user_id = $1
     order by s.created_at desc`,
    [request.userId],
  );
  response.json({ data: result.rows.map((row) => row.public_id) });
});

meRouter.put("/api/me/saved/:beachPublicId", async (request, response) => {
  const result = await pool.query(
    `insert into user_saved_beach(user_id, beach_id)
     select $1, id from beach where public_id = $2
     on conflict do nothing
     returning beach_id`,
    [request.userId, request.params.beachPublicId],
  );
  if (!result.rowCount) {
    const exists = await pool.query(
      "select 1 from beach where public_id = $1",
      [request.params.beachPublicId],
    );
    if (!exists.rowCount) {
      response.status(404).json({ error: "beach_not_found" });
      return;
    }
  }
  response.status(204).end();
});

meRouter.delete("/api/me/saved/:beachPublicId", async (request, response) => {
  await pool.query(
    `delete from user_saved_beach
     where user_id = $1
       and beach_id = (select id from beach where public_id = $2)`,
    [request.userId, request.params.beachPublicId],
  );
  response.status(204).end();
});

meRouter.post("/api/me/premium", async (request, response) => {
  const input = z
    .object({ premium: z.boolean().default(true) })
    .parse(request.body ?? {});
  const result = await pool.query<{ is_premium: boolean }>(
    `update app_user set is_premium = $1, updated_at = now()
     where id = $2 returning is_premium`,
    [input.premium, request.userId],
  );
  await audit(request.userId, "premium_toggled", null, {
    premium: input.premium,
  });
  response.json({ data: { is_premium: result.rows[0].is_premium } });
});

const voteSchema = z.object({
  beachPublicId: z.string().uuid(),
  tag: z.string().trim().min(1).max(40),
});

meRouter.post("/api/me/votes", async (request, response) => {
  const input = voteSchema.parse(request.body);
  const beach = await pool.query<{ id: number }>(
    "select id from beach where public_id = $1",
    [input.beachPublicId],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const beachId = beach.rows[0].id;
  await pool.query(
    `insert into vibe_tag(beach_id, tag) values ($1, $2)
     on conflict (beach_id, tag) do nothing`,
    [beachId, input.tag],
  );
  const toggled = await pool.query(
    `delete from vibe_vote
     where beach_id = $1 and tag = $2 and user_id = $3
     returning 1`,
    [beachId, input.tag, request.userId],
  );
  let voted = false;
  if (!toggled.rowCount) {
    await pool.query(
      `insert into vibe_vote(beach_id, tag, user_id) values ($1, $2, $3)
       on conflict (beach_id, tag, user_id) do nothing`,
      [beachId, input.tag, request.userId],
    );
    voted = true;
  }
  const counts = await pool.query<{ tag: string; votes: number }>(
    `select tag, count(*)::int as votes
     from vibe_vote where beach_id = $1 group by tag order by votes desc, tag`,
    [beachId],
  );
  await audit(request.userId, "vibe_voted", input.beachPublicId, {
    tag: input.tag,
    voted,
  });
  response.json({
    data: {
      voted,
      tag: input.tag,
      votes: counts.rows.map((row) => ({
        tag: row.tag,
        votes: row.votes,
        userVoted: voted && row.tag === input.tag,
      })),
    },
  });
});

meRouter.post("/api/me/delete-account", async (request, response) => {
  await withTransaction(async (client) => {
    await client.query(
      `update app_user set deleted_at = now(), updated_at = now() where id = $1`,
      [request.userId],
    );
    await client.query(
      `insert into account_deletion_request(user_id, status, completed_at)
       values ($1, 'completed', now())`,
      [request.userId],
    );
    await client.query(
      `insert into audit_log(actor_user_id, action, target, properties)
       values ($1, 'account_deleted', null, '{}'::jsonb)`,
      [request.userId],
    );
  });
  response.status(202).json({ data: { status: "deleted" } });
});
meRouter.get("/api/me/progress", async (request, response) => {
  const [points, badges] = await Promise.all([
    getUserPoints(pool, request.userId),
    getAwardedBadges(pool, request.userId),
  ]);
  response.json({ data: { points, badges } });
});

meRouter.post("/api/me/golden-hour-alert", async (request, response) => {
  const input = z
    .object({ beachPublicId: z.string().uuid() })
    .parse(request.body ?? {});
  const newlyAwarded = await awardBadge(pool, request.userId, "golden_eye");
  if (newlyAwarded) {
    await pool.query(
      `insert into notification(user_id, kind, title, body, payload)
       values ($1, 'badge', 'Badge unlocked: Golden Eye', 'Golden Hour alert saved.', $2)`,
      [
        request.userId,
        JSON.stringify({ badge: "golden_eye", beach: input.beachPublicId }),
      ],
    );
  }
  await audit(request.userId, "golden_hour_alert", input.beachPublicId, {});
  response.json({ data: { saved: true, newlyAwarded } });
});

meRouter.get("/api/me/notifications", async (request, response) => {
  const result = await pool.query(
    `select public_id, kind, title, body, payload, read_at, created_at
     from notification where user_id = $1
     order by read_at nulls first, created_at desc
     limit 50`,
    [request.userId],
  );
  response.json({ data: result.rows });
});

meRouter.patch(
  "/api/me/notifications/:notificationId/read",
  async (request, response) => {
    await pool.query(
      `update notification set read_at = now()
     where user_id = $1 and public_id = $2 and read_at is null`,
      [request.userId, request.params.notificationId],
    );
    response.status(204).end();
  },
);

meRouter.put("/api/me/notification-preferences", async (request, response) => {
  const input = z
    .object({ kind: z.string().trim().min(1).max(40), enabled: z.boolean() })
    .parse(request.body);
  await pool.query(
    `insert into notification_preference(user_id, kind, enabled)
     values ($1, $2, $3)
     on conflict (user_id, kind) do update set enabled = excluded.enabled`,
    [request.userId, input.kind, input.enabled],
  );
  response.json({ data: input });
});

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

meRouter.get("/api/me/bookings.ics", async (request, response) => {
  const result = await pool.query(
    `select bk.public_id, b.name as beach_name, bk.starts_at, bk.ends_at,
       bk.status, bk.total_cents, bk.currency
     from booking bk
     join beach b on b.id = bk.beach_id
     where bk.user_id = $1 and bk.status in ('confirmed', 'redeemed')
     order by bk.starts_at asc`,
    [request.userId],
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SunScout//Beach day//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const row of result.rows) {
    const fmt = (d: Date) =>
      d
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${row.public_id}@sunscout`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(new Date(row.starts_at))}`,
      `DTEND:${fmt(new Date(row.ends_at))}`,
      `SUMMARY:${icsEscape(`${row.beach_name} beach day`)}`,
      `DESCRIPTION:${icsEscape(`SunScout reservation. Status: ${row.status}. Total: ${row.total_cents / 100} ${row.currency}.`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  response.type("text/calendar").send(lines.join("\r\n"));
});

meRouter.get("/api/me/trips/:tripId/pack", async (request, response) => {
  const user = await pool.query<{ is_premium: boolean }>(
    "select is_premium from app_user where id = $1",
    [request.userId],
  );
  if (!user.rows[0]?.is_premium) {
    response.status(403).json({ error: "premium_required" });
    return;
  }
  const trip = await pool.query(
    `select t.public_id, t.name, t.starts_on, t.ends_on
     from trip t where t.public_id = $1 and t.user_id = $2`,
    [request.params.tripId, request.userId],
  );
  if (!trip.rowCount) {
    response.status(404).json({ error: "trip_not_found" });
    return;
  }
  const beaches = await pool.query(
    `select b.public_id, b.slug, b.name, b.region, b.cover_photo_url,
       c.sea_temp_c, c.wave_height_m, c.uv_index, c.crowd_percent, c.water_quality,
       c.golden_hour_start, c.golden_hour_end, c.source, c.received_at
     from trip_beach tb
     join beach b on b.id = tb.beach_id
     left join lateral (
       select sea_temp_c, wave_height_m, uv_index, crowd_percent, water_quality,
         golden_hour_start, golden_hour_end, source, received_at
       from beach_condition where beach_id = b.id order by received_at desc limit 1
     ) c on true
     where tb.trip_id = (select id from trip where public_id = $1)
     order by tb.position`,
    [request.params.tripId],
  );
  response.json({
    data: {
      trip: trip.rows[0],
      beaches: beaches.rows,
      packed_at: new Date().toISOString(),
      offline: true,
    },
  });
});

const tripSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    startsOn: z.string().date().optional(),
    endsOn: z.string().date().optional(),
    beachPublicIds: z.array(z.string().uuid()).max(10).default([]),
    locationLabel: z.string().trim().max(120).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    friendIds: z.array(z.string().uuid()).max(20).default([]),
  })
  .refine(
    (value) =>
      !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn,
    { message: "Trip end date must be on or after its start date" },
  );

meRouter.get("/api/me/trips", async (request, response) => {
  const result = await pool.query(
    `select
       t.public_id, t.name, t.starts_on, t.ends_on, t.status, t.created_at,
       t.location_label, t.latitude, t.longitude,
       coalesce(
         jsonb_agg(
           jsonb_build_object('id', b.public_id, 'slug', b.slug, 'name', b.name)
           order by tb.position
         ) filter (where b.id is not null),
         '[]'::jsonb
       ) as beaches,
       coalesce(
         jsonb_agg(
           jsonb_build_object('id', f.public_id, 'name', f.name, 'relationship', f.relationship)
         ) filter (where f.id is not null),
         '[]'::jsonb
       ) as members
     from trip t
     left join trip_beach tb on tb.trip_id = t.id
     left join beach b on b.id = tb.beach_id
     left join trip_member tm on tm.trip_id = t.id
     left join friend f on f.id = tm.friend_id
     where t.user_id = $1
     group by t.id
     order by t.created_at desc`,
    [request.userId],
  );
  response.json({ data: result.rows });
});

meRouter.post("/api/me/trips", async (request, response) => {
  const input = tripSchema.parse(request.body);
  const trip = await withTransaction(async (client) => {
    const created = await client.query<{ id: number; public_id: string }>(
      `insert into trip(user_id, name, starts_on, ends_on, status, location_label, latitude, longitude)
       values ($1, $2, $3, $4, 'active', $5, $6, $7)
       returning id, public_id`,
      [
        request.userId,
        input.name,
        input.startsOn ?? null,
        input.endsOn ?? null,
        input.locationLabel ?? null,
        input.latitude ?? null,
        input.longitude ?? null,
      ],
    );
    if (input.beachPublicIds.length) {
      await client.query(
        `insert into trip_beach(trip_id, beach_id, position)
         select $1, b.id, u.position
         from unnest($2::uuid[]) with ordinality as u(public_id, position)
         join beach b on b.public_id = u.public_id`,
        [created.rows[0].id, input.beachPublicIds],
      );
    }
    if (input.friendIds.length) {
      await client.query(
        `insert into trip_member(trip_id, friend_id)
         select $1, f.id from friend f
         where f.user_id = $2 and f.public_id = any($3::uuid[])
         on conflict do nothing`,
        [created.rows[0].id, request.userId, input.friendIds],
      );
    }
    return created.rows[0];
  });
  response.status(201).json({ data: trip });
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  p256dhKey: z.string().optional(),
  authSecret: z.string().optional(),
});

meRouter.post("/api/me/push-subscription", async (request, response) => {
  const input = pushSubscriptionSchema.parse(request.body);
  await pool.query(
    `insert into push_subscription(user_id, endpoint, p256dh_key, auth_secret)
     values ($1, $2, $3, $4)
     on conflict (user_id, endpoint) do update set p256dh_key = excluded.p256dh_key,
       auth_secret = excluded.auth_secret`,
    [
      request.userId,
      input.endpoint,
      input.p256dhKey ?? null,
      input.authSecret ?? null,
    ],
  );
  response.status(204).end();
});

meRouter.get("/api/me/push-public-key", async (_request, response) => {
  response.json({
    data: { configured: pushConfigured(), publicKey: pushPublicKey() },
  });
});

const friendSchema = z.object({
  name: z.string().trim().min(1).max(80),
  relationship: z
    .enum(["family", "friend", "solo", "partner", "kid"])
    .default("friend"),
});

meRouter.get("/api/me/friends", async (request, response) => {
  const result = await pool.query(
    `select public_id, name, relationship from friend
     where user_id = $1 order by created_at desc`,
    [request.userId],
  );
  response.json({ data: result.rows });
});

meRouter.post("/api/me/friends", async (request, response) => {
  const input = friendSchema.parse(request.body);
  const result = await pool.query<{ public_id: string }>(
    `insert into friend(user_id, name, relationship)
     values ($1, $2, $3) returning public_id`,
    [request.userId, input.name, input.relationship],
  );
  response.status(201).json({ data: result.rows[0] });
});

meRouter.delete("/api/me/friends/:friendId", async (request, response) => {
  await pool.query(`delete from friend where user_id = $1 and public_id = $2`, [
    request.userId,
    request.params.friendId,
  ]);
  response.status(204).end();
});

meRouter.get("/api/me/trips/:tripId", async (request, response) => {
  const trip = await pool.query(
    `select t.public_id, t.name, t.starts_on, t.ends_on, t.status,
       t.location_label, t.latitude, t.longitude,
       coalesce(jsonb_agg(distinct jsonb_build_object('id', b.public_id, 'slug', b.slug, 'name', b.name)) filter (where b.id is not null), '[]'::jsonb) as beaches,
       coalesce(jsonb_agg(distinct jsonb_build_object('id', f.public_id, 'name', f.name, 'relationship', f.relationship)) filter (where f.id is not null), '[]'::jsonb) as members
     from trip t
     left join trip_beach tb on tb.trip_id = t.id
     left join beach b on b.id = tb.beach_id
     left join trip_member tm on tm.trip_id = t.id
     left join friend f on f.id = tm.friend_id
     where t.public_id = $1 and t.user_id = $2
     group by t.id`,
    [request.params.tripId, request.userId],
  );
  if (!trip.rowCount) {
    response.status(404).json({ error: "trip_not_found" });
    return;
  }
  const votes = await pool.query(
    `select tv.beach_id, b.public_id as beach_public_id, tv.friend_id, f.public_id as friend_public_id, f.name as friend_name, tv.vote
     from trip_vote tv
     join beach b on b.id = tv.beach_id
     join friend f on f.id = tv.friend_id
     where tv.trip_id = (select id from trip where public_id = $1)`,
    [request.params.tripId],
  );
  response.json({ data: { ...trip.rows[0], votes: votes.rows } });
});

const tripVoteSchema = z.object({
  beachPublicId: z.string().uuid(),
  friendId: z.string().uuid(),
  vote: z.enum(["up", "down"]),
});

meRouter.post("/api/me/trips/:tripId/votes", async (request, response) => {
  const input = tripVoteSchema.parse(request.body);
  const trip = await pool.query<{ id: number }>(
    "select id from trip where public_id = $1 and user_id = $2",
    [request.params.tripId, request.userId],
  );
  if (!trip.rowCount) {
    response.status(404).json({ error: "trip_not_found" });
    return;
  }
  await pool.query(
    `insert into trip_vote(trip_id, beach_id, friend_id, vote)
     select $1, b.id, f.id, $4 from beach b, friend f
     where b.public_id = $2 and f.public_id = $3 and f.user_id = $5
     on conflict (trip_id, beach_id, friend_id) do update set vote = excluded.vote`,
    [
      trip.rows[0].id,
      input.beachPublicId,
      input.friendId,
      input.vote,
      request.userId,
    ],
  );
  response.status(201).json({ data: { recorded: true } });
});

meRouter.get("/api/me/journal", async (request, response) => {
  const result = await pool.query(
    `select je.public_id, je.notes, je.mood, je.conditions_snapshot,
       to_char(je.visited_at at time zone 'Europe/Lisbon', 'YYYY-MM-DD') as visited_on,
       b.public_id as beach_public_id, b.slug, b.name, b.cover_photo_url
     from beach_journal_entry je
     join beach b on b.id = je.beach_id
     where je.user_id = $1
     order by je.visited_at desc
     limit 100`,
    [request.userId],
  );
  response.json({ data: result.rows });
});

const journalSchema = z.object({
  beachPublicId: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
  mood: z
    .enum(["relaxed", "energetic", "social", "adventurous", "family"])
    .optional(),
});

meRouter.post("/api/me/journal", async (request, response) => {
  const input = journalSchema.parse(request.body);
  const beach = await pool.query<{ id: number }>(
    "select id from beach where public_id = $1",
    [input.beachPublicId],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const condition = await pool.query(
    `select jsonb_build_object(
       'seaTemp', sea_temp_c, 'waves', wave_height_m, 'uv', uv_index,
       'crowd', crowd_percent, 'waterQuality', water_quality,
       'airTemp', air_temp_c, 'wind', wind_speed_kmh, 'cloud', cloud_cover_percent
     ) as snapshot from beach_condition where beach_id = $1 order by received_at desc limit 1`,
    [beach.rows[0].id],
  );
  const result = await pool.query<{ public_id: string }>(
    `insert into beach_journal_entry(user_id, beach_id, notes, mood, conditions_snapshot)
     values ($1, $2, $3, $4, $5) returning public_id`,
    [
      request.userId,
      beach.rows[0].id,
      input.notes ?? null,
      input.mood ?? null,
      JSON.stringify(condition.rows[0]?.snapshot ?? {}),
    ],
  );
  response.status(201).json({ data: { public_id: result.rows[0].public_id } });
});

meRouter.get("/api/me/stats", async (request, response) => {
  const [visits, beaches, moods, topBeaches, avgRating] = await Promise.all([
    pool.query<{ total: string; days: string }>(
      `select count(*)::int as total, count(distinct local_day)::int as days
       from beach_check_in where user_id = $1`,
      [request.userId],
    ),
    pool.query<{ distinct: string }>(
      `select count(distinct beach_id)::int as distinct from beach_check_in where user_id = $1`,
      [request.userId],
    ),
    pool.query(
      `select mood, count(*)::int as count from beach_journal_entry
       where user_id = $1 group by mood order by count desc`,
      [request.userId],
    ),
    pool.query<{ name: string; slug: string; visits: string }>(
      `select b.name, b.slug, count(*)::int as visits
       from beach_check_in ci join beach b on b.id = ci.beach_id
       where ci.user_id = $1 group by b.name, b.slug order by visits desc limit 5`,
      [request.userId],
    ),
    pool.query<{ avg: string | null }>(
      `select avg(stars)::numeric(2,1) as avg from beach_rating where user_id = $1`,
      [request.userId],
    ),
  ]);
  response.json({
    data: {
      totalVisits: Number(visits.rows[0]?.total ?? 0),
      beachDays: Number(visits.rows[0]?.days ?? 0),
      distinctBeaches: Number(beaches.rows[0]?.distinct ?? 0),
      moodBreakdown: moods.rows,
      topBeaches: topBeaches.rows,
      averageRatingGiven: avgRating.rows[0]?.avg ?? null,
    },
  });
});
