import type {
  BeachLocation,
  ConditionReading,
  ConditionsProvider,
} from "./types";

type WeatherResponse = {
  utc_offset_seconds: number;
  current: {
    time: number;
    temperature_2m: number | null;
    apparent_temperature: number | null;
    relative_humidity_2m: number | null;
    weather_code: number | null;
    cloud_cover: number | null;
    wind_speed_10m: number | null;
    wind_direction_10m: number | null;
    uv_index: number | null;
  };
  daily: {
    sunrise: number[];
    sunset: number[];
    uv_index_max: Array<number | null>;
  };
};

type MarineResponse = {
  utc_offset_seconds: number;
  current: {
    time: number;
    wave_height: number | null;
    wave_direction: number | null;
    wave_period: number | null;
    sea_surface_temperature: number | null;
    sea_level_height_msl: number | null;
  };
  hourly: {
    time: number[];
    sea_level_height_msl: Array<number | null>;
  };
};

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { "user-agent": "SunScout/0.1 conditions adapter" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`open_meteo_${response.status}`);
  }
  return response.json() as Promise<T>;
}

function unixSeconds(value: number | undefined) {
  return value == null ? null : new Date(value * 1_000);
}

export const openMeteoProvider: ConditionsProvider = {
  name: "open_meteo",

  async fetchCurrent(location: BeachLocation): Promise<ConditionReading> {
    const common = {
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      timezone: location.timezone,
      forecast_days: "2",
      timeformat: "unixtime",
    };

    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    const marineUrl = new URL("https://marine-api.open-meteo.com/v1/marine");
    for (const [key, value] of Object.entries(common)) {
      weatherUrl.searchParams.set(key, value);
      marineUrl.searchParams.set(key, value);
    }
    weatherUrl.searchParams.set(
      "current",
      [
        "temperature_2m",
        "apparent_temperature",
        "relative_humidity_2m",
        "weather_code",
        "cloud_cover",
        "wind_speed_10m",
        "wind_direction_10m",
        "uv_index",
      ].join(","),
    );
    weatherUrl.searchParams.set("daily", "sunrise,sunset,uv_index_max");
    marineUrl.searchParams.set(
      "current",
      [
        "wave_height",
        "wave_direction",
        "wave_period",
        "sea_surface_temperature",
        "sea_level_height_msl",
      ].join(","),
    );
    marineUrl.searchParams.set("hourly", "sea_level_height_msl");

    const [weather, marine] = await Promise.all([
      fetchJson<WeatherResponse>(weatherUrl),
      fetchJson<MarineResponse>(marineUrl),
    ]);

    const sunset = unixSeconds(weather.daily.sunset[0]);
    const goldenHourStart = sunset
      ? new Date(sunset.getTime() - 45 * 60 * 1_000)
      : null;
    const observedAt = new Date(
      Math.max(weather.current.time, marine.current.time) * 1_000,
    );

    return {
      observedAt,
      source: "open_meteo_weather+marine",
      seaTempC: marine.current.sea_surface_temperature,
      waveHeightM: marine.current.wave_height,
      uvIndex: weather.current.uv_index,
      goldenHourStart,
      goldenHourEnd: sunset,
      raw: {
        provider: this.name,
        weather: {
          airTempC: weather.current.temperature_2m,
          apparentTempC: weather.current.apparent_temperature,
          humidityPercent: weather.current.relative_humidity_2m,
          weatherCode: weather.current.weather_code,
          windSpeedKmh: weather.current.wind_speed_10m,
          cloudCoverPercent: weather.current.cloud_cover,
          windDirectionDegrees: weather.current.wind_direction_10m,
          uvIndexMax: weather.daily.uv_index_max[0] ?? null,
          sunrise: unixSeconds(weather.daily.sunrise[0])?.toISOString() ?? null,
          sunset: sunset?.toISOString() ?? null,
        },
        marine: {
          waveDirectionDegrees: marine.current.wave_direction,
          wavePeriodSeconds: marine.current.wave_period,
          seaLevelHeightMsl: marine.current.sea_level_height_msl,
          seaLevelForecast: marine.hourly.time
            .slice(0, 24)
            .map((time, index) => ({
              at: new Date(time * 1_000).toISOString(),
              metres: marine.hourly.sea_level_height_msl[index] ?? null,
            })),
        },
      },
    };
  },
};
