import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const radiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

export async function listBeaches(
  db: Queryable,
  userId?: number | null,
  origin?: { latitude: number; longitude: number } | null,
) {
  const userParam = userId ?? null;
  const result = await db.query(
    `with latest_condition as (
      select distinct on (beach_id)
        beach_id, observed_at, received_at, source, sea_temp_c, wave_height_m,
        uv_index, crowd_percent, water_quality, golden_hour_start,
        golden_hour_end, sunrise, sunset, blue_hour_morning, blue_hour_evening,
        golden_hour_direction, light_score, air_temp_c, wind_speed_kmh,
        cloud_cover_percent, raw
      from beach_condition
      order by beach_id, received_at desc
    ),
    suitability as (
      select beach_id,
        jsonb_agg(
          jsonb_build_object(
            'id', audience,
            'label', case audience
              when 'families' then 'Families'
              when 'solo' then 'Solo'
              when 'couples' then 'Couples'
              when 'party' then 'Party'
              else 'Beach clubs'
            end,
            'value', label,
            'score', score,
            'ageMin', age_min,
            'ageMax', age_max
          )
          order by case audience
            when 'families' then 1 when 'solo' then 2 when 'couples' then 3
            when 'party' then 4 else 5 end
        ) as items
      from beach_suitability
      group by beach_id
    ),
    amenities as (
      select beach_id,
        jsonb_agg(
          jsonb_build_object(
            'name', amenity,
            'verifiedAt', to_char(verified_at at time zone 'Europe/Lisbon', 'YYYY-MM-DD'),
            'source', source
          )
          order by amenity
        ) as items
      from beach_amenity
      group by beach_id
    ),
    inventory as (
      select m.beach_id,
        coalesce(sum(ai.available_count) filter (where ai.amenity_type = 'sunbed'), 0)::int as sunbeds,
        coalesce(sum(ai.available_count) filter (where ai.amenity_type = 'umbrella'), 0)::int as umbrellas,
        count(distinct m.id)::int as clubs
      from merchant m
      left join amenity_inventory ai on ai.merchant_id = m.id
      where m.kyc_status = 'verified'
      group by m.beach_id
    ),
    vibes as (
      select t.beach_id,
        jsonb_agg(
          jsonb_build_object(
            'tag', t.tag,
            'votes', coalesce(v.votes, 0),
            'userVoted', coalesce(v.user_voted, false)
          )
          order by coalesce(v.votes, 0) desc, t.tag
        ) as items
      from vibe_tag t
      left join (
        select beach_id, tag, count(*)::int as votes,
          bool_or(user_id = $1) as user_voted
        from vibe_vote
        group by beach_id, tag
      ) v on v.beach_id = t.beach_id and v.tag = t.tag
      group by t.beach_id
    ),
    photos as (
      select beach_id,
        jsonb_agg(
          jsonb_build_object(
            'url', photo_url,
            'timeOfDay', time_of_day,
            'caption', caption
          )
          order by position
        ) as items
      from beach_photo
      group by beach_id
    ),
    hazards as (
      select beach_id,
        jsonb_agg(
          jsonb_build_object(
            'id', public_id,
            'severity', severity,
            'title', title,
            'detail', detail,
            'at', to_char(created_at at time zone 'Europe/Lisbon', 'YYYY-MM-DD')
          )
          order by created_at desc
        ) as items
      from hazard_alert
      where expires_at is null or expires_at > now()
      group by beach_id
    ),
    tide as (
      select beach_id,
        jsonb_agg(
          jsonb_build_object('time', time_label, 'level', height_m)
          order by time_label
        ) as items
      from beach_tide_reading td
      where td.day = (
        select max(day) from beach_tide_reading where beach_id = td.beach_id
      )
      group by td.beach_id
    ),
    forecast as (
      select beach_id,
        jsonb_agg(
          jsonb_build_object('hour', hour, 'crowd', crowd_percent)
          order by hour
        ) as items
      from crowd_forecast
      group by beach_id
    ),
    activities as (
      select beach_id, jsonb_agg(activity order by activity) as items
      from beach_activity
      group by beach_id
    )
    select
      b.public_id, b.slug, b.name, b.region, b.country_code, b.description,
      b.decision_text, b.cover_photo_url, b.has_spotter, b.blue_flag, b.match_score,
      b.allows_nudism, b.latitude::float as latitude, b.longitude::float as longitude,
      c.air_temp_c, c.wind_speed_kmh, c.cloud_cover_percent,
      c.observed_at, c.received_at, c.source, c.sea_temp_c, c.wave_height_m,
      c.uv_index, c.crowd_percent, c.water_quality, c.golden_hour_start,
      c.golden_hour_end, c.sunrise, c.sunset, c.blue_hour_morning,
      c.blue_hour_evening, c.golden_hour_direction, c.light_score, c.raw,
      coalesce(s.items, '[]'::jsonb) as suitability,
      coalesce(a.items, '[]'::jsonb) as amenities,
      coalesce(vb.items, '[]'::jsonb) as vibes,
      coalesce(p.items, '[]'::jsonb) as photos,
      coalesce(h.items, '[]'::jsonb) as hazards,
      coalesce(td.items, '[]'::jsonb) as tide,
      coalesce(act.items, '[]'::jsonb) as activities,
      coalesce(f.items, '[]'::jsonb) as crowd_forecast,
      coalesce(i.sunbeds, 0) as sunbeds,
      coalesce(i.umbrellas, 0) as umbrellas,
      coalesce(i.clubs, 0) as clubs
    from beach b
    left join latest_condition c on c.beach_id = b.id
    left join suitability s on s.beach_id = b.id
    left join amenities a on a.beach_id = b.id
    left join vibes vb on vb.beach_id = b.id
    left join photos p on p.beach_id = b.id
    left join hazards h on h.beach_id = b.id
    left join tide td on td.beach_id = b.id
    left join activities act on act.beach_id = b.id
    left join forecast f on f.beach_id = b.id
    left join inventory i on i.beach_id = b.id
    order by b.match_score desc, b.id`,
    [userParam],
  );

  return result.rows.map((row) => {
    const time = (date: Date | null) =>
      date?.toLocaleTimeString("en-GB", {
        timeZone: "Europe/Lisbon",
        hour: "2-digit",
        minute: "2-digit",
      }) ?? "—";

    const clubsItem = row.suitability.find(
      (item: { id: string }) => item.id === "clubs",
    );
    const clubsFromLabel = Number.parseInt(clubsItem?.value ?? "", 10);
    const uvValue = row.uv_index == null ? null : Number(row.uv_index);
    const uvLabel =
      uvValue == null
        ? ""
        : uvValue < 3
          ? "Low"
          : uvValue < 6
            ? "Moderate"
            : uvValue < 8
              ? "High"
              : uvValue < 11
                ? "Very high"
                : "Extreme";

    const vibeVotes: Array<{ tag: string; votes: number; userVoted: boolean }> =
      row.vibes;
    const amenityDetails: Array<{
      name: string;
      verifiedAt: string | null;
      source: string | null;
    }> = row.amenities;
    const photos: Array<{ url: string; timeOfDay: string; caption: string }> =
      row.photos;
    const hazards: Array<{
      id: string;
      severity: string;
      title: string;
      detail: string;
      at: string;
    }> = row.hazards;
    const tidePoints: Array<{ time: string; level: number }> = row.tide;
    const crowdForecast: Array<{ hour: number; crowd: number }> =
      row.crowd_forecast;

    const distance = origin
      ? haversineKm(
          origin.latitude,
          origin.longitude,
          row.latitude,
          row.longitude,
        )
      : null;
    const travel: {
      distanceKm: number;
      walkMinutes: number;
      driveMinutes: number;
    } | null =
      distance == null
        ? null
        : {
            distanceKm: Math.round(distance * 10) / 10,
            walkMinutes: Math.round((distance / 4.5) * 60),
            driveMinutes: Math.max(5, Math.round(distance / 0.55)),
          };
    return {
      id: row.public_id,
      slug: row.slug,
      name: row.name,
      location: `${row.region}, ${row.country_code === "PT" ? "Portugal" : row.country_code}`,
      image: row.cover_photo_url,
      description: row.description,
      decision: row.decision_text,
      match: Number(row.match_score ?? row.raw?.matchScore ?? 0),
      drive: row.slug === "praia-da-coelha" ? "28 min" : "35 min",
      distance: row.slug === "praia-da-coelha" ? "18 km" : "29 km",
      seaTemp: row.sea_temp_c == null ? "—" : `${Number(row.sea_temp_c)}°C`,
      waves: row.wave_height_m == null ? "—" : `${Number(row.wave_height_m)} m`,
      uv: uvValue == null ? "—" : `${uvValue} ${uvLabel}`,
      crowd: Number(row.crowd_percent ?? 0),
      waterQuality:
        row.water_quality == null
          ? "Unknown"
          : `${row.water_quality.charAt(0).toUpperCase()}${row.water_quality.slice(1)}`,
      goldenHour: `${time(row.golden_hour_start)}–${time(row.golden_hour_end)}`,
      goldenHourDetail: {
        sunrise: time(row.sunrise),
        sunset: time(row.sunset),
        blueHourMorning: row.blue_hour_morning ?? "—",
        blueHourEvening: row.blue_hour_evening ?? "—",
        direction: row.golden_hour_direction ?? "—",
        lightScore: row.light_score == null ? null : Number(row.light_score),
      },
      airTemp:
        row.air_temp_c == null
          ? row.raw?.weather?.airTempC == null
            ? null
            : `${Number(row.raw.weather.airTempC)}°C`
          : `${Math.round(Number(row.air_temp_c))}°C`,
      windSpeed:
        row.wind_speed_kmh == null
          ? row.raw?.weather?.windSpeedKmh == null
            ? null
            : `${Number(row.raw.weather.windSpeedKmh)} km/h`
          : `${Math.round(Number(row.wind_speed_kmh))} km/h`,
      cloudCover:
        row.cloud_cover_percent == null
          ? null
          : `${Math.round(Number(row.cloud_cover_percent))}%`,
      wavePeriod:
        row.raw?.marine?.wavePeriodSeconds == null
          ? null
          : `${Number(row.raw.marine.wavePeriodSeconds)} s`,
      seaLevel:
        row.raw?.marine?.seaLevelHeightMsl == null
          ? null
          : `${Number(row.raw.marine.seaLevelHeightMsl)} m`,
      vibes: vibeVotes.map((vote) => vote.tag),
      vibeVotes,
      amenityDetails,
      amenities: amenityDetails.map((amenity) => amenity.name),
      activities: row.activities ?? [],
      allowsNudism: Boolean(row.allows_nudism),
      latitude: row.latitude,
      longitude: row.longitude,
      photos,
      hazards,
      tide: { points: tidePoints, source: "tide_provider_demo" },
      crowdForecast,
      suitability: row.suitability,
      available: {
        sunbeds: row.sunbeds,
        umbrellas: row.umbrellas,
        clubs: Number.isNaN(clubsFromLabel) ? row.clubs : clubsFromLabel,
      },
      ...(travel ? { travel } : {}),
      provenance: {
        source: row.source,
        observedAt: row.observed_at,
        receivedAt: row.received_at,
        spotterVerified: row.has_spotter,
        blueFlag: row.blue_flag,
        refreshedAt: row.raw?.refreshedAt ?? row.received_at,
      },
    };
  });
}
