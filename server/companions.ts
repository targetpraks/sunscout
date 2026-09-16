import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

/** Exported so tests and callers can type fake/connection-scoped DB handles. */
export type CompanionsDb = Queryable;

export const COMPANION_RELATIONSHIPS = ["family", "friend", "solo"] as const;
export type CompanionRelationship = (typeof COMPANION_RELATIONSHIPS)[number];

export type Companion = {
  publicId: string;
  name: string;
  relationship: CompanionRelationship;
  createdAt: string;
};

type CompanionRow = {
  public_id: string;
  name: string;
  relationship: CompanionRelationship;
  created_at: Date;
};

function toCompanion(row: CompanionRow): Companion {
  return {
    publicId: row.public_id,
    name: row.name,
    relationship: row.relationship,
    createdAt: row.created_at.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

// ---------------------------------------------------------------------------
// Group profile CRUD (name + relationship, duplicate names rejected per user)
// ---------------------------------------------------------------------------

/** All companions in the caller's group profile, newest first. */
export async function listCompanions(
  db: CompanionsDb,
  userId: number,
): Promise<Companion[]> {
  const result = await db.query<CompanionRow>(
    `select public_id, name, relationship, created_at
     from companion where user_id = $1
     order by created_at desc`,
    [userId],
  );
  return result.rows.map(toCompanion);
}

export type CreateCompanionResult =
  | { outcome: "created"; companion: Companion }
  | { outcome: "duplicate_name" };

/**
 * Adds a companion to the caller's group profile. Duplicate names are
 * rejected per user, case-insensitively: a pre-check gives a friendly
 * outcome, and the unique index on (user_id, lower(name)) backs it up under
 * races (pg error 23505 is mapped to the same duplicate outcome).
 */
export async function createCompanion(
  db: CompanionsDb,
  input: {
    userId: number;
    name: string;
    relationship: CompanionRelationship;
  },
): Promise<CreateCompanionResult> {
  const clash = await db.query(
    `select 1 from companion where user_id = $1 and lower(name) = lower($2)`,
    [input.userId, input.name],
  );
  if (clash.rowCount) return { outcome: "duplicate_name" };
  try {
    const result = await db.query<CompanionRow>(
      `insert into companion(user_id, name, relationship)
       values ($1, $2, $3)
       returning public_id, name, relationship, created_at`,
      [input.userId, input.name, input.relationship],
    );
    return { outcome: "created", companion: toCompanion(result.rows[0]) };
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "duplicate_name" };
    throw error;
  }
}

/**
 * Owner-scoped delete: a companion id owned by someone else is
 * indistinguishable from a missing one. Returns whether anything was removed.
 */
export async function deleteCompanion(
  db: CompanionsDb,
  input: { userId: number; companionPublicId: string },
): Promise<boolean> {
  const result = await db.query(
    `delete from companion where user_id = $1 and public_id = $2`,
    [input.userId, input.companionPublicId],
  );
  return Boolean(result.rowCount);
}

// ---------------------------------------------------------------------------
// Booking attach ("Who's coming")
// ---------------------------------------------------------------------------

/**
 * Companions attached to a booking. Owner-scoped: a booking that is missing
 * or belongs to another user both yield null, by design (same contract as
 * getBookingReceipt in server/bookings.ts).
 */
export async function getBookingCompanions(
  db: CompanionsDb,
  input: { bookingPublicId: string; userId: number },
): Promise<Companion[] | null> {
  const booking = await db.query<{ id: number }>(
    `select id from booking where public_id = $1 and user_id = $2`,
    [input.bookingPublicId, input.userId],
  );
  if (!booking.rowCount) return null;
  const result = await db.query<CompanionRow>(
    `select c.public_id, c.name, c.relationship, c.created_at
     from booking_companion bc
     join companion c on c.id = bc.companion_id
     where bc.booking_id = $1
     order by bc.attached_at asc, c.name`,
    [booking.rows[0].id],
  );
  return result.rows.map(toCompanion);
}

export type SetBookingCompanionsResult =
  | { outcome: "not_found" }
  | { outcome: "updated"; companions: Companion[] };

/**
 * Replaces the full companion set attached to a booking (PATCH semantics).
 * Owner-scoped on the booking; every requested companion must belong to the
 * same user, otherwise companion_not_owned_or_missing is thrown so the
 * caller can run this inside withTransaction and roll the replace back.
 */
export async function setBookingCompanions(
  db: CompanionsDb,
  input: {
    bookingPublicId: string;
    userId: number;
    companionPublicIds: string[];
  },
): Promise<SetBookingCompanionsResult> {
  const booking = await db.query<{ id: number }>(
    `select id from booking where public_id = $1 and user_id = $2`,
    [input.bookingPublicId, input.userId],
  );
  if (!booking.rowCount) return { outcome: "not_found" };
  const bookingId = booking.rows[0].id;

  const requested = [...new Set(input.companionPublicIds)];
  await db.query(`delete from booking_companion where booking_id = $1`, [
    bookingId,
  ]);
  if (requested.length) {
    // No `on conflict` clause: the delete above empties the set first, so a
    // conflict is impossible — and if one ever occurred it should surface as
    // an error rather than be masked by a short rowCount → 422.
    const inserted = await db.query(
      `insert into booking_companion(booking_id, companion_id)
       select $1, c.id from companion c
       where c.user_id = $2 and c.public_id = any($3::uuid[])`,
      [bookingId, input.userId, requested],
    );
    if (inserted.rowCount !== requested.length) {
      throw Object.assign(new Error("companion_not_owned_or_missing"), {
        status: 422,
      });
    }
  }
  const attached = await db.query<CompanionRow>(
    `select c.public_id, c.name, c.relationship, c.created_at
     from booking_companion bc
     join companion c on c.id = bc.companion_id
     where bc.booking_id = $1
     order by bc.attached_at asc, c.name`,
    [bookingId],
  );
  return { outcome: "updated", companions: attached.rows.map(toCompanion) };
}
