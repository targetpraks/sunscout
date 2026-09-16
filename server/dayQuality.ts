/**
 * Day Score engine — an audience-aware 0-100 verdict composed from the
 * already-shipped Beach Pulse (per-audience weights, community freshness,
 * condition staleness) plus an event-aware crowd forecast.
 *
 * Composition, not duplication: `computePulse` (server/beachPulse.ts) owns
 * per-audience weighting, staleness degradation and community freshness
 * decay. This module adds the Day Score layer on top:
 *
 * 1. Per-audience scores: for each of the six pulse audiences, run the pulse
 *    for the same beach snapshot. The payload carries all six so the client
 *    can highlight the selected audience; the headline score/tier is the
 *    pulse result for the requested audience.
 *
 * 2. Tier: go >= DAY_TIER_GO_MIN (70), wait >= DAY_TIER_WAIT_MIN (45),
 *    skip below — pinned constants, asserted in tests, mirrored in
 *    src/dayOutlook/types.ts (the server tree cannot import from src/, so
 *    the wire contract is a deliberate duplicate guarded by tests, the same
 *    pattern as beachPulse.ts <-> src/pulse/scoring.ts).
 *
 * 3. Crowd forecast: baseline hourly crowd (crowd_forecast rows, or a flat
 *    fallback) elevated by a documented additive bump per hour covered by
 *    an active published, NON-PAID beach event window. Paid takeovers NEVER
 *    feed the score or forecast — the advertising integrity rule
 *    (server/events.ts) — asserted in tests.
 *
 * All functions take `now` explicitly; nothing reads the system clock, so
 * tests are deterministic. The existing segment-scoring API
 * (computeAndStoreDayQuality / getDayQuality) is kept unchanged.
 */

import type { Pool, PoolClient } from "pg";
import {
  computePulse,
  type PulseAudience,
  type PulseBreakdown,
  type PulseInput,
} from "./beachPulse";
import type { BeachEvent } from "./events";

type Queryable = Pick<Pool | PoolClient, "query">;

// ---------------------------------------------------------------------------
// Wire contract (duplicated in src/dayOutlook/types.ts — keep in sync)
// ---------------------------------------------------------------------------

export type DayTier = "go" | "wait" | "skip";

export const DAY_TIER_GO_MIN = 70;
export const DAY_TIER_WAIT_MIN = 45;

export const DAY_SCORE_AUDIENCES: readonly PulseAudience[] = [
  "family",
  "friends",
  "solo",
  "couples",
  "party",
  "chill",
];

export function isDayScoreAudience(value: string): value is PulseAudience {
  return (DAY_SCORE_AUDIENCES as readonly string[]).includes(value);
}

export type AudienceDayScore = {
  audience: PulseAudience;
  score: number;
  tier: DayTier;
  confidence: number;
  staleConditions: boolean;
  breakdown: PulseBreakdown;
};

export type DayScoreCrowdPoint = {
  hour: number;
  crowd: number;
  /** Whether an active published non-paid event elevates this hour. */
  eventBoost: boolean;
};

export type DayScore = {
  /** Verdict for the requested (or default) audience, 0-100. */
  score: number;
  tier: DayTier;
  audience: PulseAudience;
  /** Scores for all six audiences — proves per-audience weighting. */
  audienceScores: AudienceDayScore[];
  crowdForecast: DayScoreCrowdPoint[];
  /** ISO timestamp of the condition row backing the score, null if none. */
  observedAt: string | null;
  /** ISO timestamp of when this score was computed. */
  computedAt: string;
  /** Honest flag: the condition row is older than the pulse stale threshold. */
  stale: boolean;
  /** Titles of events active at `now` that elevate the crowd forecast. */
  activeEvents: string[];
};

// ---------------------------------------------------------------------------
// Tier mapping
// ---------------------------------------------------------------------------

export function tierFor(score: number): DayTier {
  const s = Math.min(100, Math.max(0, Number.isFinite(score) ? score : 0));
  if (s >= DAY_TIER_GO_MIN) return "go";
  if (s >= DAY_TIER_WAIT_MIN) return "wait";
  return "skip";
}

// ---------------------------------------------------------------------------
// Event-aware crowd forecast
// ---------------------------------------------------------------------------

