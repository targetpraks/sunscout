import type { Pool, PoolClient } from "pg";
import { newPublicId } from "./tokens";
import { z } from "zod";

type Queryable = Pick<Pool | PoolClient, "query">;

/** Exported so tests and callers can type fake/connection-scoped DB handles. */
export type EventsDb = Queryable;

export const EVENT_CATEGORIES = [
  "party",
  "surf-competition",
  "beach-soccer",
  "triathlon",
  "sailing",
  "takeover",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_STATES = ["draft", "published", "cancelled"] as const;

export type EventState = (typeof EVENT_STATES)[number];

/**
 * Monetization label for paid beach/island/region takeovers. This flag owns
 * ONLY the visual/branding/curated layer. Per the advertising integrity rule
 * it must never be read by, feed into, or be mutated into any earned-ranking
 * or Beach Pulse signal (dayQuality, rankBeaches, match scores).
 */
export const PAID_TAKEOVER_LABEL = "Paid takeover";

export type PaidTakeover = {
  isPaid: boolean;
  label: string;
  sponsorName: string | null;
};

export type BeachEvent = {
  id: number;
  publicId: string;
  beachPublicId: string;
  beachName: string;
  coordinatorId: number;
  title: string;
  description: string | null;
  category: EventCategory;
  state: EventState;
  startsAt: string;
  endsAt: string;
  paidTakeover: PaidTakeover;
  createdAt: string;
  updatedAt: string;
};

/**
 * DDL for the beach_event table. Kept here (not in server/migrations/) because
 * this worktree owns only the events module files; the integration owner
 * should drop this into the next numbered migration unchanged.
 */
export const EVENTS_MIGRATION_SQL = `create table if not exists beach_event (
  id serial primary key,
  public_id uuid not null unique default gen_random_uuid(),
  beach_id int not null references beach(id),
  coordinator_id int not null references app_user(id),
  title text not null,
  description text,
  category text not null check (category in ('party','surf-competition','beach-soccer','triathlon','sailing','takeover')),
  state text not null default 'draft' check (state in ('draft','published','cancelled')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  is_paid_takeover boolean not null default false,
  sponsor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beach_event_window check (end_at > start_at)
);
create index if not exists beach_event_beach_idx on beach_event (beach_id, start_at);
create index if not exists beach_event_coordinator_idx on beach_event (coordinator_id);`;

export const eventInputSchema = z
  .object({
    beachPublicId: z.string().uuid(),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    category: z.enum(EVENT_CATEGORIES),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    isPaidTakeover: z.boolean().default(false),
    sponsorName: z.string().trim().min(1).max(80).optional(),
  })
  .refine(
    (value) =>
      new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(),
    { message: "event_window_invalid", path: ["endsAt"] },
  );

export type EventInput = z.infer<typeof eventInputSchema>;

/**
 * Partitions events relative to a fixed reference time into three disjoint
 * buckets: past (end <= now), happeningNow (start <= now < end) and upcoming
 * (start > now). Every event lands in exactly one bucket; upcoming and
 * happening-now are ordered by start time ascending, past by end time
 * descending. Pure: never touches the DB and never reads paidTakeover.
 */
export type EventPartition = {
  happeningNow: BeachEvent[];
  upcoming: BeachEvent[];
  past: BeachEvent[];
};

export function partitionEvents(
  events: BeachEvent[],
  now: Date,
): EventPartition {
  const ref = now.getTime();
  const happeningNow: BeachEvent[] = [];
  const upcoming: BeachEvent[] = [];
  const past: BeachEvent[] = [];
  for (const event of events) {
    const start = new Date(event.startsAt).getTime();
    const end = new Date(event.endsAt).getTime();
    if (end <= ref) {
      past.push(event);
    } else if (start <= ref) {
      happeningNow.push(event);
    } else {
      upcoming.push(event);
    }
  }
  const byStartAsc = (a: BeachEvent, b: BeachEvent) =>
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  const byEndDesc = (a: BeachEvent, b: BeachEvent) =>
    new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime();
  upcoming.sort(byStartAsc);
  happeningNow.sort(byStartAsc);
  past.sort(byEndDesc);
  return { happeningNow, upcoming, past };
}

/**
 * Events visible on the consumer calendar: only published ones. Drafts and
 * cancelled events stay coordinator-private.
 */
export function consumerVisibleEvents(events: BeachEvent[]): BeachEvent[] {
  return events.filter((event) => event.state === "published");
}

export function consumerCalendarPartition(
  events: BeachEvent[],
  now: Date,
): EventPartition {
  return partitionEvents(consumerVisibleEvents(events), now);
}

type EventRow = {
  id: number;
  public_id: string;
  beach_public_id: string;
  beach_name: string;
  coordinator_id: number;
  title: string;
  description: string | null;
  category: EventCategory;
  state: EventState;
  start_at: Date;
  end_at: Date;
  is_paid_takeover: boolean;
  sponsor_name: string | null;
  created_at: Date;
  updated_at: Date;
};

function serializeEvent(row: EventRow): BeachEvent {
  return {
    id: row.id,
    publicId: row.public_id,
    beachPublicId: row.beach_public_id,
    beachName: row.beach_name,
    coordinatorId: row.coordinator_id,
    title: row.title,
    description: row.description,
    category: row.category,
    state: row.state,
    startsAt: new Date(row.start_at).toISOString(),
    endsAt: new Date(row.end_at).toISOString(),
    paidTakeover: {
      isPaid: row.is_paid_takeover,
      label: PAID_TAKEOVER_LABEL,
      sponsorName: row.sponsor_name,
    },
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const SELECT_EVENT = `select e.id, e.public_id, b.public_id as beach_public_id,
    b.name as beach_name, e.coordinator_id, e.title, e.description,
    e.category, e.state, e.start_at, e.end_at, e.is_paid_takeover,
    e.sponsor_name, e.created_at, e.updated_at
  from beach_event e
  join beach b on b.id = e.beach_id`;

export async function getEventByPublicId(
  db: Queryable,
  eventPublicId: string,
): Promise<BeachEvent | null> {
  const result = await db.query<EventRow>(
    `${SELECT_EVENT} where e.public_id = $1`,
    [eventPublicId],
  );
  const row = result.rows[0];
  return row ? serializeEvent(row) : null;
}

/**
 * Tenant isolation gate: every state/publish/cancel operation must pass
 * through this check. A wrong-owner caller gets a distinct error from the
 * not-found case so ownership failures are never laundered as 404s.
 */
export function assertEventOwner(
  event: BeachEvent,
  coordinatorId: number,
): void {
  if (event.coordinatorId !== coordinatorId) {
    throw new Error("event_forbidden");
  }
}

export async function createEvent(
  db: Queryable,
  input: unknown,
  coordinatorId: number,
): Promise<BeachEvent> {
  const parsed = eventInputSchema.parse(input);
  const beach = await db.query<{ id: number }>(
    `select id from beach where public_id = $1`,
    [parsed.beachPublicId],
  );
  if (!beach.rowCount) throw new Error("beach_not_found");
  const publicId = newPublicId();
  await db.query(
    `insert into beach_event
      (public_id, beach_id, coordinator_id, title, description, category,
       start_at, end_at, state, is_paid_takeover, sponsor_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10)`,
    [
      publicId,
      beach.rows[0].id,
      coordinatorId,
      parsed.title,
      parsed.description ?? null,
      parsed.category,
      parsed.startsAt,
      parsed.endsAt,
      parsed.isPaidTakeover,
      parsed.sponsorName ?? null,
    ],
  );
  const created = await getEventByPublicId(db, publicId);
  if (!created) throw new Error("event_not_found");
  return created;
}

export async function listBeachEvents(
  db: Queryable,
  beachPublicId: string,
  options: { coordinatorId?: number } = {},
): Promise<BeachEvent[]> {
  const result = await db.query<EventRow>(
    `${SELECT_EVENT}
     where b.public_id = $1
       and (e.state = 'published' or ($2::int is not null and e.coordinator_id = $2))
     order by e.start_at asc`,
    [beachPublicId, options.coordinatorId ?? null],
  );
  return result.rows.map(serializeEvent);
}

export async function listCoordinatorEvents(
  db: Queryable,
  coordinatorId: number,
): Promise<BeachEvent[]> {
  const result = await db.query<EventRow>(
    `${SELECT_EVENT} where e.coordinator_id = $1 order by e.start_at asc`,
    [coordinatorId],
  );
  return result.rows.map(serializeEvent);
}

async function setEventState(
  db: Queryable,
  eventPublicId: string,
  coordinatorId: number,
  nextState: EventState,
): Promise<BeachEvent> {
  const event = await getEventByPublicId(db, eventPublicId);
  if (!event) throw new Error("event_not_found");
  assertEventOwner(event, coordinatorId);
  if (event.state === nextState) return event;
  if (event.state === "cancelled" && nextState === "published") {
    throw new Error("event_cancelled");
  }
  await db.query(
    `update beach_event set state = $1, updated_at = now() where id = $2`,
    [nextState, event.id],
  );
  const updated = await getEventByPublicId(db, eventPublicId);
  if (!updated) throw new Error("event_not_found");
  return updated;
}

export async function publishEvent(
  db: Queryable,
  eventPublicId: string,
  coordinatorId: number,
): Promise<BeachEvent> {
  return setEventState(db, eventPublicId, coordinatorId, "published");
}

export async function cancelEvent(
  db: Queryable,
  eventPublicId: string,
  coordinatorId: number,
): Promise<BeachEvent> {
  return setEventState(db, eventPublicId, coordinatorId, "cancelled");
}
