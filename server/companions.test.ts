import { describe, expect, it } from "vitest";
import {
  createCompanion,
  deleteCompanion,
  getBookingCompanions,
  listCompanions,
  setBookingCompanions,
  type CompanionsDb,
} from "./companions";

/**
 * pg's query is a heavily overloaded generic, so a hand-rolled stub is not
 * directly assignable. Route the cast through unknown once, here, instead of
 * at every call site (same pattern as server/bookings.test.ts).
 */
function asQuery(
  fn: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>,
): CompanionsDb["query"] {
  return fn as unknown as CompanionsDb["query"];
}

function pgUniqueViolation(): unknown {
  return Object.assign(new Error("duplicate key"), { code: "23505" });
}

describe("listCompanions", () => {
  it("scopes the lookup to the caller and maps rows to companions", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const created = new Date("2026-09-15T12:00:00Z");
    const db: CompanionsDb = {
      query: asQuery(async (sql, params = []) => {
        calls.push({ sql, params });
        return {
          rows: [
            {
              public_id: "c-2",
              name: "Ana",
              relationship: "family",
              created_at: created,
            },
          ],
          rowCount: 1,
        };
      }),
    };
    const companions = await listCompanions(db, 7);
    expect(companions).toEqual([
      {
        publicId: "c-2",
        name: "Ana",
        relationship: "family",
        createdAt: created.toISOString(),
      },
    ]);
    expect(calls[0]?.params).toEqual([7]);
    expect(calls[0]?.sql).toContain("from companion");
    expect(calls[0]?.sql).toContain("user_id = $1");
  });

  it("returns an empty profile as an empty list", async () => {
    const db: CompanionsDb = {
      query: asQuery(async () => ({ rows: [], rowCount: 0 })),
    };
    expect(await listCompanions(db, 7)).toEqual([]);
  });
});

describe("createCompanion", () => {
  const row = {
    public_id: "c-1",
    name: "Ana",
    relationship: "friend",
    created_at: new Date("2026-09-15T12:00:00Z"),
  };

  it("inserts scoped to the caller and returns the companion", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const db: CompanionsDb = {
      query: asQuery(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes("select 1 from companion")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [row], rowCount: 1 };
      }),
    };
    const result = await createCompanion(db, {
      userId: 7,
      name: "Ana",
      relationship: "friend",
    });
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") return;
    expect(result.companion.publicId).toBe("c-1");
    expect(result.companion.relationship).toBe("friend");
    const insert = calls.find((call) =>
      call.sql.includes("insert into companion"),
    );
    expect(insert?.params).toEqual([7, "Ana", "friend"]);
  });

  it("rejects a duplicate name case-insensitively before insert", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const db: CompanionsDb = {
      query: asQuery(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes("select 1 from companion")) {
          return { rows: [{ "?column?": 1 }], rowCount: 1 };
        }
        throw new Error("insert must not run on a duplicate name");
      }),
    };
    const result = await createCompanion(db, {
      userId: 7,
      name: "ana",
      relationship: "friend",
    });
    expect(result).toEqual({ outcome: "duplicate_name" });
    const clash = calls.find((call) =>
      call.sql.includes("select 1 from companion"),
    );
    expect(clash?.params).toEqual([7, "ana"]);
    expect(clash?.sql).toContain("lower(name) = lower($2)");
  });

  it("maps a unique-index race (pg 23505) to duplicate_name", async () => {
    const db: CompanionsDb = {
      query: asQuery(async (sql) => {
        if (sql.includes("select 1 from companion")) {
          return { rows: [], rowCount: 0 };
        }
        throw pgUniqueViolation();
      }),
    };
    const result = await createCompanion(db, {
      userId: 7,
      name: "Ana",
      relationship: "friend",
    });
    expect(result).toEqual({ outcome: "duplicate_name" });
  });

  it("re-raises unrelated insert errors", async () => {
    const db: CompanionsDb = {
      query: asQuery(async (sql) => {
        if (sql.includes("select 1 from companion")) {
          return { rows: [], rowCount: 0 };
        }
        throw Object.assign(new Error("connection_lost"), { code: "08006" });
      }),
    };
    await expect(
      createCompanion(db, {
        userId: 7,
        name: "Ana",
        relationship: "friend",
      }),
    ).rejects.toThrow("connection_lost");
  });
});

describe("deleteCompanion", () => {
  it("scopes the delete to the owner", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const db: CompanionsDb = {
      query: asQuery(async (sql, params = []) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }),
    };
    expect(
      await deleteCompanion(db, { userId: 7, companionPublicId: "c-1" }),
    ).toBe(true);
    expect(calls[0]?.params).toEqual([7, "c-1"]);
  });

  it("returns false for a companion owned by someone else or missing", async () => {
    const db: CompanionsDb = {
      query: asQuery(async () => ({ rows: [], rowCount: 0 })),
    };
    expect(
      await deleteCompanion(db, { userId: 7, companionPublicId: "c-9" }),
    ).toBe(false);
  });
});