/**
 * Additive crowd bump per event category (percentage points), ordered by
 * expected crowd pull: parties biggest, sailing smallest. Capped per hour
 * by EVENT_CROWD_BUMP_MAX so a stacked event list cannot be gamed past it.
 */
export const EVENT_CROWD_BUMPS: Record<string, number> = {
  party: 35,
  takeover: 30,
  "beach-soccer": 22,
  triathlon: 22,
  "surf-competition": 18,
  sailing: 12,
};

export const EVENT_CROWD_BUMP_MAX = 35;

/**
 * Events that may elevate the algorithmic crowd forecast: published, not
 * yet finished at `now`, and never a paid takeover. A party starting in an
 * hour boosts its upcoming hours — SunScout shows what is really on at a
 * beach BEFORE and during the event. Paid takeovers own the visual/branding
 * layer only (advertising integrity rule, server/events.ts) — excluding
 * them here is what keeps paid placement out of the data moat.
 */
export function forecastEligibleEvents(
  events: BeachEvent[],
  now: Date,
): BeachEvent[] {
  const ref = now.getTime();
  return events.filter(
    (event) =>
      event.state === "published" &&
      !event.paidTakeover.isPaid &&
      new Date(event.endsAt).getTime() > ref,
  );
}

/**
 * Beach-local hour buckets (0-23) covered by an event window from `now`
 * onward — the forecast is forward-looking, so hours already past are
 * excluded. Bucketing is deterministic: hours come from UTC plus an
 * explicit beach UTC offset, never the machine's local timezone, so tests
 * and CI runners produce identical forecasts.
 */
function eventHours(
  event: BeachEvent,
  now: Date,
  utcOffsetHours: number,
): Set<number> {
  const hours = new Set<number>();
  const start = new Date(event.startsAt).getTime();
  const end = new Date(event.endsAt).getTime();
  const ref = now.getTime();
  const localHour = (ms: number) =>
    (((new Date(ms).getUTCHours() + Math.round(utcOffsetHours)) % 24) + 24) %
    24;
  for (let i = 0; i < 24; i++) {
    const cursor = start + i * 3_600_000;
    // End is exclusive: an event ending at 16:00 does not boost hour 16.
    if (cursor >= end) break;
    if (cursor > ref) hours.add(localHour(cursor));
  }
  return hours;
}

export type CrowdForecastOptions = {
  now: Date;
  /** First forecast hour (0-23, beach-local). Hours wrap within the day. */
  startHour: number;
  /** Number of hourly points to produce. */
  count: number;
  /** Beach UTC offset in hours (e.g. 1 for WEST). Deterministic bucketing. */
  utcOffsetHours?: number;
};

/**
 * Event-aware crowd forecast: baseline hourly crowd with a documented
 * additive bump on hours covered by active published non-paid events,
 * clamped to 100. Missing baseline hours fall back to the rounded mean of
 * the supplied baseline (0 when empty). Returns the forecast points plus
 * the distinct titles of the events that boosted them.
 */
export function computeCrowdForecast(
  baseline: Array<{ hour: number; crowd: number }>,
  events: BeachEvent[],
  options: CrowdForecastOptions,
): { points: DayScoreCrowdPoint[]; activeEvents: string[] } {
  const offset = options.utcOffsetHours ?? 0;
  const eligible = forecastEligibleEvents(events, options.now);
  const baseByHour = new Map(baseline.map((p) => [p.hour, p.crowd]));
  const fallback = baseline.length
    ? Math.round(
        baseline.reduce((sum, p) => sum + p.crowd, 0) / baseline.length,
      )
    : 0;

  // Per-hour bump: max over active eligible events, capped.
  const bumpByHour = new Map<number, number>();
  const titleByHour = new Map<number, string>();
  for (const event of eligible) {
    const bump = Math.min(
      EVENT_CROWD_BUMP_MAX,
      Math.max(0, EVENT_CROWD_BUMPS[event.category] ?? 0),
    );
    if (bump === 0) continue;
    for (const hour of eventHours(event, options.now, offset)) {
      if (bump > (bumpByHour.get(hour) ?? 0)) {
        bumpByHour.set(hour, bump);
        titleByHour.set(hour, event.title);
      }
    }
  }

  const points: DayScoreCrowdPoint[] = [];
  for (let i = 0; i < options.count; i++) {
    const hour = (options.startHour + i) % 24;
    const base = Math.min(100, Math.max(0, baseByHour.get(hour) ?? fallback));
    points.push({
      hour,
      crowd: Math.min(100, base + (bumpByHour.get(hour) ?? 0)),
      eventBoost: bumpByHour.has(hour),
    });
  }
  return {
    points,
    activeEvents: [...new Set([...titleByHour.values()])],
  };
}

