export type TabId = "today" | "discover" | "trips" | "saved" | "profile";

export type Suitability = {
  id: string;
  label: string;
  value: string;
  score?: number;
  ageMin?: number | null;
  ageMax?: number | null;
};

export type VibeVote = {
  tag: string;
  votes: number;
  userVoted: boolean;
};

export type AmenityDetail = {
  name: string;
  verifiedAt: string | null;
  source: string | null;
};

export type BeachPhoto = {
  url: string;
  timeOfDay: string;
  caption: string;
};

export type HazardAlert = {
  id: string;
  severity: "advisory" | "warning" | "danger";
  title: string;
  detail: string;
  at: string;
};

export type TidePoint = {
  time: string;
  level: number;
};

export type CrowdForecastPoint = {
  hour: number;
  crowd: number;
};

export type GoldenHourDetail = {
  sunrise: string;
  sunset: string;
  blueHourMorning: string;
  blueHourEvening: string;
  direction: string;
  lightScore: number | null;
};

export type Beach = {
  id: string;
  slug?: string;
  name: string;
  location: string;
  image: string;
  decision: string;
  match: number;
  drive: string;
  distance: string;
  seaTemp: string;
  waves: string;
  uv: string;
  crowd: number;
  waterQuality: string;
  goldenHour: string;
  goldenHourDetail?: GoldenHourDetail;
  airTemp?: string | null;
  wind?: string | null;
  windSpeed?: string | null;
  cloudCover?: string | null;
  wavePeriod?: string | null;
  seaLevel?: string | null;
  vibes: string[];
  activities?: string[];
  allowsNudism?: boolean;
  latitude?: number;
  longitude?: number;
  travel?: { distanceKm: number; walkMinutes: number; driveMinutes: number };
  vibeVotes?: VibeVote[];
  amenityDetails?: AmenityDetail[];
  photos?: BeachPhoto[];
  hazards?: HazardAlert[];
  tide?: { points: TidePoint[]; source: string };
  crowdForecast?: CrowdForecastPoint[];
  suitability: Suitability[];
  amenities: string[];
  available: {
    sunbeds: number;
    umbrellas: number;
    clubs: number;
  };
  provenance?: {
    source?: string | null;
    observedAt?: string | null;
    receivedAt?: string | null;
    refreshedAt?: string | null;
    spotterVerified?: boolean;
    blueFlag?: boolean;
  };
};

export type Booking = {
  id: string;
  beachId: string;
  beachName: string;
  date: string;
  time: string;
  sunbeds: number;
  umbrellas: number;
  total: number;
  qrToken?: string;
  startsAt?: string;
};

export type TripMember = { id: string; name: string; relationship: string };

export type Trip = {
  id: string;
  name: string;
  startsOn?: string | null;
  endsOn?: string | null;
  status: "draft" | "active" | "completed" | "cancelled";
  beaches: Array<{
    id: string;
    slug: string;
    name: string;
  }>;
  locationLabel?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  members?: TripMember[];
};

export type Friend = {
  public_id: string;
  name: string;
  relationship: string;
};

export type UserProfile = {
  public_id: string;
  email: string;
  display_name: string;
  is_premium: boolean;
};

export type MerchantDashboard = {
  summary: {
    today_bookings: number;
    upcoming_bookings: number;
    gross_cents: number;
    weekly_gmv_cents: number;
    self_bookings: number;
    distinct_guests: number;
    locations: number;
  };
  inventory: Array<{
    public_id: string;
    amenity_type: string;
    total_count: number;
    available_count: number;
    price_cents: number;
    currency: string;
    version: number;
    business_name: string;
    beach_name: string;
    beach_public_id: string;
  }>;
  bookings: Array<{
    public_id: string;
    starts_at: string;
    status: string;
    total_cents: number;
    currency: string;
    qr_token: string;
    beach_name: string;
    guest_name: string;
    items: Array<{ type: string; quantity: number }>;
  }>;
};

export type Badge = {
  public_id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  awarded_at: string;
};

export type Progress = {
  points: number;
  badges: Badge[];
};

export type AppNotification = {
  public_id: string;
  kind: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

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

export type SettlementSummary = {
  net_payable: number;
  pending: number;
  settled: number;
};

export type Settlement = {
  public_id: string;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  currency: string;
  status: string;
  settled_at: string | null;
  created_at: string;
  beach_name: string;
  booking_public_id: string;
  starts_at: string;
};

export type SettlementsResponse = {
  settlements: Settlement[];
  summary: SettlementSummary;
};

export type TripPackBeach = {
  public_id: string;
  slug: string;
  name: string;
  region: string;
  cover_photo_url: string;
  sea_temp_c: number | null;
  wave_height_m: number | null;
  uv_index: number | null;
  crowd_percent: number | null;
  water_quality: string | null;
  golden_hour_start: string | null;
  golden_hour_end: string | null;
  source: string | null;
  received_at: string | null;
};

export type TripPack = {
  trip: {
    public_id: string;
    name: string;
    starts_on: string | null;
    ends_on: string | null;
  };
  beaches: TripPackBeach[];
  packed_at: string;
  offline: boolean;
};

export type PortfolioBeach = {
  public_id: string;
  slug: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  crowd_percent: number | null;
  water_quality: string | null;
  blue_flag: boolean;
  hazard_count: number;
  received_at: string | null;
  source: string | null;
};

export type InstitutionPortfolio = {
  institution: {
    public_id: string;
    name: string;
    slug: string;
    region: string | null;
  };
  contract: {
    status: string;
    ends_on: string | null;
    exports_used: number;
    annual_quota_exports: number;
  };
  beaches: PortfolioBeach[];
};
