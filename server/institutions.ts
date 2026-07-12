import type { NextFunction, Request, Response } from "express";
import { pool } from "./db";

declare global {
  namespace Express {
    interface Request {
      institutionId?: number;
      institutionPublicId?: string;
    }
  }
}

export async function requireInstitutionMember(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const result = await pool.query<{ id: number; public_id: string }>(
      `select i.id, i.public_id
       from institution_member im
       join institution i on i.id = im.institution_id
       where im.user_id = $1
       order by im.created_at desc
       limit 1`,
      [request.userId ?? null],
    );
    if (!result.rowCount) {
      response.status(403).json({ error: "institution_access_required" });
      return;
    }
    request.institutionId = result.rows[0].id;
    request.institutionPublicId = result.rows[0].public_id;
    next();
  } catch (error) {
    next(error);
  }
}

export type PortfolioBeach = {
  public_id: string;
  slug: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  crowd_percent: number | null;
  water_quality: string | null;
  blue_flag: boolean;
  hazard_count: number;
  received_at: string | null;
  source: string | null;
};

export async function getPortfolio(institutionId: number): Promise<{
  institution: {
    public_id: string;
    name: string;
    slug: string;
    region: string | null;
  };
  contract: {
    status: string;
    ends_on: string | null;
    exports_used: number;
    annual_quota_exports: number;
  };
  beaches: PortfolioBeach[];
}> {
  const institution = await pool.query<{
    public_id: string;
    name: string;
    slug: string;
    region: string | null;
  }>(`select public_id, name, slug, region from institution where id = $1`, [
    institutionId,
  ]);
  const contract = await pool.query<{
    status: string;
    ends_on: string | null;
    exports_used: number;
    annual_quota_exports: number;
  }>(
    `select status, ends_on::text, exports_used, annual_quota_exports
     from institution_contract where institution_id = $1 and status = 'active'
     order by ends_on desc limit 1`,
    [institutionId],
  );
  const beaches = await pool.query<PortfolioBeach>(
    `select b.public_id, b.slug, b.name, b.region, b.latitude::float as latitude,
       b.longitude::float as longitude,
       c.crowd_percent, c.water_quality, b.blue_flag,
       coalesce(h.hazard_count, 0)::int as hazard_count,
       c.received_at, c.source
     from institution_beach ib
     join beach b on b.id = ib.beach_id
     left join lateral (
       select crowd_percent, water_quality, received_at, source
       from beach_condition where beach_id = b.id order by received_at desc limit 1
     ) c on true
     left join lateral (
       select count(*)::int as hazard_count from hazard_alert
       where beach_id = b.id and (expires_at is null or expires_at > now())
     ) h on true
     where ib.institution_id = $1
     order by b.region, b.name`,
    [institutionId],
  );
  return {
    institution: institution.rows[0],
    contract: contract.rows[0] ?? {
      status: "none",
      ends_on: null,
      exports_used: 0,
      annual_quota_exports: 0,
    },
    beaches: beaches.rows,
  };
}

export async function incrementExportUsage(
  institutionId: number,
): Promise<void> {
  await pool.query(
    `update institution_contract
     set exports_used = exports_used + 1
     where institution_id = $1 and status = 'active'`,
    [institutionId],
  );
}
