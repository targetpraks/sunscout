import express from "express";
import { z } from "zod";
import { audit } from "../audit";
import { requireUser, resolveOptionalUser } from "../auth";
import { listBeaches } from "../beaches";
import { concierge } from "../concierge";
import { computeAndStoreDayQuality, getDayQuality } from "../dayQuality";
import { refreshConditions } from "../conditions";
import { pool, withTransaction } from "../db";
import { createDayPlanHandler } from "../dayPlan";
export const beachesRouter = express.Router();

beachesRouter.get("/api/beaches", async (request, response) => {
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

beachesRouter.get("/api/beaches/:slug", async (request, response) => {
  const all = await listBeaches(pool, await resolveOptionalUser(request));
  const beach = all.find((item) => item.slug === request.params.slug);
  if (!beach) {
    response.status(404).json({ error: "beach_not_found" });
    return;
  }
  response.json({ data: beach });
});

const feedbackSchema = z.object({
  metric: z.string().trim().min(1).max(40),
  accurate: z.boolean(),
});

beachesRouter.post(
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

beachesRouter.get(
  "/api/beaches/:slug/spotter-campaign",
  async (request, response) => {
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
  },
);

const contributeSchema = z.object({
  amountCents: z.number().int().min(100).max(1_000_000),
});

beachesRouter.post(
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

beachesRouter.post("/api/concierge", requireUser, async (request, response) => {
  const input = conciergeSchema.parse(request.body);
  const origin =
    input.latitude != null && input.longitude != null
      ? { latitude: input.latitude, longitude: input.longitude }
      : null;
  const results = await concierge(pool, input.query, origin, request.userId);
  response.json({ data: results });
});

beachesRouter.get(
  "/api/beaches/:slug/crowd-forecast",
  async (request, response) => {
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
  },
);

const ratingSchema = z.object({ stars: z.number().int().min(1).max(5) });

beachesRouter.post(
  "/api/beaches/:slug/rate",
  requireUser,
  async (request, response) => {
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
  },
);

beachesRouter.get("/api/beaches/:slug/rating", async (request, response) => {
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

beachesRouter.post(
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

// Timed Beach Day itinerary (PRD "what is actually happening there — and
// can I book the day before I leave"): a time-ordered plan for the rest of
// the beach-local day composed from live conditions (golden hour), the
// latest-day tide readings, published beach events and the caller's own
// booking. A :slug subpath like the other beach-scoped routes — it cannot
// shadow or be shadowed by the single-segment /api/beaches/:slug detail
// route, and the community routers mounted before beachesRouter in
// server/index.ts are untouched (their subpaths still win registration
// order, per the documented mount-order traps).
beachesRouter.get("/api/beaches/:slug/day-plan", createDayPlanHandler(pool));

beachesRouter.get(
  "/api/beaches/:slug/community-data",
  async (request, response) => {
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
      data: {
        attributes: data,
        reportCount: Number(reportCount.rows[0].count),
      },
    });
  },
);

beachesRouter.get(
  "/api/beaches/:slug/day-quality",
  async (request, response) => {
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
        const marineUrl = new URL(
          "https://marine-api.open-meteo.com/v1/marine",
        );
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
  },
);
