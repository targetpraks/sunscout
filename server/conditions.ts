import type { Pool, PoolClient } from "pg";
import { openMeteoProvider } from "./providers/openMeteo";
import { mockedTideProvider } from "./providers/tide";
import type { TideProvider } from "./providers/tide";
import { mockedWaterQualityProvider } from "./providers/waterQuality";
import type { WaterQualityProvider } from "./providers/waterQuality";
import type { ConditionsProvider } from "./providers/types";

type Queryable = Pick<Pool | PoolClient, "query">;

type BeachConditionRow = {
  id: number;
  slug: string;
  latitude: string;
  longitude: string;
  timezone: string;
  latest_received_at: Date | null;
  latest_source: string | null;
  crowd_percent: number | null;
  water_quality: string | null;
  latest_raw: Record<string, unknown> | null;
};

export type RefreshResult = {
  refreshed: string[];
  cached: string[];
  failed: Array<{ slug: string; error: string }>;
};

const defaultCacheMinutes = 10;

const pad = (n: number) => String((n + 24) % 24).padStart(2, "0");

export async function refreshConditions(
  db: Queryable,
  options: {
    force?: boolean;
    slugs?: string[];
    provider?: ConditionsProvider;
    tideProvider?: TideProvider;
    waterQualityProvider?: WaterQualityProvider;
    cacheMinutes?: number;
  } = {},
): Promise<RefreshResult> {
  const provider = options.provider ?? openMeteoProvider;
  const tideProvider = options.tideProvider ?? mockedTideProvider;
  const waterQualityProvider =
    options.waterQualityProvider ?? mockedWaterQualityProvider;
  const cacheMinutes = options.cacheMinutes ?? defaultCacheMinutes;
  const result = await db.query<BeachConditionRow>(
    `select
       b.id, b.slug, b.latitude, b.longitude, b.timezone,
       c.received_at as latest_received_at,
       c.source as latest_source,
       c.crowd_percent,
       c.water_quality,
       c.raw as latest_raw
     from beach b
     left join lateral (
       select received_at, source, crowd_percent, water_quality, raw
       from beach_condition
       where beach_id = b.id
       order by received_at desc
       limit 1
     ) c on true
     where ($1::text[] is null or b.slug = any($1::text[]))
     order by b.id`,
    [options.slugs?.length ? options.slugs : null],
  );

  const output: RefreshResult = { refreshed: [], cached: [], failed: [] };
  await Promise.all(
    result.rows.map(async (beach) => {
      const ageMs = beach.latest_received_at
        ? Date.now() - new Date(beach.latest_received_at).getTime()
        : Number.POSITIVE_INFINITY;
      const providerCacheIsFresh =
        beach.latest_source?.startsWith("open_meteo") &&
        ageMs < cacheMinutes * 60 * 1_000;
      if (!options.force && providerCacheIsFresh) {
        output.cached.push(beach.slug);
        return;
      }

      try {
        const reading = await provider.fetchCurrent({
          id: beach.id,
          slug: beach.slug,
          latitude: Number(beach.latitude),
          longitude: Number(beach.longitude),
          timezone: beach.timezone,
        });
        const priorRaw = beach.latest_raw ?? {};
        const weather = (reading.raw?.weather ?? {}) as {
          sunrise?: string | null;
          sunset?: string | null;
          uvIndexMax?: number | null;
        };
        const sunriseRaw = weather.sunrise
          ? new Date(String(weather.sunrise))
          : null;
        const sunsetRaw = weather.sunset
          ? new Date(String(weather.sunset))
          : null;
        const blueHourMorning = sunriseRaw
          ? `${pad(sunriseRaw.getHours() - 1)}:${pad(sunriseRaw.getMinutes())}–${pad(sunriseRaw.getHours())}:${pad(sunriseRaw.getMinutes())}`
          : null;
        const blueHourEvening = sunsetRaw
          ? `${pad(sunsetRaw.getHours())}:${pad(sunsetRaw.getMinutes())}–${pad(sunsetRaw.getHours() + 1)}:${pad(sunsetRaw.getMinutes())}`
          : null;
        const uvMax = Number(weather.uvIndexMax ?? reading.uvIndex ?? 0);
        const lightScore = Math.min(100, Math.round(40 + uvMax * 9));

        const waterQuality = await waterQualityProvider.fetchWaterQuality({
          id: beach.id,
          slug: beach.slug,
          latitude: Number(beach.latitude),
          longitude: Number(beach.longitude),
          timezone: beach.timezone,
        });

        const weatherRaw = (reading.raw?.weather ?? {}) as {
          airTempC?: number | null;
          windSpeedKmh?: number | null;
          cloudCoverPercent?: number | null;
        };
        await db.query(
          `insert into beach_condition(
             beach_id, observed_at, received_at, source, sea_temp_c,
             wave_height_m, uv_index, crowd_percent, water_quality,
             golden_hour_start, golden_hour_end, sunrise, sunset,
             blue_hour_morning, blue_hour_evening, golden_hour_direction,
             light_score, air_temp_c, wind_speed_kmh, cloud_cover_percent, raw
           )
           values ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            beach.id,
            reading.observedAt,
            reading.source,
            reading.seaTempC,
            reading.waveHeightM,
            reading.uvIndex,
            beach.crowd_percent,
            waterQuality.state,
            reading.goldenHourStart,
            reading.goldenHourEnd,
            sunriseRaw,
            sunsetRaw,
            blueHourMorning,
            blueHourEvening,
            "West-facing cliffs",
            lightScore,
            weatherRaw.airTempC ?? null,
            weatherRaw.windSpeedKmh ?? null,
            weatherRaw.cloudCoverPercent ?? null,
            {
              ...priorRaw,
              ...reading.raw,
              waterQuality: {
                state: waterQuality.state,
                blueFlagEligible: waterQuality.blueFlagEligible,
                source: waterQuality.source,
              },
              refreshedAt: new Date().toISOString(),
            },
          ],
        );

        try {
          const tide = await tideProvider.fetchTide({
            id: beach.id,
            slug: beach.slug,
            latitude: Number(beach.latitude),
            longitude: Number(beach.longitude),
            timezone: beach.timezone,
          });
          await db.query(
            `delete from beach_tide_reading where beach_id = $1 and day = current_date`,
            [beach.id],
          );
          for (const point of tide.points) {
            await db.query(
              `insert into beach_tide_reading(beach_id, day, time_label, height_m, source)
               values ($1, current_date, $2, $3, $4)
               on conflict (beach_id, day, time_label) do update
                 set height_m = excluded.height_m, source = excluded.source`,
              [beach.id, point.timeLabel, point.heightM, tide.source],
            );
          }
        } catch {
          /* tide provider optional; keep seeded tide on failure */
        }
        output.refreshed.push(beach.slug);
      } catch (error) {
        output.failed.push({
          slug: beach.slug,
          error: error instanceof Error ? error.message : "provider_error",
        });
      }
    }),
  );

  return output;
}
