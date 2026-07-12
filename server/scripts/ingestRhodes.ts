import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool, withTransaction } from "../db";

type RhodesBeach = {
  publicId: string;
  slug: string;
  name: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  description: string;
  decision: string;
  match: number;
  seaTemp: number;
  waves: number;
  uv: number;
  crowd: number;
  waterQuality: string;
  blueFlag: boolean;
  spotter: boolean;
  lightScore: number;
  goldenDirection: string;
  vibes: string[];
  hazards: never[];
  suitability: Record<string, [string, number | null]>;
  amenities: string[];
  activities: string[];
  allowsNudism: boolean;
  inventory: { sunbeds: number; umbrellas: number };
  beachType: string;
};

const beaches: RhodesBeach[] = JSON.parse(
  readFileSync("/tmp/rhodes_beaches.json", "utf8"),
);

async function ingest() {
  await withTransaction(async (client) => {
    for (const beach of beaches) {
      const result = await client.query<{ id: number }>(
        `insert into beach(
          public_id, slug, name, country_code, region, latitude, longitude,
          timezone, description, decision_text, cover_photo_url, beach_type,
          has_spotter, blue_flag, match_score, allows_nudism
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'Europe/Athens', $8, $9,
          '/assets/beaches/' || $2 || '.svg', $10, $11, $12, $13, $14)
        on conflict (public_id) do update set
          name = excluded.name, cover_photo_url = excluded.cover_photo_url,
          match_score = excluded.match_score, allows_nudism = excluded.allows_nudism
        returning id`,
        [
          beach.publicId,
          beach.slug,
          beach.name,
          beach.country,
          beach.region,
          beach.lat,
          beach.lng,
          beach.description,
          beach.decision,
          beach.beachType,
          beach.spotter,
          beach.blueFlag,
          beach.match,
          beach.allowsNudism,
        ],
      );
      const beachId = result.rows[0].id;

      // Condition (seed values — refresh will get live Open-Meteo data)
      await client.query("delete from beach_condition where beach_id = $1", [
        beachId,
      ]);
      await client.query(
        `insert into beach_condition(
          beach_id, observed_at, source, sea_temp_c, wave_height_m, uv_index,
          crowd_percent, water_quality, air_temp_c, wind_speed_kmh, cloud_cover_percent, raw
        )
        values ($1, now() - interval '5 minutes', 'provider_demo', $2, $3, $4, $5, $6, 27, 15, 10,
          jsonb_build_object('matchScore', $7::int))`,
        [
          beachId,
          beach.seaTemp,
          beach.waves,
          beach.uv,
          beach.crowd,
          beach.waterQuality,
          beach.match,
        ],
      );

      // Suitability
      for (const [audience, [label, score]] of Object.entries(
        beach.suitability,
      )) {
        await client.query(
          `insert into beach_suitability(beach_id, audience, label, score)
           values ($1, $2, $3, $4)
           on conflict (beach_id, audience) do update set label = excluded.label, score = excluded.score`,
          [beachId, audience, label, score],
        );
      }

      // Amenities
      await client.query("delete from beach_amenity where beach_id = $1", [
        beachId,
      ]);
      for (const amenity of beach.amenities) {
        await client.query(
          `insert into beach_amenity(beach_id, amenity, verified_at, source)
           values ($1, $2, now() - interval '1 day', 'osm')`,
          [beachId, amenity],
        );
      }

      // Activities
      await client.query("delete from beach_activity where beach_id = $1", [
        beachId,
      ]);
      for (const activity of beach.activities) {
        await client.query(
          `insert into beach_activity(beach_id, activity) values ($1, $2) on conflict do nothing`,
          [beachId, activity],
        );
      }

      // Vibe tags
      await client.query("delete from vibe_tag where beach_id = $1", [beachId]);
      for (const vibe of beach.vibes) {
        await client.query(
          `insert into vibe_tag(beach_id, tag) values ($1, $2) on conflict do nothing`,
          [beachId, vibe],
        );
      }

      // Photos (gallery — generate 4 time-of-day references pointing to the hero SVG)
      await client.query("delete from beach_photo where beach_id = $1", [
        beachId,
      ]);
      const times = [
        ["Morning", "morning"],
        ["Midday", "midday"],
        ["Golden hour", "golden"],
        ["Blue hour", "blue"],
      ] as const;
      times.forEach(([label, suffix], i) => {
        void client.query(
          `insert into beach_photo(beach_id, photo_url, time_of_day, caption, position)
           values ($1, '/assets/beaches/' || $2 || '.svg', $3, $4, $5)`,
          [beachId, beach.slug, label, `${label} at ${beach.name}`, i],
        );
      });
    }
  });
  console.log(`Ingested ${beaches.length} Rhodes beaches`);
  return pool.end();
}

ingest().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