// ---------------------------------------------------------------------------
// Day Score composition
// ---------------------------------------------------------------------------

export type DayScoreOptions = {
  audience: PulseAudience;
  /** Injected clock — the engine never reads the system clock. */
  now: Date;
  baselineCrowd?: Array<{ hour: number; crowd: number }>;
  events?: BeachEvent[];
  /** Forecast hour span. Defaults to the clock hour, 6 points, UTC. */
  forecastStartHour?: number;
  forecastCount?: number;
  forecastUtcOffsetHours?: number;
};

function audienceDayScore(
  input: PulseInput,
  audience: PulseAudience,
  now: Date,
): AudienceDayScore {
  const pulse = computePulse(input, { audience, now });
  return {
    audience,
    score: pulse.score,
    tier: tierFor(pulse.score),
    confidence: pulse.confidence,
    staleConditions: pulse.staleConditions,
    breakdown: pulse.breakdown,
  };
}

/**
 * Compute the Day Score for one beach snapshot. Pure: no I/O, no clock
 * reads. Composes computePulse for every audience and derives the
 * event-aware crowd forecast. Always returns finite, clamped scores.
 */
export function computeDayScore(
  input: PulseInput,
  options: DayScoreOptions,
): DayScore {
  const now = options.now;
  const audienceScores = DAY_SCORE_AUDIENCES.map((audience) =>
    audienceDayScore(input, audience, now),
  );
  const requested =
    audienceScores.find((s) => s.audience === options.audience) ??
    audienceScores[0];

  const forecast = computeCrowdForecast(
    options.baselineCrowd ?? [],
    options.events ?? [],
    {
      now,
      startHour: options.forecastStartHour ?? now.getUTCHours(),
      count: options.forecastCount ?? 6,
      utcOffsetHours: options.forecastUtcOffsetHours,
    },
  );

  return {
    score: requested.score,
    tier: requested.tier,
    audience: requested.audience,
    audienceScores,
    crowdForecast: forecast.points,
    observedAt: input.conditions?.observedAt || null,
    computedAt: now.toISOString(),
    stale: requested.staleConditions,
    activeEvents: forecast.activeEvents,
  };
}

// ---------------------------------------------------------------------------
// DB plumbing — keeps the pre-existing segment API intact and adds the
// loaders the /api/conditions handler needs to build a PulseInput.
// ---------------------------------------------------------------------------

type ConditionRow = {
  observed_at: Date | null;
  sea_temp_c: number | null;
  wave_height_m: number | null;
  uv_index: number | null;
  crowd_percent: number | null;
  air_temp_c: number | null;
  wind_speed_kmh: number | null;
  cloud_cover_percent: number | null;
};

export type CommunityRow = {
  checkIns: Array<{
    audience: PulseAudience;
    at: string;
    kind: "check-in" | "sighting";
  }>;
  accuracy: Array<{ at: string; accurate: boolean }>;
};

/**
 * Sightings use family/friends/solo/couple/group/beach-club; the pulse
 * vocabulary is family/friends/solo/couples/party/chill. Documented mapping:
 * couple -> couples, group -> friends (a group is the friends signal),
 * beach-club -> party (beach-club crowds are the party scene). family,
 * friends and solo map 1:1. Unknown audiences return null and are DROPPED
 * from the community signals — never silently re-bucketed.
 */
export const SIGHTING_AUDIENCE_MAP: Record<string, PulseAudience | undefined> =
  {
    family: "family",
    friends: "friends",
    solo: "solo",
    couple: "couples",
    group: "friends",
    "beach-club": "party",
  };

export function toPulseAudience(raw: string): PulseAudience | null {
  return SIGHTING_AUDIENCE_MAP[raw] ?? null;
}

/**
 * Load the pulse community signals for one beach: recent approved,
 * non-expired sightings as audience-matched check-ins (a sighting IS
 * check-in-shaped proof that a beach is alive right now) plus condition
 * accuracy feedback. Timestamps normalize to ISO strings on the way out.
 *
 * Note: beach_sighting.beach_id stores the beach PUBLIC id (text uuid),
 * not the numeric beach id — see migrations/014.
 */
