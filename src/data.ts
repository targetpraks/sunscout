import type { Beach, HazardAlert } from "./types";

const heroFor = (slug: string) => `/assets/beaches/${slug}.svg`;
const timeMap: Record<string, string> = {
  Morning: "morning",
  Midday: "midday",
  "Golden hour": "golden",
  "Blue hour": "blue",
};

const tidePoints = [
  { time: "05:02", level: 0.4 },
  { time: "08:00", level: 0.8 },
  { time: "11:18", level: 1.4 },
  { time: "14:00", level: 0.7 },
  { time: "17:24", level: 0.5 },
  { time: "20:00", level: 0.8 },
  { time: "23:31", level: 1.3 },
];

const photoSet = [
  { timeOfDay: "Morning", caption: "Calm water before the crowds" },
  { timeOfDay: "Midday", caption: "Peak sun and the busiest shore" },
  { timeOfDay: "Golden hour", caption: "Warm west-facing light" },
  { timeOfDay: "Blue hour", caption: "Soft light after sunset" },
];

const goldenHourDetail = {
  sunrise: "06:12",
  sunset: "20:24",
  blueHourMorning: "05:42–06:09",
  blueHourEvening: "20:27–20:54",
  direction: "West-facing cliffs",
  lightScore: 80,
};

const hazardsBySlug: Record<string, HazardAlert[]> = {
  "praia-da-coelha": [
    {
      id: "coelha-h1",
      severity: "advisory",
      title: "Low-tide rocks at the east end",
      detail:
        "Submerged rocks appear below 0.6 m tide. Swim toward the centre of the cove.",
      at: "2026-06-21",
    },
  ],
  "praia-do-camilo": [
    {
      id: "camilo-h1",
      severity: "warning",
      title: "Steep staircase access",
      detail:
        "A long wooden staircase descends to the beach. Not suitable for strollers or limited mobility.",
      at: "2026-06-21",
    },
  ],
  "praia-da-marinha": [
    {
      id: "marinha-h1",
      severity: "advisory",
      title: "Currents near the east arch",
      detail:
        "A lateral current runs along the eastern rock arch on a falling tide. Stay inside the buoyed swim zone.",
      at: "2026-06-21",
    },
  ],
  "praia-do-carvalho": [
    {
      id: "carvalho-h1",
      severity: "warning",
      title: "Tunnel access flooded at high tide",
      detail:
        "The hand-carved tunnel to the beach becomes waist-deep above 1.2 m tide. Time your visit around low tide.",
      at: "2026-06-21",
    },
  ],
  "praia-da-rocha": [
    {
      id: "rocha-h1",
      severity: "advisory",
      title: "High crowd density after 14:00",
      detail:
        "Crowd forecasts exceed 85% through late afternoon. Reserve sunbeds ahead or arrive before 11:00.",
      at: "2026-06-21",
    },
  ],
};

const baseBeaches: Omit<
  Beach,
  | "image"
  | "goldenHourDetail"
  | "vibeVotes"
  | "amenityDetails"
  | "photos"
  | "hazards"
  | "tide"
  | "crowdForecast"
  | "provenance"