function makeBookingCompanionsDb(
  booking: { id: number } | null,
  attached: Array<Record<string, unknown>> = [],
) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const db: CompanionsDb = {
    query: asQuery(async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("from booking where")) {
        return booking
          ? { rows: [booking], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("from booking_companion")) {
        return { rows: attached, rowCount: attached.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return { db, calls };
}

describe("getBookingCompanions", () => {
  it("scopes the booking to the owner and returns attached companions", async () => {
    const created = new Date("2026-09-15T12:00:00Z");
    const { db, calls } = makeBookingCompanionsDb({ id: 42 }, [
      {
        public_id: "c-1",
        name: "Ana",
        relationship: "family",
        created_at: created,
      },
    ]);
    const companions = await getBookingCompanions(db, {
      bookingPublicId: "bk-1",
      userId: 7,
    });
    expect(companions).toEqual([
      {
        publicId: "c-1",
        name: "Ana",
        relationship: "family",
        createdAt: created.toISOString(),
      },
    ]);
    const bookingSelect = calls[0];
    expect(bookingSelect?.params).toEqual(["bk-1", 7]);
    expect(bookingSelect?.sql).toContain("user_id = $2");
  });

  it("returns null for a booking owned by someone else or missing", async () => {
    const { db } = makeBookingCompanionsDb(null);
    expect(
      await getBookingCompanions(db, {
        bookingPublicId: "bk-1",
        userId: 7,
      }),
    ).toBeNull();
  });

  it("returns an empty list for a booking with no companions", async () => {
    const { db } = makeBookingCompanionsDb({ id: 42 }, []);
    expect(
      await getBookingCompanions(db, {
        bookingPublicId: "bk-1",
        userId: 7,
      }),
    ).toEqual([]);
  });
});

describe("setBookingCompanions", () => {
  const created = new Date("2026-09-15T12:00:00Z");
  const attachedRow = {
    public_id: "c-1",
    name: "Ana",
    relationship: "friend",
    created_at: created,
  };

  it("replaces the set on an owned booking and returns the attached companions", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const created = new Date("2026-09-15T12:00:00Z");
    const attachedRow = {
      public_id: "c-1",
      name: "Ana",
      relationship: "friend",
      created_at: created,
    };
    const db: CompanionsDb = {
      query: asQuery(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes("from booking where")) {
          return { rows: [{ id: 42 }], rowCount: 1 };
        }
        if (sql.startsWith("delete from booking_companion")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("insert into booking_companion")) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("from booking_companion")) {
          return { rows: [attachedRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const result = await setBookingCompanions(db, {
      bookingPublicId: "bk-1",
      userId: 7,
      companionPublicIds: ["c-1"],
    });
    expect(result.outcome).toBe("updated");
    if (result.outcome !== "updated") return;
    expect(result.companions).toEqual([
      {
        publicId: "c-1",
        name: "Ana",
        relationship: "friend",
        createdAt: created.toISOString(),
      },
    ]);
    const deleteAll = calls.find((call) =>
      call.sql.startsWith("delete from booking_companion"),
    );
    expect(deleteAll?.params).toEqual([42]);
    const insert = calls.find((call) =>
      call.sql.includes("insert into booking_companion"),
    );
    expect(insert?.params).toEqual([42, 7, ["c-1"]]);
    expect(insert?.sql).toContain("c.user_id = $2");
  });

  it("de-dupes requested ids before the ownership count check", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const db: CompanionsDb = {
      query: asQuery(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes("from booking where")) {
          return { rows: [{ id: 42 }], rowCount: 1 };
        }
        if (sql.startsWith("delete from booking_companion")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("insert into booking_companion")) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("from booking_companion")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const result = await setBookingCompanions(db, {
      bookingPublicId: "bk-1",
      userId: 7,
      companionPublicIds: ["c-1", "c-1"],
    });
    expect(result.outcome).toBe("updated");
    const insert = calls.find((call) =>
      call.sql.includes("insert into booking_companion"),
    );
    expect(insert?.params?.[2]).toEqual(["c-1"]);
  });

  it("clears the companions when an empty set is sent", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const db: CompanionsDb = {
      query: asQuery(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes("from booking where")) {
          return { rows: [{ id: 42 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const result = await setBookingCompanions(db, {
      bookingPublicId: "bk-1",
      userId: 7,
      companionPublicIds: [],
    });
    expect(result.outcome).toBe("updated");
    expect(
      calls.some((call) => call.sql.includes("insert into booking_companion")),
    ).toBe(false);
  });

  it("throws companion_not_owned_or_missing when an insert is short", async () => {
    const db: CompanionsDb = {
      query: asQuery(async (sql) => {
        if (sql.includes("from booking where")) {
          return { rows: [{ id: 42 }], rowCount: 1 };
        }
        if (sql.includes("insert into booking_companion")) {
          // Only one of the two requested companions belongs to the caller.
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    await expect(
      setBookingCompanions(db, {
        bookingPublicId: "bk-1",
        userId: 7,
        companionPublicIds: ["c-1", "c-2"],
      }),
    ).rejects.toThrow("companion_not_owned_or_missing");
  });

  it("returns not_found for a booking owned by someone else", async () => {
    const { db } = makeBookingCompanionsDb(null);
    const result = await setBookingCompanions(db, {
      bookingPublicId: "bk-1",
      userId: 7,
      companionPublicIds: ["c-1"],
    });
    expect(result).toEqual({ outcome: "not_found" });
  });
});
