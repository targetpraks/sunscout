import express from "express";
import { audit } from "../audit";
import { getPortfolio, incrementExportUsage } from "../institutions";
import { pool } from "../db";

// Public: GET /api/institution/trends (registered BEFORE the
// /api/institution auth mount, matching the original order) and
// GET /api/embed/:token (never gated by that mount).
export const institutionPublicRouter = express.Router();

institutionPublicRouter.get(
  "/api/institution/trends",
  async (request, response) => {
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
  },
);

institutionPublicRouter.get("/api/embed/:token", async (request, response) => {
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

// Portal: gated by the /api/institution auth mount
// (requireUser + requireInstitutionMember) in index.ts.
export const institutionPortalRouter = express.Router();

institutionPortalRouter.get(
  "/api/institution/dashboard",
  async (request, response) => {
    const portfolio = await getPortfolio(request.institutionId!);
    await audit(
      request.userId,
      "institution_dashboard_viewed",
      request.institutionPublicId ?? null,
      {},
    );
    response.json({ data: portfolio });
  },
);

institutionPortalRouter.get(
  "/api/institution/export",
  async (request, response) => {
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
  },
);
