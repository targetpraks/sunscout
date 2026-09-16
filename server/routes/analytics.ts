import express from "express";
import { z } from "zod";
import { pool } from "../db";
export const analyticsRouter = express.Router();

const eventSchema = z.object({
  name: z.string().trim().min(1).max(100),
  properties: z.record(z.string(), z.unknown()).default({}),
});

analyticsRouter.post("/api/events", async (request, response) => {
  const input = eventSchema.parse(request.body);
  await pool.query(
    `insert into analytics_event(user_id, event_name, properties)
     values ($1, $2, $3)`,
    [request.userId, input.name, input.properties],
  );
  response.status(202).end();
});
