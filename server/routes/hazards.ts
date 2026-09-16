import express from "express";
import { z } from "zod";
import { audit } from "../audit";
import { pool } from "../db";
export const hazardsRouter = express.Router();

const hazardSchema = z.object({
  beachPublicId: z.string().uuid(),
  severity: z.enum(["advisory", "warning", "danger"]),
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().min(1).max(500),
});

hazardsRouter.post("/api/hazards", async (request, response) => {
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
