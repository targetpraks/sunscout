import type {
  Beach,
  Booking,
  InstitutionPortfolio,
  MerchantDashboard,
  Progress,
  AppNotification,
  SettlementsResponse,
  Trip,
  TripPack,
  UserProfile,
} from "./types";

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-sunscout-user-id": "00000000-0000-7000-8000-000000000001",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `api_${response.status}`);
  }
  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export type BeachQuery = {
  q?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  activities?: string[];
  nudist?: boolean;
  audience?: string;
  lowCrowd?: boolean;
  suitability?: string;
  refresh?: boolean;
};

export async function fetchBeaches(params: BeachQuery = {}) {
  const search = new URLSearchParams();
  if (params.refresh !== false) search.set("refresh", "true");
  if (params.q) search.set("q", params.q);
  if (params.lat != null) search.set("lat", String(params.lat));
  if (params.lng != null) search.set("lng", String(params.lng));
  if (params.radiusKm != null) search.set("radiusKm", String(params.radiusKm));
  if (params.activities?.length)
    search.set("activities", params.activities.join(","));
  if (params.nudist) search.set("nudist", "true");
  if (params.audience) search.set("audience", params.audience);
  if (params.lowCrowd) search.set("lowCrowd", "true");
  if (params.suitability) search.set("suitability", params.suitability);
  const result = await apiRequest<{ data: Beach[] }>(
    `/beaches?${search.toString()}`,
  );
  return result.data;
}

export async function fetchSavedBeachIds() {
  const result = await apiRequest<{ data: string[] }>("/me/saved");
  return result.data;
}

export async function setBeachSaved(beachId: string, saved: boolean) {
  await apiRequest(`/me/saved/${beachId}`, {
    method: saved ? "PUT" : "DELETE",
  });
}

export async function createCheckIn(
  beachPublicId: string,
  photo?: { url: string; caption?: string },
) {
  return apiRequest<{
    data: {
      public_id: string;
      checked_in_at: string;
      points_awarded: number;
      newBadges?: string[];
    };
  }>("/check-ins", {
    method: "POST",
    body: JSON.stringify({
      beachPublicId,
      coarseLocationBucket: "algarve-demo",
      photoUrl: photo?.url,
      caption: photo?.caption,
    }),
  });
}

export async function createBooking(
  beachPublicId: string,
  sunbeds: number,
  umbrellas: number,
  startsAt?: Date,
) {
  const date = startsAt ?? new Date();
  if (!startsAt) {
    date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7));
    date.setHours(10, 0, 0, 0);
  }
  return apiRequest<{
    data: {
      id: string;
      totalCents: number;
      qrToken: string;
      startsAt: string;
    };
  }>("/bookings", {
    method: "POST",
    body: JSON.stringify({
      beachPublicId,
      startsAt: date.toISOString(),
      sunbeds,
      umbrellas,
    }),
  });
}

export async function fetchBookings(): Promise<Booking[]> {
  const result = await apiRequest<{
    data: Array<{
      public_id: string;
      beach_public_id: string;
      beach_name: string;
      starts_at: string;
      total_cents: number;
      qr_token: string;
      items: Array<{ type: string; quantity: number }>;
    }>;
  }>("/bookings");
  return result.data.map((item) => ({
    id: item.public_id,
    beachId: item.beach_public_id,
    beachName: item.beach_name,
    date: "Sat",
    time: new Date(item.starts_at).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    sunbeds: item.items.find((line) => line.type === "sunbed")?.quantity ?? 0,
    umbrellas:
      item.items.find((line) => line.type === "umbrella")?.quantity ?? 0,
    total: Math.round(item.total_cents / 100),
    qrToken: item.qr_token,
  }));
}

export async function fetchTrips(): Promise<Trip[]> {
  const result = await apiRequest<{
    data: Array<{
      public_id: string;
      name: string;
      starts_on: string | null;
      ends_on: string | null;
      status: Trip["status"];
      beaches: Trip["beaches"];
      location_label: string | null;
      latitude: number | null;
      longitude: number | null;
      members: Array<{ id: string; name: string; relationship: string }>;
    }>;
  }>("/me/trips");
  return result.data.map((trip) => ({
    id: trip.public_id,
    name: trip.name,
    startsOn: trip.starts_on,
    endsOn: trip.ends_on,
    status: trip.status,
    beaches: trip.beaches,
    locationLabel: trip.location_label,
    latitude: trip.latitude,
    longitude: trip.longitude,
    members: trip.members,
  }));
}