export async function loadCommunitySignals(
  db: Queryable,
  beachId: number,
  beachPublicId: string,
): Promise<CommunityRow> {
  const [sightings, feedback] = await Promise.all([
    db.query<{ audience: string; captured_at: Date; media_form: string }>(
      `select audience, captured_at, media_form
       from beach_sighting
       where beach_id = $1
         and moderation_state = 'approved'
         and (expires_at is null or expires_at > now())
       order by captured_at desc
       limit 50`,
      [beachPublicId],
    ),
    db.query<{ created_at: Date; accurate: boolean }>(
      `select created_at, accurate
       from condition_feedback
       where beach_id = $1
       order by created_at desc
       limit 50`,
      [beachId],
    ),
  ]);
  return {
    checkIns: sightings.rows.flatMap((row) => {
      const audience = toPulseAudience(row.audience);
      if (!audience) return [];
      return [
        {
          audience,
          at: new Date(row.captured_at).toISOString(),
          kind: row.media_form === "native" ? "check-in" : "sighting",
        },
      ];
    }),
    accuracy: feedback.rows.map((row) => ({
      at: new Date(row.created_at).toISOString(),
      accurate: row.accurate,
    })),
  };
}

/** Build a PulseInput from live DB rows for one beach. */
export async function loadPulseInput(
  db: Queryable,
  beachId: number,
  beachPublicId: string,
): Promise<PulseInput> {
  const [condition, community] = await Promise.all([
    db.query<ConditionRow>(
      `select observed_at, sea_temp_c, wave_height_m, uv_index, crowd_percent,
         air_temp_c, wind_speed_kmh, cloud_cover_percent
       from beach_condition
       where beach_id = $1
       order by received_at desc
       limit 1`,
      [beachId],
    ),
    loadCommunitySignals(db, beachId, beachPublicId),
  ]);
  const row = condition.rows[0];
  return {
    id: beachPublicId,
    conditions: row
      ? {
          observedAt: row.observed_at
            ? new Date(row.observed_at).toISOString()
            : "",
          waveM: row.wave_height_m,
          windKmh: row.wind_speed_kmh,
          waterTempC: row.sea_temp_c,
          airTempC: row.air_temp_c,
          uvIndex: row.uv_index,
          crowdPct: row.crowd_percent,
          cloudPct: row.cloud_cover_percent,
        }
      : null,
    community: {
      checkIns: community.checkIns,
      accuracyRatings: community.accuracy,
    },
  };
}

/** Baseline hourly crowd rows from the crowd_forecast table. */
export async function loadBaselineCrowd(
  db: Queryable,
  beachId: number,
): Promise<Array<{ hour: number; crowd: number }>> {
  const result = await db.query<{ hour: number; crowd_percent: number }>(
    `select hour, crowd_percent from crowd_forecast
     where beach_id = $1 order by hour`,
    [beachId],
  );
  return result.rows.map((row) => ({
    hour: Number(row.hour),
    crowd: Number(row.crowd_percent),
  }));
}

// ---------------------------------------------------------------------------
// Legacy segment API (unchanged, pre-existing)
// ---------------------------------------------------------------------------

type HourlyData = {
  time: string;
  tempC: number | null;
  windKmh: number | null;
  cloudPct: number | null;
  precipPct: number | null;
  uvIndex: number | null;
  waveM: number | null;
};

type SegmentScore = {
  score: number;
  summary: string;
};

export type DayQualityResult = {
  earlyMorning: SegmentScore;
  midday: SegmentScore;
  afternoon: SegmentScore;
  evening: SegmentScore;
  overall: number;
};

function hourOf(h: HourlyData): number {
  return Number(h.time.split("T")[1]?.split(":")[0] ?? 0);
}

function scoreHour(h: HourlyData): number {
  let s = 0;
  const wind = h.windKmh ?? 20;
  s += wind < 15 ? 25 : wind < 25 ? 15 : wind < 35 ? 5 : 0;
  const cloud = h.cloudPct ?? 50;
  s += cloud < 25 ? 20 : cloud < 50 ? 15 : cloud < 75 ? 10 : 5;
  const precip = h.precipPct ?? 0;
  s += precip === 0 ? 20 : precip < 30 ? 15 : precip < 60 ? 5 : 0;
  const uv = h.uvIndex ?? 5;
  s += uv <= 2 ? 15 : uv <= 7 ? 10 : 5;
  const temp = h.tempC ?? 25;
  s += temp >= 22 && temp <= 30 ? 15 : temp >= 18 && temp <= 35 ? 10 : 5;
  const wave = h.waveM ?? 0.5;
  s += wave < 0.5 ? 5 : wave < 1 ? 3 : 1;
  return s;
}