>[] = [
  {
    id: "praia-da-coelha",
    slug: "praia-da-coelha",
    name: "Praia da Coelha",
    location: "Algarve, Portugal",
    decision: "A strong beach day after 10:30",
    match: 94,
    drive: "28 min",
    distance: "18 km",
    seaTemp: "19°C",
    waves: "0.4 m",
    uv: "6 High",
    crowd: 35,
    waterQuality: "Good",
    goldenHour: "19:42–20:24",
    vibes: ["Quiet", "White sand", "Calm water", "Scenic"],
    suitability: [
      { id: "families", label: "Families", value: "Excellent", score: 3 },
      { id: "solo", label: "Solo", value: "Good", score: 2 },
      { id: "couples", label: "Couples", value: "Excellent", score: 3 },
      { id: "party", label: "Party", value: "Quiet today", score: 1 },
      { id: "clubs", label: "Beach clubs", value: "2 open" },
    ],
    amenities: ["Lifeguard", "Parking", "Restrooms", "Food", "Sandy entry"],
    available: { sunbeds: 18, umbrellas: 9, clubs: 2 },
  },
  {
    id: "praia-do-camilo",
    slug: "praia-do-camilo",
    name: "Praia do Camilo",
    location: "Lagos, Portugal",
    decision: "Best for couples before the stairs get busy",
    match: 88,
    drive: "36 min",
    distance: "29 km",
    seaTemp: "18°C",
    waves: "0.5 m",
    uv: "6 High",
    crowd: 52,
    waterQuality: "Good",
    goldenHour: "19:44–20:26",
    vibes: ["Romantic", "Scenic", "Small cove"],
    suitability: [
      { id: "families", label: "Families", value: "Fair", score: 1 },
      { id: "solo", label: "Solo", value: "Good", score: 2 },
      { id: "couples", label: "Couples", value: "Excellent", score: 3 },
      { id: "party", label: "Party", value: "Not suited", score: 0 },
      { id: "clubs", label: "Beach clubs", value: "None" },
    ],
    amenities: ["Parking", "Restrooms", "Sandy entry"],
    available: { sunbeds: 0, umbrellas: 0, clubs: 0 },
  },
  {
    id: "praia-da-marinha",
    slug: "praia-da-marinha",
    name: "Praia da Marinha",
    location: "Lagoa, Portugal",
    decision: "The clearest water nearby, with a busier shore",
    match: 84,
    drive: "31 min",
    distance: "23 km",
    seaTemp: "19°C",
    waves: "0.6 m",
    uv: "7 High",
    crowd: 67,
    waterQuality: "Excellent",
    goldenHour: "19:41–20:23",
    vibes: ["Iconic", "Snorkeling", "Photography"],
    suitability: [
      { id: "families", label: "Families", value: "Good", score: 2 },
      { id: "solo", label: "Solo", value: "Good", score: 2 },
      { id: "couples", label: "Couples", value: "Excellent", score: 3 },
      { id: "party", label: "Party", value: "Social", score: 2 },
      { id: "clubs", label: "Beach clubs", value: "1 open" },
    ],
    amenities: ["Lifeguard", "Parking", "Food", "Snorkeling"],
    available: { sunbeds: 8, umbrellas: 4, clubs: 1 },
  },
  {
    id: "meia-praia",
    slug: "meia-praia",
    name: "Meia Praia",
    location: "Lagos, Portugal",
    decision: "Best family space and easiest access today",
    match: 81,
    drive: "39 min",
    distance: "34 km",
    seaTemp: "18°C",
    waves: "0.7 m",
    uv: "6 High",
    crowd: 43,
    waterQuality: "Good",
    goldenHour: "19:45–20:27",
    vibes: ["Family", "Long walks", "Accessible"],
    suitability: [
      { id: "families", label: "Families", value: "Excellent", score: 3 },
      { id: "solo", label: "Solo", value: "Good", score: 2 },
      { id: "couples", label: "Couples", value: "Good", score: 2 },
      { id: "party", label: "Party", value: "Lively later", score: 2 },
      { id: "clubs", label: "Beach clubs", value: "4 open" },
    ],
    amenities: ["Lifeguard", "Accessible", "Parking", "Restrooms", "Food"],
    available: { sunbeds: 42, umbrellas: 21, clubs: 4 },
  },
  {
    id: "praia-do-carvalho",
    slug: "praia-do-carvalho",
    name: "Praia do Carvalho",
    location: "Lagoa, Portugal",
    decision: "Quiet and dramatic, but less practical for families",
    match: 77,
    drive: "27 min",
    distance: "20 km",
    seaTemp: "19°C",
    waves: "0.5 m",
    uv: "6 High",
    crowd: 29,
    waterQuality: "Good",
    goldenHour: "19:42–20:24",
    vibes: ["Hidden gem", "Quiet", "Cliff cove"],
    suitability: [
      { id: "families", label: "Families", value: "Fair", score: 1 },
      { id: "solo", label: "Solo", value: "Excellent", score: 3 },
      { id: "couples", label: "Couples", value: "Excellent", score: 3 },
      { id: "party", label: "Party", value: "Quiet", score: 0 },
      { id: "clubs", label: "Beach clubs", value: "None" },
    ],
    amenities: ["Parking", "Sandy entry"],
    available: { sunbeds: 0, umbrellas: 0, clubs: 0 },
  },
  {
    id: "praia-da-rocha",
    slug: "praia-da-rocha",
    name: "Praia da Rocha",
    location: "Portimão, Portugal",
    decision: "Best for beach clubs and a social afternoon",
    match: 73,
    drive: "42 min",
    distance: "38 km",
    seaTemp: "19°C",
    waves: "0.8 m",
    uv: "7 High",
    crowd: 76,
    waterQuality: "Good",
    goldenHour: "19:43–20:25",
    vibes: ["Party", "Beach clubs", "Social"],
    suitability: [
      { id: "families", label: "Families", value: "Good", score: 2 },
      { id: "solo", label: "Solo", value: "Excellent", score: 3 },
      { id: "couples", label: "Couples", value: "Good", score: 2 },
      { id: "party", label: "Party", value: "Excellent", score: 3 },
      { id: "clubs", label: "Beach clubs", value: "7 open" },
    ],
    amenities: ["Lifeguard", "Parking", "Restrooms", "Food", "Nightlife"],
    available: { sunbeds: 68, umbrellas: 34, clubs: 7 },
  },
];

function forecastFor(crowd: number) {
  const factors: Record<number, number> = {
    8: 0.55,
    11: 0.9,
    14: 1.15,
    17: 1.1,
    20: 0.7,
  };
  return [8, 11, 14, 17, 20].map((hour) => ({
    hour,
    crowd: Math.min(100, Math.round(crowd * (factors[hour] ?? 1))),
  }));
}

export const beaches: Beach[] = baseBeaches.map((beach) => {
  const slug = beach.slug ?? beach.id;
  return {
    ...beach,
    image: heroFor(slug),
    goldenHourDetail,
    vibeVotes: beach.vibes.map((tag, index) => ({
      tag,
      votes: index === 0 ? 1 : 0,
      userVoted: index === 0,
    })),
    amenityDetails: beach.amenities.map((name) => ({
      name,
      verifiedAt: "2026-06-19",
      source: "blue_flag_demo",
    })),
    photos: photoSet.map((photo) => ({
      url: `/assets/beaches/${beach.slug ?? beach.id}-${timeMap[photo.timeOfDay]}.svg`,
      timeOfDay: photo.timeOfDay,
      caption: photo.caption,
    })),
    hazards: hazardsBySlug[slug] ?? [],
    tide: { points: tidePoints, source: "tide_provider_demo" },
    crowdForecast: forecastFor(beach.crowd),
    provenance: {
      source: "sofar_demo",
      observedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
      receivedAt: new Date().toISOString(),
      spotterVerified:
        beach.id === "praia-da-coelha" || beach.id === "praia-da-marinha",
      blueFlag: [
        "praia-da-coelha",
        "praia-da-marinha",
        "meia-praia",
        "praia-da-rocha",
      ].includes(beach.id),
    },
  };
});

export const tideData = tidePoints;