export async function createTrip(input: {
  name: string;
  startsOn?: string;
  endsOn?: string;
  beachPublicIds: string[];
  locationLabel?: string;
  latitude?: number;
  longitude?: number;
  friendIds?: string[];
}) {
  return apiRequest<{ data: { public_id: string } }>("/me/trips", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchFriends(): Promise<
  Array<{ public_id: string; name: string; relationship: string }>
> {
  try {
    const result = await apiRequest<{
      data: Array<{ public_id: string; name: string; relationship: string }>;
    }>("/me/friends");
    return result.data;
  } catch {
    return [];
  }
}

export async function addFriend(name: string, relationship: string) {
  return apiRequest<{ data: { public_id: string } }>("/me/friends", {
    method: "POST",
    body: JSON.stringify({ name, relationship }),
  });
}

export async function deleteFriend(friendId: string) {
  await apiRequest(`/me/friends/${friendId}`, { method: "DELETE" });
}

export async function submitFeedback(
  slug: string,
  metric: string,
  accurate: boolean,
) {
  return apiRequest<{ data: { recorded: boolean } }>(
    `/beaches/${slug}/feedback`,
    { method: "POST", body: JSON.stringify({ metric, accurate }) },
  );
}

export async function fetchMerchantDashboard() {
  const result = await apiRequest<{ data: MerchantDashboard }>(
    "/merchant/dashboard",
  );
  return result.data;
}

export async function updateMerchantInventory(
  inventoryPublicId: string,
  input: {
    availableCount?: number;
    priceCents?: number;
    version: number;
  },
) {
  return apiRequest<{
    data: {
      public_id: string;
      available_count: number;
      price_cents: number;
      version: number;
    };
  }>(`/merchant/inventory/${inventoryPublicId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function redeemMerchantBooking(
  bookingPublicId: string,
  qrToken: string,
) {
  return apiRequest<{ data: { public_id: string; status: string } }>(
    `/merchant/bookings/${bookingPublicId}/redeem`,
    {
      method: "POST",
      body: JSON.stringify({ qrToken }),
    },
  );
}

export async function fetchMe(): Promise<UserProfile | null> {
  try {
    const result = await apiRequest<{ data: UserProfile }>("/me");
    return result.data;
  } catch {
    return null;
  }
}

export async function setPremium(premium: boolean) {
  const result = await apiRequest<{ data: { is_premium: boolean } }>(
    "/me/premium",
    { method: "POST", body: JSON.stringify({ premium }) },
  );
  return result.data.is_premium;
}

export async function voteVibe(beachPublicId: string, tag: string) {
  return apiRequest<{
    data: {
      voted: boolean;
      tag: string;
      votes: Array<{ tag: string; votes: number; userVoted: boolean }>;
    };
  }>("/me/votes", {
    method: "POST",
    body: JSON.stringify({ beachPublicId, tag }),
  });
}

export async function deleteAccount() {
  await apiRequest<{ data: { status: string } }>("/me/delete-account", {
    method: "POST",
  });
}

export async function fetchProgress(): Promise<Progress | null> {
  try {
    const result = await apiRequest<{ data: Progress }>("/me/progress");
    return result.data;
  } catch {
    return null;
  }
}

export async function saveGoldenHourAlert(beachPublicId: string) {
  return apiRequest<{ data: { saved: boolean; newlyAwarded: boolean } }>(
    "/me/golden-hour-alert",
    { method: "POST", body: JSON.stringify({ beachPublicId }) },
  );
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  try {
    const result = await apiRequest<{ data: AppNotification[] }>(
      "/me/notifications",
    );
    return result.data;
  } catch {
    return [];
  }
}

export async function markNotificationRead(notificationId: string) {
  await apiRequest(`/me/notifications/${notificationId}/read`, {
    method: "PATCH",
  });
}

export async function setNotificationPreference(
  kind: string,
  enabled: boolean,
) {
  await apiRequest("/me/notification-preferences", {
    method: "PUT",
    body: JSON.stringify({ kind, enabled }),
  });
}

export async function fetchSettlements(): Promise<SettlementsResponse | null> {
  try {
    const result = await apiRequest<{ data: SettlementsResponse }>(
      "/merchant/settlements",
    );
    return result.data;
  } catch {
    return null;
  }
}

export function bookingsCalendarUrl(): string {
  return `${apiBase}/me/bookings.ics`;
}

export async function fetchTripPack(tripId: string): Promise<TripPack | null> {
  try {
    const result = await apiRequest<{ data: TripPack }>(
      `/me/trips/${tripId}/pack`,
    );
    return result.data;
  } catch {
    return null;
  }
}

export async function fetchInstitutionDashboard(): Promise<InstitutionPortfolio | null> {
  try {
    const result = await apiRequest<{ data: InstitutionPortfolio }>(
      "/institution/dashboard",
    );
    return result.data;
  } catch {
    return null;
  }
}

export function institutionExportUrl(format: "csv" | "geojson"): string {
  return `${apiBase}/institution/export?format=${format}`;
}

export function institutionEmbedUrl(token: string): string {
  return `${apiBase.replace(/\/api$/, "")}/embed/${token}`;
}

export async function sendAnalyticsEvent(
  name: string,
  properties: Record<string, unknown>,
) {
  await apiRequest("/events", {
    method: "POST",
    body: JSON.stringify({ name, properties }),
  });
}

export async function cancelBooking(bookingPublicId: string) {
  return apiRequest<{
    data: { refundCents: number; forfeitCents: number; tier: string };
  }>(`/bookings/${bookingPublicId}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function reportHazard(input: {
  beachPublicId: string;
  severity: "advisory" | "warning" | "danger";
  title: string;
  detail: string;
}) {
  return apiRequest<{ data: { public_id: string; verified: boolean } }>(
    "/hazards",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function claimMerchant(input: {
  beachPublicId: string;
  businessName: string;
}) {
  return apiRequest<{ data: { public_id: string; status: string } }>(
    "/merchant/claim",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function createMerchantInventory(input: {
  beachPublicId: string;
  amenityType: "sunbed" | "umbrella" | "cabana" | "activity";
  totalCount: number;
  priceCents: number;
  slotDurationMinutes?: number;
  label?: string;
  description?: string;
}) {
  return apiRequest<{
    data: {
      public_id: string;
      amenity_type: string;
      total_count: number;
      available_count: number;
      price_cents: number;
      version: number;
    };
  }>("/merchant/inventory", { method: "POST", body: JSON.stringify(input) });
}

export type TrendPoint = {
  day: string;
  avg_crowd: number | null;
  water_quality: string | null;
  samples: number;
};

export async function fetchTrends(slug: string): Promise<TrendPoint[]> {
  try {
    const result = await apiRequest<{
      data: { slug: string; series: TrendPoint[] };
    }>(`/institution/trends?beach=${encodeURIComponent(slug)}`);
    return result.data.series;
  } catch {
    return [];
  }
}

export type OpsStatus = {
  status: string;
  uptime_seconds: number;
  payments_configured: boolean;
  push_configured: boolean;
  auth_adapter_configured: boolean;
  error_tracking_configured: boolean;
  beaches: number;
  active_hazards: number;
};

export async function fetchOpsStatus(): Promise<OpsStatus | null> {
  try {
    const result = await apiRequest<{ data: OpsStatus }>("/ops/status");
    return result.data;
  } catch {
    return null;
  }
}

export type SpotterCampaign = {
  public_id: string;
  goal_cents: number;
  raised_cents: number;
  status: string;
};

export async function fetchSpotterCampaign(
  slug: string,
): Promise<SpotterCampaign | null> {
  try {
    const result = await apiRequest<{ data: SpotterCampaign | null }>(
      `/beaches/${encodeURIComponent(slug)}/spotter-campaign`,
    );
    return result.data;
  } catch {
    return null;
  }
}

export async function contributeSpotter(slug: string, amountCents: number) {
  return apiRequest<{ data: { raised_cents: number; status: string } }>(
    `/beaches/${encodeURIComponent(slug)}/spotter-campaign/contribute`,
    { method: "POST", body: JSON.stringify({ amountCents }) },
  );
}

// === Concierge ===
export type ConciergeResult = {
  beach: Record<string, unknown>;
  score: number;
  reasons: string[];
};

export async function fetchConcierge(
  query: string,
  latitude?: number,
  longitude?: number,
): Promise<ConciergeResult[]> {
  try {
    const result = await apiRequest<{ data: ConciergeResult[] }>("/concierge", {
      method: "POST",
      body: JSON.stringify({ query, latitude, longitude }),
    });
    return result.data;
  } catch {
    return [];
  }
}

// === Crowd forecast ===
export type CrowdForecastData = {
  forecast: Array<{ hour: number; crowd_percent: number }>;
  liveCheckIns: number;
  currentCrowd: number | null;
};

export async function fetchCrowdForecast(
  slug: string,
): Promise<CrowdForecastData | null> {
  try {
    const result = await apiRequest<{ data: CrowdForecastData }>(
      `/beaches/${encodeURIComponent(slug)}/crowd-forecast`,
    );
    return result.data;
  } catch {
    return null;
  }
}

// === Journal ===
export type JournalEntry = {
  public_id: string;
  notes: string | null;
  mood: string | null;
  conditions_snapshot: Record<string, unknown>;
  visited_on: string;
  beach_public_id: string;
  slug: string;
  name: string;
  cover_photo_url: string;
};

export async function fetchJournal(): Promise<JournalEntry[]> {
  try {
    const result = await apiRequest<{ data: JournalEntry[] }>("/me/journal");
    return result.data;
  } catch {
    return [];
  }
}

export async function addJournalEntry(input: {
  beachPublicId: string;
  notes?: string;
  mood?: string;
}) {
  return apiRequest<{ data: { public_id: string } }>("/me/journal", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// === Stats ===
export type BeachStats = {
  totalVisits: number;
  beachDays: number;
  distinctBeaches: number;
  moodBreakdown: Array<{ mood: string; count: number }>;
  topBeaches: Array<{ name: string; slug: string; visits: number }>;
  averageRatingGiven: string | null;
};

export async function fetchStats(): Promise<BeachStats | null> {
  try {
    const result = await apiRequest<{ data: BeachStats }>("/me/stats");
    return result.data;
  } catch {
    return null;
  }
}

// === Beach rating ===
export async function rateBeach(slug: string, stars: number) {
  return apiRequest<{ data: { stars: number } }>(
    `/beaches/${encodeURIComponent(slug)}/rate`,
    { method: "POST", body: JSON.stringify({ stars }) },
  );
}

export async function fetchBeachRating(
  slug: string,
): Promise<{ avg: string | null; count: number } | null> {
  try {
    const result = await apiRequest<{
      data: { avg: string | null; count: number };
    }>(`/beaches/${encodeURIComponent(slug)}/rating`);
    return result.data;
  } catch {
    return null;
  }
}

// === Trip votes ===
export async function voteTripBeach(
  tripId: string,
  beachPublicId: string,
  friendId: string,
  vote: "up" | "down",
) {
  return apiRequest<{ data: { recorded: boolean } }>(
    `/me/trips/${tripId}/votes`,
    { method: "POST", body: JSON.stringify({ beachPublicId, friendId, vote }) },
  );
}

// === Community beach reports ===
export type BeachReport = {
  sandType?: string;
  sandColor?: string;
  sunbedPrice?: number;
  umbrellaPrice?: number;
  waterSportPrice?: number;
  music?: string;
  food?: string;
  showers?: boolean;
  changingRooms?: boolean;
  toilets?: boolean;
  notes?: string;
};

export async function submitBeachReport(slug: string, report: BeachReport) {
  return apiRequest<{ data: { reported: number } }>(
    `/beaches/${encodeURIComponent(slug)}/report`,
    { method: "POST", body: JSON.stringify(report) },
  );
}

export async function fetchCommunityData(slug: string): Promise<{
  attributes: Record<string, string>;
  reportCount: number;
} | null> {
  try {
    const result = await apiRequest<{
      data: { attributes: Record<string, string>; reportCount: number };
    }>(`/beaches/${encodeURIComponent(slug)}/community-data`);
    return result.data;
  } catch {
    return null;
  }
}

// === Day quality score ===
export type DayQuality = {
  earlyMorning: { score: number; summary: string };
  midday: { score: number; summary: string };
  afternoon: { score: number; summary: string };
  evening: { score: number; summary: string };
  overall: number;
};

export async function fetchDayQuality(
  slug: string,
): Promise<DayQuality | null> {
  try {
    const result = await apiRequest<{ data: DayQuality }>(
      `/beaches/${encodeURIComponent(slug)}/day-quality`,
    );
    return result.data;
  } catch {
    return null;
  }
}
