import express from "express";
import { z } from "zod";
import { audit } from "../audit";
import { getConditionsHandler, refreshConditions } from "../conditions";
import { pool } from "../db";
export const conditionsRouter = express.Router();

// GET /api/conditions?slug=&audience= — additive Day Score payload (PR #10).
// Mounted inside the requireUser scope above: TidePanel sends the user
// header; without this mount the DayScoreCard would 404 silently.
conditionsRouter.get("/api/conditions", getConditionsHandler(pool));

conditionsRouter.post("/api/conditions/refresh", async (request, response) => {
  const input = z
    .object({
      force: z.boolean().default(false),
      slugs: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    })
    .parse(request.body ?? {});
  const result = await refreshConditions(pool, input);
  response.status(result.failed.length ? 207 : 200).json({ data: result });
});

conditionsRouter.get("/api/providers", async (_request, response) => {
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

conditionsRouter.post("/api/conditions/ingest", async (request, response) => {
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