function summarize(score: number): string {
  if (score >= 80) return "Excellent beach conditions";
  if (score >= 65) return "Good conditions for most activities";
  if (score >= 50) return "Fair — check wind and waves";
  if (score >= 35) return "Challenging — strong wind or cloud likely";
  return "Poor conditions — consider another beach";
}

function segmentScore(hours: HourlyData[]): SegmentScore {
  if (!hours.length) return { score: 0, summary: "No forecast data" };
  const avg = Math.round(
    hours.reduce((sum, h) => sum + scoreHour(h), 0) / hours.length,
  );
  return { score: avg, summary: summarize(avg) };
}

export async function computeAndStoreDayQuality(
  pool: Pool,
  beachId: number,
  hourly: HourlyData[],
): Promise<DayQualityResult> {
  // 4 segments: early morning 6-10, midday 10-14, afternoon 14-18, evening 18-21
  const earlyMorning = segmentScore(
    hourly.filter((h) => hourOf(h) >= 6 && hourOf(h) < 10),
  );
  const midday = segmentScore(
    hourly.filter((h) => hourOf(h) >= 10 && hourOf(h) < 14),
  );
  const afternoon = segmentScore(
    hourly.filter((h) => hourOf(h) >= 14 && hourOf(h) < 18),
  );
  const evening = segmentScore(
    hourly.filter((h) => hourOf(h) >= 18 && hourOf(h) < 21),
  );
  const overall = Math.round(
    (earlyMorning.score + midday.score + afternoon.score + evening.score) / 4,
  );

  await pool.query(
    `insert into day_quality(beach_id, early_morning_score, morning_score, afternoon_score,
       late_afternoon_score, overall_score, early_morning_summary, morning_summary,
       afternoon_summary, late_afternoon_summary, raw_hourly)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (beach_id, day) do update set
       early_morning_score = excluded.early_morning_score,
       morning_score = excluded.morning_score,
       afternoon_score = excluded.afternoon_score,
       late_afternoon_score = excluded.late_afternoon_score,
       overall_score = excluded.overall_score,
       early_morning_summary = excluded.early_morning_summary,
       morning_summary = excluded.morning_summary,
       afternoon_summary = excluded.afternoon_summary,
       late_afternoon_summary = excluded.late_afternoon_summary,
       raw_hourly = excluded.raw_hourly,
       computed_at = now()`,
    [
      beachId,
      earlyMorning.score,
      midday.score,
      afternoon.score,
      evening.score,
      overall,
      earlyMorning.summary,
      midday.summary,
      afternoon.summary,
      evening.summary,
      JSON.stringify(hourly),
    ],
  );

  return { earlyMorning, midday, afternoon, evening, overall };
}

export async function getDayQuality(
  pool: Pool,
  beachId: number,
): Promise<DayQualityResult | null> {
  const result = await pool.query<{
    early_morning_score: number | null;
    morning_score: number | null;
    afternoon_score: number | null;
    late_afternoon_score: number | null;
    overall_score: number;
    early_morning_summary: string | null;
    morning_summary: string;
    afternoon_summary: string;
    late_afternoon_summary: string;
  }>(
    `select early_morning_score, morning_score, afternoon_score, late_afternoon_score,
       overall_score, early_morning_summary, morning_summary,
       afternoon_summary, late_afternoon_summary
     from day_quality where beach_id = $1 and day = current_date`,
    [beachId],
  );
  if (!result.rowCount) return null;
  const r = result.rows[0];
  return {
    earlyMorning: {
      score: r.early_morning_score ?? 0,
      summary: r.early_morning_summary ?? "No data",
    },
    midday: { score: r.morning_score ?? 0, summary: r.morning_summary },
    afternoon: { score: r.afternoon_score ?? 0, summary: r.afternoon_summary },
    evening: {
      score: r.late_afternoon_score ?? 0,
      summary: r.late_afternoon_summary,
    },
    overall: r.overall_score,
  };
}
