import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createBookingToken, newPublicId, verifyBookingToken } from "./tokens";
import { computeAndStoreDayQuality, getDayQuality } from "./dayQuality";
import { concierge } from "./concierge";
import { computeRefund, computeSettlement } from "./billing";
import { captureException } from "./errorTracking";
import { createCheckoutSession, paymentsConfigured } from "./payments";
import { dispatchPush, pushConfigured, pushPublicKey } from "./push";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { requireUser, resolveOptionalUser } from "./auth";
import {
  getPortfolio,
  incrementExportUsage,
  requireInstitutionMember,
} from "./institutions";
import {
  awardBadge,
  evaluateCheckInBadges,
  getAwardedBadges,
  getUserPoints,
} from "./badges";
import { listBeaches } from "./beaches";
import { refreshConditions } from "./conditions";
import { pool, withTransaction } from "./db";
import { migrate } from "./migrate";

const app = express();
const port = Number(process.env.API_PORT ?? 8787);

async function audit(
  userId: number | null | undefined,
  action: string,
  target: string | null,
  properties: Record<string, unknown> = {},
) {
  await pool.query(
    `insert into audit_log(actor_user_id, action, target, properties)
     values ($1, $2, $3, $4)`,
    [userId ?? null, action, target, JSON.stringify(properties)],
  );
}

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "256kb" }));

// Serve built frontend (production)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.get("/api/health", async (_request, response) => {
  const result = await pool.query<{ now: string }>("select now()");
  response.json({ status: "ok", databaseTime: result.rows[0].now });
});

