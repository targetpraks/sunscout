import { pool } from "./db";

export async function audit(
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
