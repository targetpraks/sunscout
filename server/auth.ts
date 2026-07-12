import type { NextFunction, Request, Response } from "express";
import { pool } from "./db";
import { authAdapterConfigured, verifyJwt } from "./authJwt";

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      userPublicId?: string;
    }
  }
}

const defaultUser = "00000000-0000-7000-8000-000000000001";

export async function requireUser(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    if (authAdapterConfigured()) {
      const bearer = request
        .header("authorization")
        ?.replace(/^Bearer\s+/i, "")
        .trim();
      if (bearer) {
        const verified = await verifyJwt(bearer);
        if (!verified) {
          response.status(401).json({ error: "invalid_token" });
          return;
        }
        const bySub = await pool.query<{ id: number; public_id: string }>(
          `select id, public_id from app_user
           where external_sub = $1 and deleted_at is null`,
          [verified.sub],
        );
        if (bySub.rowCount) {
          request.userId = bySub.rows[0].id;
          request.userPublicId = bySub.rows[0].public_id;
          next();
          return;
        }
        response.status(401).json({ error: "unknown_subject" });
        return;
      }
    }
    const publicId =
      request.header("x-sunscout-user-id")?.trim() || defaultUser;
    const result = await pool.query<{ id: number; public_id: string }>(
      `select id, public_id
       from app_user
       where public_id = $1 and deleted_at is null`,
      [publicId],
    );
    if (!result.rowCount) {
      response.status(401).json({ error: "unknown_user" });
      return;
    }
    request.userId = result.rows[0].id;
    request.userPublicId = result.rows[0].public_id;
    next();
  } catch (error) {
    next(error);
  }
}

export async function resolveOptionalUser(
  request: Request,
): Promise<number | null> {
  const publicId = request.header("x-sunscout-user-id")?.trim();
  if (!publicId) return null;
  try {
    const result = await pool.query<{ id: number }>(
      `select id from app_user where public_id = $1 and deleted_at is null`,
      [publicId],
    );
    return result.rowCount ? result.rows[0].id : null;
  } catch {
    return null;
  }
}
