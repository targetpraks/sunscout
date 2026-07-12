import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

export type AwardedBadge = {
  public_id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  awarded_at: string;
};

export async function getUserPoints(
  db: Queryable,
  userId: number | undefined,
): Promise<number> {
  if (userId == null) return 0;
  const result = await db.query<{ total: string }>(
    `select coalesce(sum(points_awarded), 0)::int as total
     from beach_check_in where user_id = $1`,
    [userId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function getAwardedBadges(
  db: Queryable,
  userId: number | undefined,
): Promise<AwardedBadge[]> {
  if (userId == null) return [];
  const result = await db.query<AwardedBadge>(
    `select ba.public_id, b.slug, b.name, b.description, b.icon,
       to_char(ba.awarded_at at time zone 'Europe/Lisbon', 'YYYY-MM-DD"T"HH24:MI') as awarded_at
     from badge_award ba
     join badge b on b.id = ba.badge_id
     where ba.user_id = $1
     order by ba.awarded_at desc`,
    [userId],
  );
  return result.rows;
}

export async function awardBadge(
  db: Queryable,
  userId: number | undefined,
  slug: string,
): Promise<boolean> {
  if (userId == null) return false;
  const result = await db.query(
    `insert into badge_award(user_id, badge_id)
     select $1, id from badge where slug = $2
     on conflict (user_id, badge_id) do nothing
     returning 1`,
    [userId, slug],
  );
  return result.rowCount === 1;
}

export async function evaluateCheckInBadges(
  db: Queryable,
  userId: number | undefined,
): Promise<string[]> {
  if (userId == null) return [];
  const awarded: string[] = [];
  const stats = await db.query<{ total: string; distinct: string }>(
    `select count(*)::int as total,
       count(distinct beach_id)::int as distinct
     from beach_check_in where user_id = $1`,
    [userId],
  );
  const total = Number(stats.rows[0]?.total ?? 0);
  const distinct = Number(stats.rows[0]?.distinct ?? 0);
  if (total >= 1 && (await awardBadge(db, userId, "first_dip")))
    awarded.push("first_dip");
  if (distinct >= 3 && (await awardBadge(db, userId, "beach_hopper")))
    awarded.push("beach_hopper");
  return awarded;
}