app.get("/api/beaches", async (request, response) => {
  let refreshMeta;
  if (request.query.refresh === "true") {
    refreshMeta = await refreshConditions(pool);
  }
  const lat = request.query.lat != null ? Number(request.query.lat) : null;
  const lng = request.query.lng != null ? Number(request.query.lng) : null;
  const origin =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      ? { latitude: lat, longitude: lng }
      : null;
  const radiusKm =
    request.query.radiusKm != null ? Number(request.query.radiusKm) : null;
  const activities = String(request.query.activities ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const nudistOnly = request.query.nudist === "true";
  const ageMax =
    request.query.ageMax != null ? Number(request.query.ageMax) : null;
  const audience = String(request.query.audience ?? "")
    .trim()
    .toLowerCase();

  const all = await listBeaches(
    pool,
    await resolveOptionalUser(request),
    origin,
  );
  const query = String(request.query.q ?? "")
    .trim()
    .toLowerCase();
  const suitability = String(request.query.suitability ?? "")
    .trim()
    .toLowerCase();
  const lowCrowd = request.query.lowCrowd === "true";

  const filtered = all
    .map((beach) => {
      let score = beach.match;
      const text = [
        beach.name,
        beach.description,
        beach.decision,
        beach.amenities.join(" "),
        ...(beach.activities ?? []),
        beach.suitability
          .map(
            (item: { label: string; value: string }) =>
              `${item.label} ${item.value}`,
          )
          .join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (query && text.includes(query)) score += 6;
      if (query.includes("family") && text.includes("famil")) score += 8;
      if (query.includes("party") && text.includes("party")) score += 10;
      if (
        suitability &&
        beach.suitability.some(
          (item: { id: string; score: number | null }) =>
            item.id === suitability && Number(item.score ?? 0) >= 2,
        )
      )
        score += 8;
      if (
        audience &&
        beach.suitability.some((item: { id: string }) => item.id === audience)
      )
        score += 6;
      if (lowCrowd && beach.crowd < 50) score += 9;
      if (origin && beach.travel)
        score += Math.max(0, 20 - beach.travel.distanceKm);
      return { ...beach, match: Math.min(score, 99) };
    })
    .filter((beach) => !lowCrowd || beach.crowd < 70)
    .filter((beach) => !nudistOnly || beach.allowsNudism)
    .filter((beach) =>
      activities.length
        ? activities.every((a) => (beach.activities ?? []).includes(a))
        : true,
    )
    .filter((beach) => {
      if (ageMax == null) return true;
      const family = beach.suitability.find(
        (item: { id: string }) => item.id === "families",
      );
      return (
        family &&
        family.ageMin != null &&
        family.ageMax != null &&
        family.ageMin <= ageMax &&
        family.ageMax >= ageMax
      );
    })
    .filter(
      (beach) =>
        radiusKm == null ||
        !beach.travel ||
        beach.travel.distanceKm <= radiusKm,
    )
    .sort((a, b) =>
      origin && a.travel && b.travel
        ? a.travel.distanceKm - b.travel.distanceKm
        : b.match - a.match,
    );

  response.json({
    data: filtered,
    meta: { count: filtered.length, conditions: refreshMeta, origin },
  });
});

app.get("/api/beaches/:slug", async (request, response) => {
  const all = await listBeaches(pool, await resolveOptionalUser(request));
  const beach = all.find((item) => item.slug === request.params.slug);
  if (!beach) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  response.json({ data: beach });
});

app.use("/api/me", requireUser);
app.use("/api/check-ins", requireUser);
app.use("/api/bookings", requireUser);
app.use("/api/events", requireUser);
app.use("/api/conditions", requireUser);
app.use("/api/merchant", requireUser);

app.post("/api/conditions/refresh", async (request, response) => {
  const input = z
    .object({
      force: z.boolean().default(false),
      slugs: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    })
    .parse(request.body ?? {});
  const result = await refreshConditions(pool, input);
  response.status(result.failed.length ? 207 : 200).json({ data: result });
});

app.get("/api/providers", async (_request, response) => {
  response.json({
    data: [
      {
        id: "weather",
        name: "Open-Meteo",
        status: "live",
        notes: "Weather + marine forecast.",
      },
      {
        id: "tide",
        name: "tide_provider_demo",
        status: "mocked",
        notes:
          "Deterministic tide curve. Swap for a licensed tide provider once access is secured.",
      },
      {
        id: "water_quality",
        name: "water_quality_demo",
        status: "mocked",
        notes:
          "Deterministic classification. Replace with a Blue Flag / authority adapter once data rights are cleared.",
      },
      {
        id: "sofar",
        name: "sofar_demo",
        status: "mocked",
        notes:
          "SoFar Spotter adapter with mocked fallback. No production Spotter verification claim until real data rights exist.",
      },
      {
        id: "mapping",
        name: "mapping_demo",
        status: "mocked",
        notes:
          "Haversine travel-time estimate. Replace with Mapbox/OSRM once the mapping provider is selected.",
      },
    ],
  });
});

const ingestSchema = z.object({
  slug: z.string().trim().min(1).max(100),
  source: z.string().trim().min(1).max(80),
  observedAt: z.string().datetime(),
  seaTempC: z.number().nullable().optional(),
  waveHeightM: z.number().nullable().optional(),
  uvIndex: z.number().nullable().optional(),
  crowdPercent: z.number().int().min(0).max(100).nullable().optional(),
  waterQuality: z
    .enum(["excellent", "good", "advisory", "closed", "unknown"])
    .optional(),
  raw: z.record(z.string(), z.unknown()).default({}),
});

app.post("/api/conditions/ingest", async (request, response) => {
  const input = ingestSchema.parse(request.body);
  const beach = await pool.query<{ id: number }>(
    "select id from beach where slug = $1",
    [input.slug],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  await pool.query(
    `insert into beach_condition(
       beach_id, observed_at, received_at, source, sea_temp_c, wave_height_m,
       uv_index, crowd_percent, water_quality, raw
     )
     values ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9)`,
    [
      beach.rows[0].id,
      input.observedAt,
      input.source,
      input.seaTempC ?? null,
      input.waveHeightM ?? null,
      input.uvIndex ?? null,
      input.crowdPercent ?? null,
      input.waterQuality ?? null,
      JSON.stringify(input.raw),
    ],
  );
  await audit(null, "condition_ingested", input.slug, { source: input.source });
  response.status(201).json({ data: { slug: input.slug, ingested: true } });
});

app.get("/api/merchant/dashboard", async (request, response) => {
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

app.patch(
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

app.post(
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

app.get("/api/me", async (request, response) => {
  const result = await pool.query(
    `select public_id, email, display_name, locale, timezone, is_premium, created_at
     from app_user where id = $1`,
    [request.userId],
  );
  response.json({ data: result.rows[0] });
});

app.get("/api/me/saved", async (request, response) => {
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

app.put("/api/me/saved/:beachPublicId", async (request, response) => {
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

app.delete("/api/me/saved/:beachPublicId", async (request, response) => {
  await pool.query(
    `delete from user_saved_beach
     where user_id = $1
       and beach_id = (select id from beach where public_id = $2)`,
    [request.userId, request.params.beachPublicId],
  );
  response.status(204).end();
});

app.post("/api/me/premium", async (request, response) => {
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

app.post("/api/me/votes", async (request, response) => {
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

app.post("/api/me/delete-account", async (request, response) => {
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
app.get("/api/me/progress", async (request, response) => {
  const [points, badges] = await Promise.all([
    getUserPoints(pool, request.userId),
    getAwardedBadges(pool, request.userId),
  ]);
  response.json({ data: { points, badges } });
});

app.post("/api/me/golden-hour-alert", async (request, response) => {
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

app.get("/api/me/notifications", async (request, response) => {
  const result = await pool.query(
    `select public_id, kind, title, body, payload, read_at, created_at
     from notification where user_id = $1
     order by read_at nulls first, created_at desc
     limit 50`,
    [request.userId],
  );
  response.json({ data: result.rows });
});

app.patch(
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

app.put("/api/me/notification-preferences", async (request, response) => {
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

app.get("/api/merchant/settlements", async (request, response) => {
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

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

app.get("/api/me/bookings.ics", async (request, response) => {
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

app.get("/api/me/trips/:tripId/pack", async (request, response) => {
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

app.get("/api/me/trips", async (request, response) => {
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

app.post("/api/me/trips", async (request, response) => {
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

const checkInSchema = z.object({
  beachPublicId: z.string().uuid(),
  coarseLocationBucket: z.string().trim().max(50).optional(),
  photoUrl: z.string().url().max(2048).optional(),
  caption: z.string().trim().max(200).optional(),
});

app.post("/api/check-ins", async (request, response) => {
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

app.get("/api/bookings", async (request, response) => {
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

app.post("/api/bookings", async (request, response) => {
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

app.post("/api/bookings/:bookingPublicId/cancel", async (request, response) => {
  const outcome = await withTransaction(async (client) => {
    const booking = await client.query<{
      id: number;
      merchant_id: number;
      starts_at: Date;
      status: string;
      total_cents: number;
    }>(
      `select id, merchant_id, starts_at, status, total_cents
       from booking where public_id = $1 and user_id = $2 for update`,
      [request.params.bookingPublicId, request.userId],
    );
    if (!booking.rowCount) {
      throw Object.assign(new Error("booking_not_found"), { status: 404 });
    }
    if (booking.rows[0].status !== "confirmed") {
      throw Object.assign(new Error("booking_not_cancellable"), {
        status: 409,
      });
    }
    const refund = computeRefund(
      booking.rows[0].total_cents,
      booking.rows[0].starts_at,
    );
    await client.query(
      `update booking set status = 'cancelled', updated_at = now() where id = $1`,
      [booking.rows[0].id],
    );
    await client.query(
      `update settlement set status = 'refunded', settled_at = now()
       where booking_id = $1`,
      [booking.rows[0].id],
    );
    const items = await client.query<{
      inventory_id: number;
      quantity: number;
    }>(
      "select inventory_id, quantity from booking_item where booking_id = $1",
      [booking.rows[0].id],
    );
    for (const item of items.rows) {
      await client.query(
        `update amenity_inventory
         set available_count = least(total_count, available_count + $1),
             version = version + 1,
             updated_at = now()
         where id = $2`,
        [item.quantity, item.inventory_id],
      );
    }
    return refund;
  });
  await audit(
    request.userId,
    "booking_cancelled",
    request.params.bookingPublicId,
    {
      tier: outcome.tier,
      refundCents: outcome.refundCents,
    },
  );
  response.json({ data: outcome });
});

const claimSchema = z.object({
  beachPublicId: z.string().uuid(),
  businessName: z.string().trim().min(1).max(120),
});

app.post("/api/merchant/claim", async (request, response) => {
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

app.get("/api/merchant/profile", async (request, response) => {
  const result = await pool.query(
    `select m.public_id, m.business_name, m.kyc_status, b.name as beach_name, b.public_id as beach_public_id
     from merchant m join beach b on b.id = m.beach_id
     where m.owner_user_id = $1
     order by m.created_at desc`,
    [request.userId],
  );
  response.json({ data: result.rows });
});

const hazardSchema = z.object({
  beachPublicId: z.string().uuid(),
  severity: z.enum(["advisory", "warning", "danger"]),
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().min(1).max(500),
});

app.post("/api/hazards", async (request, response) => {
  const input = hazardSchema.parse(request.body);
  const beach = await pool.query<{ id: number }>(
    "select id from beach where public_id = $1",
    [input.beachPublicId],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const result = await pool.query<{ public_id: string }>(
    `insert into hazard_alert(beach_id, severity, title, detail, source, verified, reported_by)
     values ($1, $2, $3, $4, 'community', false, $5)
     returning public_id`,
    [
      beach.rows[0].id,
      input.severity,
      input.title,
      input.detail,
      request.userId,
    ],
  );
  await audit(request.userId, "hazard_reported", input.beachPublicId, {
    severity: input.severity,
  });
  response
    .status(201)
    .json({ data: { public_id: result.rows[0].public_id, verified: false } });
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  p256dhKey: z.string().optional(),
  authSecret: z.string().optional(),
});

app.post("/api/me/push-subscription", async (request, response) => {
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

app.get("/api/me/push-public-key", async (_request, response) => {
  response.json({
    data: { configured: pushConfigured(), publicKey: pushPublicKey() },
  });
});

app.post(
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

app.get("/api/institution/trends", async (request, response) => {
  const slug = String(request.query.beach ?? "").trim();
  const beach = await pool.query<{ id: number }>(
    "select id from beach where slug = $1",
    [slug],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const trends = await pool.query(
    `select date_trunc('day', observed_at at time zone 'Europe/Lisbon')::date as day,
       avg(crowd_percent)::float as avg_crowd,
       max(water_quality) as water_quality,
       count(*)::int as samples
     from beach_condition
     where beach_id = $1 and observed_at > now() - interval '30 days'
     group by day order by day asc`,
    [beach.rows[0].id],
  );
  response.json({ data: { slug, series: trends.rows } });
});

app.get("/api/ops/status", async (_request, response) => {
  const started = (process.uptime?.() ?? 0) * 1000;
  const beachCount = await pool.query("select count(*)::int as n from beach");
  const hazardCount = await pool.query(
    "select count(*)::int as n from hazard_alert where expires_at is null or expires_at > now()",
  );
  response.json({
    data: {
      status: "operational",
      uptime_seconds: Math.round(started / 1000),
      payments_configured: paymentsConfigured(),
      push_configured: pushConfigured(),
      auth_adapter_configured: authAdapterConfiguredSafe(),
      error_tracking_configured: Boolean(process.env.SENTRY_DSN),
      beaches: beachCount.rows[0].n,
      active_hazards: hazardCount.rows[0].n,
    },
  });
});

function authAdapterConfiguredSafe(): boolean {
  return Boolean(process.env.SUNSCOUT_JWKS_URL);
}

const createInventorySchema = z.object({
  beachPublicId: z.string().uuid(),
  amenityType: z.enum(["sunbed", "umbrella", "cabana", "activity"]),
  totalCount: z.number().int().min(0).max(500),
  priceCents: z.number().int().min(0).max(1_000_000),
  slotDurationMinutes: z.number().int().min(15).max(480).default(360),
  label: z.string().trim().max(80).optional(),
  description: z.string().trim().max(200).optional(),
});

app.post("/api/merchant/inventory", async (request, response) => {
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

const friendSchema = z.object({
  name: z.string().trim().min(1).max(80),
  relationship: z
    .enum(["family", "friend", "solo", "partner", "kid"])
    .default("friend"),
});

app.get("/api/me/friends", async (request, response) => {
  const result = await pool.query(
    `select public_id, name, relationship from friend
     where user_id = $1 order by created_at desc`,
    [request.userId],
  );
  response.json({ data: result.rows });
});

app.post("/api/me/friends", async (request, response) => {
  const input = friendSchema.parse(request.body);
  const result = await pool.query<{ public_id: string }>(
    `insert into friend(user_id, name, relationship)
     values ($1, $2, $3) returning public_id`,
    [request.userId, input.name, input.relationship],
  );
  response.status(201).json({ data: result.rows[0] });
});

app.delete("/api/me/friends/:friendId", async (request, response) => {
  await pool.query(`delete from friend where user_id = $1 and public_id = $2`, [
    request.userId,
    request.params.friendId,
  ]);
  response.status(204).end();
});

const feedbackSchema = z.object({
  metric: z.string().trim().min(1).max(40),
  accurate: z.boolean(),
});

app.post(
  "/api/beaches/:slug/feedback",
  requireUser,
  async (request, response) => {
    const input = feedbackSchema.parse(request.body);
    const beach = await pool.query<{ id: number }>(
      "select id from beach where slug = $1",
      [request.params.slug],
    );
    if (!beach.rowCount) {
      response.status(404).json({ error: "beach_not_found" });
      return;
    }
    await pool.query(
      `insert into condition_feedback(user_id, beach_id, metric, accurate)
     values ($1, $2, $3, $4)
     on conflict (user_id, beach_id, metric) do update set accurate = excluded.accurate`,
      [request.userId, beach.rows[0].id, input.metric, input.accurate],
    );
    response.status(201).json({ data: { recorded: true } });
  },
);

app.get("/api/beaches/:slug/spotter-campaign", async (request, response) => {
  const beach = await pool.query<{ id: number }>(
    "select id from beach where slug = $1",
    [request.params.slug],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const campaign = await pool.query<{
    public_id: string;
    goal_cents: number;
    raised_cents: number;
    status: string;
  }>(
    `select public_id, goal_cents, raised_cents, status from spotter_campaign
     where beach_id = $1`,
    [beach.rows[0].id],
  );
  response.json({ data: campaign.rows[0] ?? null });
});

const contributeSchema = z.object({
  amountCents: z.number().int().min(100).max(1_000_000),
});

app.post(
  "/api/beaches/:slug/spotter-campaign/contribute",
  requireUser,
  async (request, response) => {
    const input = contributeSchema.parse(request.body);
    const beach = await pool.query<{ id: number }>(
      "select id from beach where slug = $1",
      [request.params.slug],
    );
    if (!beach.rowCount) {
      response.status(404).json({ error: "beach_not_found" });
      return;
    }
    const result = await withTransaction(async (client) => {
      const campaign = await client.query<{
        id: number;
        goal_cents: number;
        raised_cents: number;
      }>(
        `select id, goal_cents, raised_cents from spotter_campaign
         where beach_id = $1 and status = 'open' for update`,
        [beach.rows[0].id],
      );
      if (!campaign.rowCount) {
        throw Object.assign(new Error("no_open_campaign"), { status: 404 });
      }
      const row = campaign.rows[0];
      const newRaised = Math.min(
        row.goal_cents,
        row.raised_cents + input.amountCents,
      );
      await client.query(
        `insert into spotter_contribution(campaign_id, user_id, amount_cents)
         values ($1, $2, $3)`,
        [row.id, request.userId, input.amountCents],
      );
      const status = newRaised >= row.goal_cents ? "funded" : "open";
      const updated = await client.query<{
        raised_cents: number;
        status: string;
      }>(
        `update spotter_campaign set raised_cents = $2, status = $3
         where id = $1 returning raised_cents, status`,
        [row.id, newRaised, status],
      );
      return updated.rows[0];
    });
    await audit(
      request.userId,
      "spotter_contribution",
      String(request.params.slug),
      {
        amountCents: input.amountCents,
      },
    );
    response.status(201).json({ data: result });
  },
);

const conciergeSchema = z.object({
  query: z.string().trim().min(3).max(300),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

app.post("/api/concierge", requireUser, async (request, response) => {
  const input = conciergeSchema.parse(request.body);
  const origin =
    input.latitude != null && input.longitude != null
      ? { latitude: input.latitude, longitude: input.longitude }
      : null;
  const results = await concierge(pool, input.query, origin, request.userId);
  response.json({ data: results });
});

app.get("/api/beaches/:slug/crowd-forecast", async (request, response) => {
  const beach = await pool.query<{ id: number }>(
    "select id from beach where slug = $1",
    [request.params.slug],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const forecast = await pool.query(
    `select hour, crowd_percent from crowd_forecast
     where beach_id = $1 order by hour`,
    [beach.rows[0].id],
  );
  const checkInsToday = await pool.query<{ count: string }>(
    `select count(*)::int as count from beach_check_in
     where beach_id = $1 and local_day = current_date`,
    [beach.rows[0].id],
  );
  const latestCrowd = await pool.query<{ crowd_percent: number | null }>(
    `select crowd_percent from beach_condition
     where beach_id = $1 order by received_at desc limit 1`,
    [beach.rows[0].id],
  );
  response.json({
    data: {
      forecast: forecast.rows,
      liveCheckIns: Number(checkInsToday.rows[0]?.count ?? 0),
      currentCrowd: latestCrowd.rows[0]?.crowd_percent ?? null,
    },
  });
});

app.get("/api/me/trips/:tripId", async (request, response) => {
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

app.post("/api/me/trips/:tripId/votes", async (request, response) => {
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

app.get("/api/me/journal", async (request, response) => {
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

app.post("/api/me/journal", async (request, response) => {
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

app.get("/api/me/stats", async (request, response) => {
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

const ratingSchema = z.object({ stars: z.number().int().min(1).max(5) });

app.post("/api/beaches/:slug/rate", requireUser, async (request, response) => {
  const input = ratingSchema.parse(request.body);
  const beach = await pool.query<{ id: number }>(
    "select id from beach where slug = $1",
    [request.params.slug],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  await pool.query(
    `insert into beach_rating(user_id, beach_id, stars)
     values ($1, $2, $3)
     on conflict (user_id, beach_id) do update set stars = excluded.stars`,
    [request.userId, beach.rows[0].id, input.stars],
  );
  response.status(201).json({ data: { stars: input.stars } });
});

app.get("/api/beaches/:slug/rating", async (request, response) => {
  const beach = await pool.query<{ id: number }>(
    "select id from beach where slug = $1",
    [request.params.slug],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const result = await pool.query<{ avg: string | null; count: string }>(
    `select avg(stars)::numeric(2,1) as avg, count(*)::int as count
     from beach_rating where beach_id = $1`,
    [beach.rows[0].id],
  );
  response.json({ data: result.rows[0] });
});

const reportSchema = z.object({
  sandType: z.string().trim().max(40).optional(),
  sandColor: z.string().trim().max(40).optional(),
  sunbedPrice: z.number().int().min(0).max(500).optional(),
  umbrellaPrice: z.number().int().min(0).max(500).optional(),
  waterSportPrice: z.number().int().min(0).max(1000).optional(),
  music: z.enum(["none", "background", "live", "club"]).optional(),
  food: z.enum(["none", "snack_bar", "restaurant", "both"]).optional(),
  showers: z.boolean().optional(),
  changingRooms: z.boolean().optional(),
  toilets: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
});

app.post(
  "/api/beaches/:slug/report",
  requireUser,
  async (request, response) => {
    const input = reportSchema.parse(request.body);
    const beach = await pool.query<{ id: number }>(
      "select id from beach where slug = $1",
      [request.params.slug],
    );
    if (!beach.rowCount) {
      response.status(404).json({ error: "beach_not_found" });
      return;
    }
    const beachId = beach.rows[0].id;
    const entries = Object.entries(input).filter(([, v]) => v !== undefined);
    for (const [attribute, value] of entries) {
      await pool.query(
        `insert into beach_attribute_report(beach_id, user_id, attribute, value)
       values ($1, $2, $3, $4)`,
        [beachId, request.userId, attribute, String(value)],
      );
    }
    await audit(request.userId, "beach_reported", String(request.params.slug), {
      attributes: entries.length,
    });
    response.status(201).json({ data: { reported: entries.length } });
  },
);

app.get("/api/beaches/:slug/community-data", async (request, response) => {
  const beach = await pool.query<{ id: number }>(
    "select id from beach where slug = $1",
    [request.params.slug],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const reports = await pool.query<{ attribute: string; value: string }>(
    `select distinct on (attribute) attribute, value
     from beach_attribute_report
     where beach_id = $1
     order by attribute, created_at desc`,
    [beach.rows[0].id],
  );
  const data: Record<string, string> = {};
  for (const row of reports.rows) {
    data[row.attribute] = row.value;
  }
  const reportCount = await pool.query<{ count: string }>(
    "select count(*)::int as count from beach_attribute_report where beach_id = $1",
    [beach.rows[0].id],
  );
  response.json({
    data: { attributes: data, reportCount: Number(reportCount.rows[0].count) },
  });
});

app.get("/api/beaches/:slug/day-quality", async (request, response) => {
  const beach = await pool.query<{
    id: number;
    latitude: string;
    longitude: string;
    timezone: string;
  }>(
    "select id, latitude::text, longitude::text, timezone from beach where slug = $1",
    [request.params.slug],
  );
  if (!beach.rowCount) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  const beachRow = beach.rows[0];
  let quality = await getDayQuality(pool, beachRow.id);
  if (!quality) {
    try {
      const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
      weatherUrl.searchParams.set("latitude", beachRow.latitude);
      weatherUrl.searchParams.set("longitude", beachRow.longitude);
      weatherUrl.searchParams.set("timezone", beachRow.timezone);
      weatherUrl.searchParams.set("forecast_days", "1");
      weatherUrl.searchParams.set("timeformat", "iso8601");
      weatherUrl.searchParams.set(
        "hourly",
        "temperature_2m,wind_speed_10m,cloud_cover,precipitation_probability,uv_index",
      );
      const marineUrl = new URL("https://marine-api.open-meteo.com/v1/marine");
      marineUrl.searchParams.set("latitude", beachRow.latitude);
      marineUrl.searchParams.set("longitude", beachRow.longitude);
      marineUrl.searchParams.set("timezone", beachRow.timezone);
      marineUrl.searchParams.set("forecast_days", "1");
      marineUrl.searchParams.set("timeformat", "iso8601");
      marineUrl.searchParams.set("hourly", "wave_height");
      const [weatherResp, marineResp] = await Promise.all([
        fetch(weatherUrl, { signal: AbortSignal.timeout(8000) }),
        fetch(marineUrl, { signal: AbortSignal.timeout(8000) }),
      ]);
      const weather = (await weatherResp.json()) as {
        hourly: Record<string, number[] | string[]>;
      };
      const marine = (await marineResp.json()) as {
        hourly: Record<string, number[] | string[]>;
      };
      const wh = weather.hourly ?? {};
      const mh = marine.hourly ?? {};
      const times: string[] = (wh.time as string[]) ?? [];
      const hourly: Array<{
        time: string;
        tempC: number | null;
        windKmh: number | null;
        cloudPct: number | null;
        precipPct: number | null;
        uvIndex: number | null;
        waveM: number | null;
      }> = times.map((time, i) => ({
        time,
        tempC: Number(wh.temperature_2m?.[i] ?? 0) || null,
        windKmh: Number(wh.wind_speed_10m?.[i] ?? 0) || null,
        cloudPct: Number(wh.cloud_cover?.[i] ?? 0) || null,
        precipPct: Number(wh.precipitation_probability?.[i] ?? 0) || null,
        uvIndex: Number(wh.uv_index?.[i] ?? 0) || null,
        waveM: Number(mh.wave_height?.[i] ?? 0) || null,
      }));
      quality = await computeAndStoreDayQuality(pool, beachRow.id, hourly);
    } catch {
      quality = null;
    }
  }
  response.json({ data: quality });
});

const eventSchema = z.object({
  name: z.string().trim().min(1).max(100),
  properties: z.record(z.string(), z.unknown()).default({}),
});

app.use("/api/institution", requireUser, requireInstitutionMember);

app.get("/api/institution/dashboard", async (request, response) => {
  const portfolio = await getPortfolio(request.institutionId!);
  await audit(
    request.userId,
    "institution_dashboard_viewed",
    request.institutionPublicId ?? null,
    {},
  );
  response.json({ data: portfolio });
});

app.get("/api/institution/export", async (request, response) => {
  const format = String(request.query.format ?? "csv").toLowerCase();
  const portfolio = await getPortfolio(request.institutionId!);
  await incrementExportUsage(request.institutionId!);
  await audit(
    request.userId,
    "institution_export",
    request.institutionPublicId ?? null,
    { format },
  );

  if (format === "geojson") {
    const featureCollection = {
      type: "FeatureCollection",
      features: portfolio.beaches.map((beach) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [beach.longitude, beach.latitude],
        },
        properties: {
          slug: beach.slug,
          name: beach.name,
          region: beach.region,
          crowd_percent: beach.crowd_percent,
          water_quality: beach.water_quality,
          blue_flag: beach.blue_flag,
          hazard_count: beach.hazard_count,
          source: beach.source,
          received_at: beach.received_at,
        },
      })),
    };
    response.type("application/geo+json").json(featureCollection);
    return;
  }

  const header = [
    "slug",
    "name",
    "region",
    "latitude",
    "longitude",
    "crowd_percent",
    "water_quality",
    "blue_flag",
    "hazard_count",
    "source",
    "received_at",
  ];
  const rows = portfolio.beaches.map((beach) =>
    [
      beach.slug,
      beach.name,
      beach.region,
      beach.latitude,
      beach.longitude,
      beach.crowd_percent ?? "",
      beach.water_quality ?? "",
      beach.blue_flag ? "true" : "false",
      beach.hazard_count,
      beach.source ?? "",
      beach.received_at ?? "",
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );
  response
    .type("text/csv")
    .setHeader(
      "Content-Disposition",
      'attachment; filename="sunscout-portfolio.csv"',
    )
    .send([header.join(","), ...rows].join("\r\n"));
});

app.get("/api/embed/:token", async (request, response) => {
  const token = await pool.query<{
    institution_id: number;
    expires_at: Date | null;
  }>(`select institution_id, expires_at from embed_token where token = $1`, [
    request.params.token,
  ]);
  if (!token.rowCount) {
    response.status(404).json({ error: "embed_token_not_found" });
    return;
  }
  if (token.rows[0].expires_at && token.rows[0].expires_at < new Date()) {
    response.status(410).json({ error: "embed_token_expired" });
    return;
  }
  const portfolio = await getPortfolio(token.rows[0].institution_id);
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.json({
    data: {
      institution: portfolio.institution,
      beaches: portfolio.beaches,
    },
  });
});

app.post("/api/events", async (request, response) => {
  const input = eventSchema.parse(request.body);
  await pool.query(
    `insert into analytics_event(user_id, event_name, properties)
     values ($1, $2, $3)`,
    [request.userId, input.name, input.properties],
  );
  response.status(202).end();
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
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
    console.error(error);
    if (status >= 500) void captureException(error, { path: _request.path });
    response.status(status).json({
      error: error instanceof Error ? error.message : "internal_error",
    });
  },
);

// Run migrations on boot (idempotent) — ensures fresh DBs have schema
migrate()
  .then(() => {
    console.log("Migrations up to date");
    app.listen(port, "0.0.0.0", () => {
      console.log(`SunScout API listening at http://0.0.0.0:${port}`);
    });
  })
  .catch((error) => {
    console.error("Migration failed", error);
    process.exit(1);
  });