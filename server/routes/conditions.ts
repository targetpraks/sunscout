import express from "express";
import { z } from "zod";
import { audit } from "../audit";
import {
  createAlertRuleSchema,
  evaluateAlertRules,
  serializeAlertRule,
  type AlertRuleKind,
  type AlertRulePriority,
  type RuleEvaluationResult,
} from "../alertRules";
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
  // Personal alert rules ride the refresh, failure-isolated the same way
  // the refresh job isolates evaluateAlerts: a matcher failure never
  // changes the refresh outcome, it is only surfaced for ops.
  let alertRules: RuleEvaluationResult | { error: string };
  try {
    alertRules = await evaluateAlertRules(pool);
  } catch (error) {
    alertRules = {
      error: error instanceof Error ? error.message : "rule_evaluator_error",
    };
  }
  response.status(result.failed.length ? 207 : 200).json({
    data: { ...result, alertRules },
  });
});

// ---------------------------------------------------------------------------
// Personal condition alert rules ("tell me before I go") — CRUD mounted in
// the existing /api/conditions requireUser scope. The rule matcher itself
// runs on refresh (see server/alertRules.ts); these routes only persist and
// list the rules.
// ---------------------------------------------------------------------------

conditionsRouter.post(
  "/api/conditions/alert-rules",
  async (request, response) => {
    const input = createAlertRuleSchema.parse(request.body);
    const beach = await pool.query<{ id: number; name: string }>(
      "select id, name from beach where slug = $1",
      [input.slug],
    );
    if (!beach.rowCount) {
      response.status(404).json({ error: "beach_not_found" });
      return;
    }
    try {
      const result = await pool.query<{ id: number; created_at: Date }>(
        `insert into alert_rule(user_id, beach_id, kind, config, priority)
         values ($1, $2, $3, $4, $5)
         returning id, created_at`,
        [
          request.userId,
          beach.rows[0].id,
          input.kind,
          JSON.stringify(input.config),
          input.priority,
        ],
      );
      await audit(request.userId, "alert_rule_created", input.slug, {
        kind: input.kind,
        priority: input.priority,
        config: input.config,
      });
      response.status(201).json({
        data: serializeAlertRule({
          id: result.rows[0].id,
          slug: input.slug,
          beach_name: beach.rows[0].name,
          kind: input.kind,
          config: input.config,
          priority: input.priority,
          enabled: true,
          last_matched_at: null,
          created_at: result.rows[0].created_at,
        }),
      });
    } catch (error) {
      // The migration's unique(user_id, beach_id, kind, config) guard — one
      // live rule per predicate per beach — surfaces as a clean 409.
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        response.status(409).json({ error: "rule_exists" });
        return;
      }
      throw error;
    }
  },
);

type AlertRuleQueryRow = {
  id: number;
  slug: string;
  beach_name: string;
  kind: AlertRuleKind;
  config: Record<string, unknown>;
  priority: AlertRulePriority;
  enabled: boolean;
  last_matched_at: Date | null;
  created_at: Date;
};

conditionsRouter.get(
  "/api/conditions/alert-rules",
  async (request, response) => {
    const rules = await pool.query<AlertRuleQueryRow>(
      `select r.id, b.slug, b.name as beach_name, r.kind, r.config,
         r.priority, r.enabled, r.last_matched_at, r.created_at
       from alert_rule r
       join beach b on b.id = r.beach_id
       where r.user_id = $1
       order by r.created_at desc`,
      [request.userId],
    );
    // Companion payload: the user's saved beaches (slug + name) so the rule
    // editor is self-sufficient — no prop or route changes upstream.
    const saved = await pool.query<{ slug: string; name: string }>(
      `select distinct b.slug, b.name
       from user_saved_beach s
       join beach b on b.id = s.beach_id
       where s.user_id = $1
       order by b.name`,
      [request.userId],
    );
    response.json({
      data: {
        rules: rules.rows.map((row) =>
          serializeAlertRule({
            ...row,
            config: row.config ?? {},
          }),
        ),
        savedBeaches: saved.rows,
      },
    });
  },
);

conditionsRouter.delete(
  "/api/conditions/alert-rules/:id",
  async (request, response) => {
    const id = z.coerce.number().int().positive().parse(request.params.id);
    // user_id in the WHERE clause is the ownership check — another user's
    // rule is indistinguishable from a missing one (404, never 403).
    const result = await pool.query(
      "delete from alert_rule where id = $1 and user_id = $2 returning id",
      [id, request.userId],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "rule_not_found" });
      return;
    }
    await audit(request.userId, "alert_rule_deleted", null, { ruleId: id });
    response.status(204).end();
  },
);

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
