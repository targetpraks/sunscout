import type { Pool } from "pg";

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
