import "dotenv/config";
import { pool, withTransaction } from "../db";

const userPublicId = "00000000-0000-7000-8000-000000000001";

const tidePoints = [
  ["05:02", 0.4],
  ["08:00", 0.8],
  ["11:18", 1.4],
  ["14:00", 0.7],
  ["17:24", 0.5],
  ["20:00", 0.8],
  ["23:31", 1.3],
] as const;

const forecastHours = [8, 11, 14, 17, 20] as const;

const photoSet = [
  ["Morning", "Calm water before the crowds"],
  ["Midday", "Peak sun and the busiest shore"],
  ["Golden hour", "Warm west-facing light"],
  ["Blue hour", "Soft light after sunset"],
] as const;

type SeedBeach = {
  publicId: string;
  slug: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  decision: string;
  description: string;
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
  hazards: Array<{ severity: string; title: string; detail: string }>;
  suitability: Record<string, [string, number | null]>;
  amenities: string[];
  inventory: { sunbeds: number; umbrellas: number };
};

const seedBeaches: SeedBeach[] = [
  {
    publicId: "10000000-0000-7000-8000-000000000001",
    slug: "praia-da-coelha",
    name: "Praia da Coelha",
    region: "Algarve",
    lat: 37.073841,
    lng: -8.274119,
    decision: "A strong beach day after 10:30",
    description:
      "A compact golden-cliff cove with calm water and two nearby beach clubs.",
    match: 94,
    seaTemp: 19,
    waves: 0.4,
    uv: 6,
    crowd: 35,
    waterQuality: "good",
    blueFlag: true,
    spotter: true,
    lightScore: 82,
    goldenDirection: "West-facing cliffs",
    vibes: ["Quiet", "White sand", "Calm water", "Scenic"],
    hazards: [
      {
        severity: "advisory",
        title: "Low-tide rocks at the east end",
        detail:
          "Submerged rocks appear below 0.6 m tide. Swim toward the centre of the cove.",
      },
    ],
    suitability: {
      families: ["Excellent", 3],
      solo: ["Good", 2],
      couples: ["Excellent", 3],
      party: ["Quiet today", 1],
      clubs: ["2 open", null],
    },
    amenities: ["Lifeguard", "Parking", "Restrooms", "Food", "Sandy entry"],
    inventory: { sunbeds: 18, umbrellas: 9 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000002",
    slug: "praia-do-camilo",
    name: "Praia do Camilo",
    region: "Lagos",
    lat: 37.087493,
    lng: -8.669134,
    decision: "Best for couples before the stairs get busy",
    description: "A small stair-access cove with dramatic rock formations.",
    match: 88,
    seaTemp: 18,
    waves: 0.5,
    uv: 6,
    crowd: 52,
    waterQuality: "good",
    blueFlag: false,
    spotter: false,
    lightScore: 79,
    goldenDirection: "South-west exposure",
    vibes: ["Romantic", "Scenic", "Small cove"],
    hazards: [
      {
        severity: "warning",
        title: "Steep staircase access",
        detail:
          "A long wooden staircase descends to the beach. Not suitable for strollers or limited mobility.",
      },
    ],
    suitability: {
      families: ["Fair", 1],
      solo: ["Good", 2],
      couples: ["Excellent", 3],
      party: ["Not suited", 0],
      clubs: ["None", null],
    },
    amenities: ["Parking", "Restrooms", "Sandy entry"],
    inventory: { sunbeds: 0, umbrellas: 0 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000003",
    slug: "praia-da-marinha",
    name: "Praia da Marinha",
    region: "Lagoa",
    lat: 37.090891,
    lng: -8.412762,
    decision: "The clearest water nearby, with a busier shore",
    description:
      "An iconic Algarve beach for swimming, snorkeling and photography.",
    match: 84,
    seaTemp: 19,
    waves: 0.6,
    uv: 7,
    crowd: 67,
    waterQuality: "excellent",
    blueFlag: true,
    spotter: true,
    lightScore: 84,
    goldenDirection: "South-facing arches",
    vibes: ["Iconic", "Snorkeling", "Photography"],
    hazards: [
      {
        severity: "advisory",
        title: "Currents near the east arch",
        detail:
          "A lateral current runs along the eastern rock arch on a falling tide. Stay inside the buoyed swim zone.",
      },
    ],
    suitability: {
      families: ["Good", 2],
      solo: ["Good", 2],
      couples: ["Excellent", 3],
      party: ["Social", 2],
      clubs: ["1 open", null],
    },
    amenities: ["Lifeguard", "Parking", "Food", "Snorkeling"],
    inventory: { sunbeds: 8, umbrellas: 4 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000004",
    slug: "meia-praia",
    name: "Meia Praia",
    region: "Lagos",
    lat: 37.117842,
    lng: -8.635332,
    decision: "Best family space and easiest access today",
    description:
      "A long open beach with accessible facilities and abundant inventory.",
    match: 81,
    seaTemp: 18,
    waves: 0.7,
    uv: 6,
    crowd: 43,
    waterQuality: "good",
    blueFlag: true,
    spotter: false,
    lightScore: 76,
    goldenDirection: "South-west open bay",
    vibes: ["Family", "Long walks", "Accessible"],
    hazards: [],
    suitability: {
      families: ["Excellent", 3],
      solo: ["Good", 2],
      couples: ["Good", 2],
      party: ["Lively later", 2],
      clubs: ["4 open", null],
    },
    amenities: [
      "Lifeguard",
      "Accessible",
      "Pet-friendly",
      "Parking",
      "Restrooms",
      "Food",
    ],
    inventory: { sunbeds: 42, umbrellas: 21 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000005",
    slug: "praia-do-carvalho",
    name: "Praia do Carvalho",
    region: "Lagoa",
    lat: 37.086338,
    lng: -8.431895,
    decision: "Quiet and dramatic, but less practical for families",
    description: "A hidden cliff cove reached through a rock tunnel.",
    match: 77,
    seaTemp: 19,
    waves: 0.5,
    uv: 6,
    crowd: 29,
    waterQuality: "good",
    blueFlag: false,
    spotter: false,
    lightScore: 80,
    goldenDirection: "East-facing cove",
    vibes: ["Hidden gem", "Quiet", "Cliff cove"],
    hazards: [
      {
        severity: "warning",
        title: "Tunnel access flooded at high tide",
        detail:
          "The hand-carved tunnel to the beach becomes waist-deep above 1.2 m tide. Time your visit around low tide.",
      },
    ],
    suitability: {
      families: ["Fair", 1],
      solo: ["Excellent", 3],
      couples: ["Excellent", 3],
      party: ["Quiet", 0],
      clubs: ["None", null],
    },
    amenities: ["Parking", "Sandy entry"],
    inventory: { sunbeds: 0, umbrellas: 0 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000006",
    slug: "praia-da-rocha",
    name: "Praia da Rocha",
    region: "Portimão",
    lat: 37.117577,
    lng: -8.536623,
    decision: "Best for beach clubs and a social afternoon",
    description:
      "A broad urban beach with high inventory and a strong social scene.",
    match: 73,
    seaTemp: 19,
    waves: 0.8,
    uv: 7,
    crowd: 76,
    waterQuality: "good",
    blueFlag: true,
    spotter: false,
    lightScore: 74,
    goldenDirection: "South-facing broad bay",
    vibes: ["Party", "Beach clubs", "Social"],
    hazards: [
      {
        severity: "advisory",
        title: "High crowd density after 14:00",
        detail:
          "Crowd forecasts exceed 85% through late afternoon. Reserve sunbeds ahead or arrive before 11:00.",
      },
    ],
    suitability: {
      families: ["Good", 2],
      solo: ["Excellent", 3],
      couples: ["Good", 2],
      party: ["Excellent", 3],
      clubs: ["7 open", null],
    },
    amenities: [
      "Lifeguard",
      "Pet-friendly",
      "Parking",
      "Restrooms",
      "Food",
      "Nightlife",
    ],
    inventory: { sunbeds: 68, umbrellas: 34 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000007",
    slug: "praia-da-falesia",
    name: "Praia da Falésia",
    region: "Albufeira",
    lat: 37.089,
    lng: -8.184,
    decision: "Long sandy stretch backed by dramatic red cliffs",
    description:
      "A six-kilometre beach with golden sand and towering ochre cliffs.",
    match: 79,
    seaTemp: 19,
    waves: 0.6,
    uv: 7,
    crowd: 48,
    waterQuality: "excellent",
    blueFlag: true,
    spotter: false,
    lightScore: 78,
    goldenDirection: "South-facing cliffs",
    vibes: ["Long walks", "Scenic", "Family"],
    hazards: [],
    suitability: {
      families: ["Excellent", 3],
      solo: ["Good", 2],
      couples: ["Good", 2],
      party: ["Fair", 1],
      clubs: ["1 open", null],
    },
    amenities: ["Lifeguard", "Accessible", "Parking", "Restrooms", "Food"],
    inventory: { sunbeds: 30, umbrellas: 15 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000008",
    slug: "praia-do-vau",
    name: "Praia do Vau",
    region: "Portimão",
    lat: 37.123,
    lng: -8.548,
    decision: "Sheltered cove, calm and family-friendly",
    description:
      "A sheltered cove between Praia da Rocha and Alvor, great for kids.",
    match: 76,
    seaTemp: 19,
    waves: 0.4,
    uv: 6,
    crowd: 44,
    waterQuality: "good",
    blueFlag: true,
    spotter: false,
    lightScore: 77,
    goldenDirection: "West-facing cove",
    vibes: ["Family", "Calm water", "Accessible"],
    hazards: [],
    suitability: {
      families: ["Excellent", 3],
      solo: ["Good", 2],
      couples: ["Good", 2],
      party: ["Not suited", 0],
      clubs: ["None", null],
    },
    amenities: ["Lifeguard", "Accessible", "Parking", "Restrooms", "Food"],
    inventory: { sunbeds: 22, umbrellas: 11 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000009",
    slug: "praia-da-batata",
    name: "Praia da Batata",
    region: "Lagos",
    lat: 37.103,
    lng: -8.671,
    decision: "Town beach with a lively social scene",
    description:
      "Lagos' closest town beach, popular with younger crowds and surf schools.",
    match: 72,
    seaTemp: 18,
    waves: 0.7,
    uv: 7,
    crowd: 65,
    waterQuality: "good",
    blueFlag: false,
    spotter: false,
    lightScore: 75,
    goldenDirection: "South-west open bay",
    vibes: ["Social", "Surf school", "Town"],
    hazards: [
      {
        severity: "advisory",
        title: "Occasional shore break",
        detail:
          "Small waves can dump on the sandbar at low tide. Swim near the lifeguard tower.",
      },
    ],
    suitability: {
      families: ["Good", 2],
      solo: ["Good", 2],
      couples: ["Good", 2],
      party: ["Social", 2],
      clubs: ["2 open", null],
    },
    amenities: ["Lifeguard", "Parking", "Restrooms", "Food", "Surf school"],
    inventory: { sunbeds: 16, umbrellas: 8 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000010",
    slug: "ilha-deserta-barreta",
    name: "Ilha Deserta (Barreta)",
    region: "Faro",
    lat: 36.967,
    lng: -7.963,
    decision: "Wild, clothing-optional island escape",
    description:
      "A pristine barrier island reachable by boat; the eastern end is clothing-optional.",
    match: 70,
    seaTemp: 19,
    waves: 0.5,
    uv: 7,
    crowd: 18,
    waterQuality: "excellent",
    blueFlag: false,
    spotter: false,
    lightScore: 81,
    goldenDirection: "South-facing island",
    vibes: ["Hidden gem", "Wild", "Clothing-optional"],
    hazards: [
      {
        severity: "advisory",
        title: "No lifeguard on the eastern end",
        detail:
          "The clothing-optional stretch has no lifeguard. Swim where others are present.",
      },
    ],
    suitability: {
      families: ["Fair", 1],
      solo: ["Excellent", 3],
      couples: ["Excellent", 3],
      party: ["Quiet", 0],
      clubs: ["None", null],
    },
    amenities: ["Parking", "Boat access"],
    inventory: { sunbeds: 0, umbrellas: 0 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000011",
    slug: "praia-do-castelo",
    name: "Praia do Castelo",
    region: "Albufeira",
    lat: 37.027,
    lng: -8.272,
    decision: "Dramatic rock formations and a quiet shore",
    description: "A scenic cove beneath a clifftop castle viewpoint.",
    match: 68,
    seaTemp: 19,
    waves: 0.5,
    uv: 6,
    crowd: 33,
    waterQuality: "good",
    blueFlag: true,
    spotter: false,
    lightScore: 80,
    goldenDirection: "South-facing cove",
    vibes: ["Scenic", "Quiet", "Photography"],
    hazards: [],
    suitability: {
      families: ["Fair", 1],
      solo: ["Good", 2],
      couples: ["Excellent", 3],
      party: ["Quiet", 0],
      clubs: ["None", null],
    },
    amenities: ["Lifeguard", "Parking", "Restrooms", "Food"],
    inventory: { sunbeds: 10, umbrellas: 5 },
  },
  {
    publicId: "10000000-0000-7000-8000-000000000012",
    slug: "praia-da-benagil",
    name: "Praia de Benagil",
    region: "Lagoa",
    lat: 37.087,
    lng: -8.428,
    decision: "Gateway to the famous Benagil sea cave",
    description:
      "A small fishing beach and the departure point for the Benagil cave tours.",
    match: 66,
    seaTemp: 19,
    waves: 0.6,
    uv: 7,
    crowd: 58,
    waterQuality: "good",
    blueFlag: false,
    spotter: true,
    lightScore: 79,
    goldenDirection: "South-facing cove",
    vibes: ["Iconic", "Sea cave", "Boat tours"],
    hazards: [
      {
        severity: "warning",
        title: "Sea cave tours only with a guide",
        detail:
          "Swimming into the Benagil cave is dangerous due to swell and boat traffic. Take a licensed boat or kayak tour.",
      },
    ],
    suitability: {
      families: ["Good", 2],
      solo: ["Good", 2],
      couples: ["Excellent", 3],
      party: ["Social", 2],
      clubs: ["1 open", null],
    },
    amenities: ["Lifeguard", "Parking", "Food", "Boat tours"],
    inventory: { sunbeds: 12, umbrellas: 6 },
  },
];

async function seed() {
  await withTransaction(async (client) => {
    const user = await client.query<{ id: number }>(
      `insert into app_user(public_id, email, display_name, locale, timezone, is_premium)
       values ($1, 'maya@sunscout.local', 'Maya', 'en-PT', 'Europe/Lisbon', false)
       on conflict (public_id) do update set updated_at = now()
       returning id`,
      [userPublicId],
    );
    const userId = user.rows[0].id;

    const badges = [
      [
        "first_dip",
        "First Dip",
        "Check in at a beach for the first time.",
        { kind: "check_in", count: 1 },
        "drop",
      ],
      [
        "beach_hopper",
        "Beach Hopper",
        "Check in at three different beaches.",
        { kind: "check_in", distinctBeaches: 3 },
        "compass",
      ],
      [
        "golden_eye",
        "Golden Eye",
        "Save a Golden Hour alert.",
        { kind: "golden_hour_alert" },
        "sun",
      ],
      [
        "booked_in",
        "Booked In",
        "Complete your first reservation.",
        { kind: "booking", count: 1 },
        "ticket",
      ],
    ] as const;
    for (const [slug, name, description, criteria, icon] of badges) {
      await client.query(
        `insert into badge(slug, name, description, criteria, icon)
         values ($1, $2, $3, $4, $5)
         on conflict (slug) do update set
           name = excluded.name,
           description = excluded.description,
           criteria = excluded.criteria,
           icon = excluded.icon`,
        [slug, name, description, JSON.stringify(criteria), icon],
      );
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    const lisbonToday = new Date();
    const lisbonIso = (h: number, m: number) =>
      `${lisbonToday.getUTCFullYear()}-${pad(lisbonToday.getUTCMonth() + 1)}-${pad(lisbonToday.getUTCDate())}T${pad(h)}:${pad(m)}:00+01:00`;
    const goldenStart = lisbonIso(19, 42);
    const goldenEnd = lisbonIso(20, 24);
    const sunrise = lisbonIso(6, 12);
    const sunset = lisbonIso(20, 24);

    const activitiesBySlug: Record<string, string[]> = {
      "praia-da-coelha": ["snorkeling", "beach_park", "chill"],
      "praia-do-camilo": ["snorkeling", "chill", "photography"],
      "praia-da-marinha": ["snorkeling", "water_sports", "photography"],
      "meia-praia": ["beach_park", "water_sports", "walking", "accessible"],
      "praia-do-carvalho": ["chill", "hidden", "nudist"],
      "praia-da-rocha": ["beach_club", "water_sports", "nightlife"],
      "praia-da-falesia": ["walking", "beach_park", "chill"],
      "praia-do-vau": ["beach_park", "water_sports", "accessible"],
      "praia-da-batata": ["beach_club", "water_sports", "nightlife"],
      "ilha-deserta-barreta": ["chill", "hidden", "nudist", "walking"],
      "praia-do-castelo": ["chill", "photography", "hidden"],
      "praia-da-benagil": ["water_sports", "photography", "hidden"],
    };
    const nudistBySlug: Record<string, boolean> = {
      "praia-do-carvalho": true,
      "praia-do-camilo": true,
      "ilha-deserta-barreta": true,
    };
    const weatherBySlug: Record<
      string,
      { airTemp: number; wind: number; cloud: number }
    > = {
      "praia-da-coelha": { airTemp: 24, wind: 12, cloud: 18 },
      "praia-do-camilo": { airTemp: 23, wind: 16, cloud: 25 },
      "praia-da-marinha": { airTemp: 24, wind: 14, cloud: 10 },
      "meia-praia": { airTemp: 23, wind: 18, cloud: 30 },
      "praia-do-carvalho": { airTemp: 24, wind: 10, cloud: 15 },
      "praia-da-rocha": { airTemp: 25, wind: 20, cloud: 35 },
      "praia-da-falesia": { airTemp: 24, wind: 16, cloud: 22 },
      "praia-do-vau": { airTemp: 23, wind: 12, cloud: 18 },
      "praia-da-batata": { airTemp: 24, wind: 18, cloud: 28 },
      "ilha-deserta-barreta": { airTemp: 25, wind: 22, cloud: 12 },
      "praia-do-castelo": { airTemp: 24, wind: 14, cloud: 16 },
      "praia-da-benagil": { airTemp: 24, wind: 15, cloud: 14 },
    };
    const demoFriends: Array<[string, string]> = [
      ["Sofia", "friend"],
      ["Liam", "friend"],
      ["Ana (kid)", "kid"],
    ];

    for (const beach of seedBeaches) {
      const beachResult = await client.query<{ id: number }>(
        `insert into beach(
          public_id, slug, name, country_code, region, latitude, longitude,
          timezone, description, decision_text, cover_photo_url, beach_type,
          has_spotter, blue_flag, match_score
        )
        values ($1, $2, $3, 'PT', $4, $5, $6, 'Europe/Lisbon', $7, $8,
          '/assets/beaches/' || $2 || '.svg', 'sandy', $9, $10, $11)
        on conflict (public_id) do update set
          name = excluded.name,
          region = excluded.region,
          description = excluded.description,
          decision_text = excluded.decision_text,
          has_spotter = excluded.has_spotter,
          blue_flag = excluded.blue_flag,
          match_score = excluded.match_score,
          cover_photo_url = excluded.cover_photo_url,
          updated_at = now()
        returning id`,
        [
          beach.publicId,
          beach.slug,
          beach.name,
          beach.region,
          beach.lat,
          beach.lng,
          beach.description,
          beach.decision,
          beach.spotter,
          beach.blueFlag,
          beach.match,
        ],
      );
      const beachId = beachResult.rows[0].id;

      await client.query(`update beach set allows_nudism = $2 where id = $1`, [
        beachId,
        nudistBySlug[beach.slug] ?? false,
      ]);
      await client.query("delete from beach_activity where beach_id = $1", [
        beachId,
      ]);
      for (const activity of activitiesBySlug[beach.slug] ?? []) {
        await client.query(
          `insert into beach_activity(beach_id, activity) values ($1, $2)
           on conflict do nothing`,
          [beachId, activity],
        );
      }

      await client.query("delete from beach_condition where beach_id = $1", [
        beachId,
      ]);
      const weather = weatherBySlug[beach.slug] ?? {
        airTemp: 24,
        wind: 14,
        cloud: 20,
      };
      await client.query(
        `insert into beach_condition(
          beach_id, observed_at, source, sea_temp_c, wave_height_m, uv_index,
          crowd_percent, water_quality, golden_hour_start, golden_hour_end,
          sunrise, sunset, blue_hour_morning, blue_hour_evening,
          golden_hour_direction, light_score, air_temp_c, wind_speed_kmh,
          cloud_cover_percent, raw
        )
        values (
          $1, now() - interval '6 minutes', $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
          jsonb_build_object('matchScore', $19::int)
        )`,
        [
          beachId,
          beach.spotter ? "sofar_demo" : "provider_demo",
          beach.seaTemp,
          beach.waves,
          beach.uv,
          beach.crowd,
          beach.waterQuality,
          goldenStart,
          goldenEnd,
          sunrise,
          sunset,
          "05:42–06:09",
          "20:27–20:54",
          beach.goldenDirection,
          beach.lightScore,
          weather.airTemp,
          weather.wind,
          weather.cloud,
          beach.match,
        ],
      );

      const familyAge: Record<string, [number, number]> = {
        "praia-da-coelha": [0, 12],
        "praia-do-camilo": [8, 99],
        "praia-da-marinha": [5, 99],
        "meia-praia": [0, 99],
        "praia-do-carvalho": [10, 99],
        "praia-da-rocha": [8, 99],
        "praia-da-falesia": [0, 99],
        "praia-do-vau": [0, 12],
        "praia-da-batata": [8, 99],
        "ilha-deserta-barreta": [16, 99],
        "praia-do-castelo": [5, 99],
        "praia-da-benagil": [5, 99],
      };
      for (const [audience, [label, score]] of Object.entries(
        beach.suitability,
      )) {
        const [ageMin, ageMax] =
          audience === "families"
            ? (familyAge[beach.slug] ?? [0, 99])
            : [null, null];
        await client.query(
          `insert into beach_suitability(beach_id, audience, label, score, age_min, age_max)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (beach_id, audience) do update
             set label = excluded.label, score = excluded.score,
               age_min = excluded.age_min, age_max = excluded.age_max,
               updated_at = now()`,
          [beachId, audience, label, score, ageMin, ageMax],
        );
      }

      await client.query("delete from beach_amenity where beach_id = $1", [
        beachId,
      ]);
      for (const amenity of beach.amenities) {
        await client.query(
          `insert into beach_amenity(beach_id, amenity, verified_at, source)
           values ($1, $2, now() - interval '2 days', 'blue_flag_demo')`,
          [beachId, amenity],
        );
      }

      await client.query("delete from vibe_tag where beach_id = $1", [beachId]);
      for (const tag of beach.vibes) {
        await client.query(
          `insert into vibe_tag(beach_id, tag) values ($1, $2)
           on conflict (beach_id, tag) do nothing`,
          [beachId, tag],
        );
      }

      await client.query("delete from beach_photo where beach_id = $1", [
        beachId,
      ]);
      let photoPosition = 0;
      for (const [timeOfDay, caption] of photoSet) {
        await client.query(
          `insert into beach_photo(beach_id, photo_url, time_of_day, caption, position)
           values ($1, $5, $2, $3, $4)`,
          [
            beachId,
            timeOfDay,
            caption,
            photoPosition++,
            `/assets/beaches/${beach.slug}-${({ Morning: "morning", Midday: "midday", "Golden hour": "golden", "Blue hour": "blue" } as Record<string, string>)[timeOfDay]}.svg`,
          ],
        );
      }

      await client.query("delete from hazard_alert where beach_id = $1", [
        beachId,
      ]);
      for (const hazard of beach.hazards) {
        await client.query(
          `insert into hazard_alert(beach_id, severity, title, detail, source)
           values ($1, $2, $3, $4, 'lifeguard')`,
          [beachId, hazard.severity, hazard.title, hazard.detail],
        );
      }

      await client.query(
        `delete from beach_tide_reading where beach_id = $1 and day = current_date`,
        [beachId],
      );
      for (const [label, height] of tidePoints) {
        await client.query(
          `insert into beach_tide_reading(beach_id, day, time_label, height_m)
           values ($1, current_date, $2, $3)
           on conflict (beach_id, day, time_label) do nothing`,
          [beachId, label, height],
        );
      }

      await client.query("delete from crowd_forecast where beach_id = $1", [
        beachId,
      ]);
      const baseline = beach.crowd;
      const factors: Record<number, number> = {
        8: 0.55,
        11: 0.9,
        14: 1.15,
        17: 1.1,
        20: 0.7,
      };
      for (const hour of forecastHours) {
        const value = Math.min(
          100,
          Math.round(baseline * (factors[hour] ?? 1)),
        );
        await client.query(
          `insert into crowd_forecast(beach_id, hour, crowd_percent)
           values ($1, $2, $3)
           on conflict (beach_id, hour) do update
             set crowd_percent = excluded.crowd_percent, updated_at = now()`,
          [beachId, hour, value],
        );
      }

      await client.query(
        `delete from vibe_vote where beach_id = $1 and user_id = $2`,
        [beachId, userId],
      );
      if (beach.vibes[0]) {
        await client.query(
          `insert into vibe_vote(beach_id, tag, user_id) values ($1, $2, $3)
           on conflict (beach_id, tag, user_id) do nothing`,
          [beachId, beach.vibes[0], userId],
        );
      }

      if (beach.inventory.sunbeds > 0 || beach.inventory.umbrellas > 0) {
        const merchantPublicId = beach.publicId.replace(/^1/, "2");
        const merchant = await client.query<{ id: number }>(
          `insert into merchant(
            public_id, owner_user_id, beach_id, business_name, kyc_status
           )
           values ($1, $2, $3, $4, 'verified')
           on conflict (public_id) do update set beach_id = excluded.beach_id
           returning id`,
          [merchantPublicId, userId, beachId, `${beach.name} Beach Club`],
        );

        const inventory: Array<
          [string, number, number, number, string | null, string | null]
        > = [
          [
            "sunbed",
            beach.inventory.sunbeds + 12,
            beach.inventory.sunbeds,
            1200,
            null,
            null,
          ],
          [
            "umbrella",
            beach.inventory.umbrellas + 7,
            beach.inventory.umbrellas,
            800,
            null,
            null,
          ],
        ];
        if (beach.slug === "praia-da-rocha") {
          inventory.push([
            "activity",
            6,
            4,
            4500,
            "Coastal kayak tour",
            "90-minute guided paddle along the cliffs. Wetsuit and board included.",
          ]);
        }
        if (beach.slug === "praia-da-marinha") {
          inventory.push([
            "activity",
            4,
            3,
            3500,
            "Snorkel bundle",
            "Mask, fins and a guided snorkel to the east arch.",
          ]);
        }
        for (const [
          type,
          total,
          available,
          price,
          label,
          description,
        ] of inventory) {
          await client.query(
            `insert into amenity_inventory(
              merchant_id, amenity_type, total_count, available_count, price_cents, label, description
             )
             values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (merchant_id, amenity_type) do update set
               total_count = excluded.total_count,
               available_count = excluded.available_count,
               price_cents = excluded.price_cents,
               label = excluded.label,
               description = excluded.description,
               version = amenity_inventory.version + 1,
               updated_at = now()`,
            [
              merchant.rows[0].id,
              type,
              total,
              available,
              price,
              label,
              description,
            ],
          );
        }
      }
    }

    for (const [name, relationship] of demoFriends) {
      await client.query(
        `insert into friend(user_id, name, relationship)
         values ($1, $2, $3)
         on conflict do nothing`,
        [userId, name, relationship],
      );
    }

    const institution = await client.query<{ id: number; public_id: string }>(
      `insert into institution(public_id, name, slug, region)
       values ('30000000-0000-7000-8000-000000000001', 'Algarve Tourism Board', 'algarve-tourism', 'Algarve')
       on conflict (slug) do update set name = excluded.name, region = excluded.region
       returning id, public_id`,
      [],
    );
    const institutionId = institution.rows[0].id;
    await client.query(
      `insert into institution_member(institution_id, user_id, role)
       values ($1, $2, 'admin')
       on conflict (institution_id, user_id) do update set role = excluded.role`,
      [institutionId, userId],
    );
    await client.query(
      `insert into institution_contract(public_id, institution_id, status, starts_on, ends_on, annual_quota_exports)
       values ('31000000-0000-7000-8000-000000000001', $1, 'active', current_date, date '2027-12-31', 10000)
       on conflict (public_id) do update set status = excluded.status, ends_on = excluded.ends_on`,
      [institutionId],
    );
    const allBeaches = await client.query<{ id: number }>(
      "select id from beach order by id",
    );
    for (const row of allBeaches.rows) {
      await client.query(
        `insert into institution_beach(institution_id, beach_id)
         values ($1, $2) on conflict do nothing`,
        [institutionId, row.id],
      );
    }
    await client.query(
      `insert into embed_token(public_id, token, institution_id, label)
       values ('32000000-0000-7000-8000-000000000001', 'algarve-public-status-2026', $1, 'Public status board')
       on conflict (token) do update set label = excluded.label`,
      [institutionId],
    );

    const marinhaId = (
      await client.query<{ id: number }>(
        "select id from beach where slug = 'praia-da-marinha'",
      )
    ).rows[0].id;
    await client.query(
      `insert into spotter_campaign(public_id, beach_id, goal_cents, raised_cents, status)
       values ('33000000-0000-7000-8000-000000000001', $1, 500000, 185000, 'open')
       on conflict (beach_id) do update set goal_cents = excluded.goal_cents,
         raised_cents = excluded.raised_cents, status = excluded.status`,
      [marinhaId],
    );

    // Journal entries + ratings for the demo user
    const coelhaId = (
      await client.query<{ id: number }>(
        "select id from beach where slug = 'praia-da-coelha'",
      )
    ).rows[0].id;
    const marinhaId2 = (
      await client.query<{ id: number }>(
        "select id from beach where slug = 'praia-da-marinha'",
      )
    ).rows[0].id;
    const rochaId = (
      await client.query<{ id: number }>(
        "select id from beach where slug = 'praia-da-rocha'",
      )
    ).rows[0].id;
    const journalSeeds: Array<[number, string, string]> = [
      [
        coelhaId,
        "relaxed",
        "Perfect morning with the family. Calm water, arrived early.",
      ],
      [
        marinhaId2,
        "adventurous",
        "Snorkeled the east arch. Water was crystal clear.",
      ],
      [
        rochaId,
        "social",
        "Beach club day with friends. Great vibe in the afternoon.",
      ],
    ];
    for (const [beachId, mood, notes] of journalSeeds) {
      await client.query(
        `insert into beach_journal_entry(user_id, beach_id, mood, notes, conditions_snapshot, visited_at)
         values ($1, $2, $3, $4, $5, now() - interval '1 day' - random() * interval '7 days')
         on conflict do nothing`,
        [
          userId,
          beachId,
          mood,
          notes,
          JSON.stringify({ seaTemp: 19, crowd: 40, waterQuality: "good" }),
        ],
      );
    }
    for (const [beachId, stars] of [
      [coelhaId, 5],
      [marinhaId2, 5],
      [rochaId, 4],
    ] as [number, number][]) {
      await client.query(
        `insert into beach_rating(user_id, beach_id, stars) values ($1, $2, $3)
         on conflict (user_id, beach_id) do update set stars = excluded.stars`,
        [userId, beachId, stars],
      );
    }
  });
}

seed()
  .then(() => {
    console.log("Seeded SunScout development data");
    return pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
