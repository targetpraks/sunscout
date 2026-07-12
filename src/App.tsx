import {
  ArrowLeft,
  Armchair,
  BadgeCheck,
  Bell,
  BookOpen,
  Calendar,
  Camera,
  ChevronDown,
  ChevronRight,
  Check,
  CircleUser,
  Cloud as CloudIcon,
  Compass,
  Crown,
  Download,
  Wind,
  Droplet,
  Heart,
  House,
  Info,
  Lock,
  LogOut,
  MapPin,
  Medal,
  Music,
  Navigation,
  PersonStanding,
  Plus,
  Search,
  Share2,
  ShoppingBag,
  Sparkles,
  Sun,
  Sunrise,
  Thermometer,
  Ticket,
  Trash2,
  Umbrella,
  Users,
  Waves,
  Accessibility,
  Activity,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  cancelBooking as cancelApiBooking,
  claimMerchant as claimApiMerchant,
  fetchConcierge as fetchApiConcierge,
  fetchCrowdForecast as fetchApiCrowdForecast,
  fetchJournal as fetchApiJournal,
  fetchStats as fetchApiStats,
  rateBeach as rateApiBeach,
  submitBeachReport as submitApiReport,
  fetchCommunityData as fetchApiCommunityData,
  fetchDayQuality as fetchApiDayQuality,
  voteTripBeach as voteApiTripBeach,
  contributeSpotter as contributeApiSpotter,
  fetchSpotterCampaign as fetchApiSpotterCampaign,
  createBooking as createApiBooking,
  createCheckIn as createApiCheckIn,
  createMerchantInventory,
  createTrip as createApiTrip,
  deleteAccount as deleteApiAccount,
  fetchBeaches,
  fetchBookings,
  fetchInstitutionDashboard,
  fetchMe,
  fetchMerchantDashboard,
  fetchSavedBeachIds,
  fetchTrips,
  fetchNotifications,
  fetchProgress,
  fetchSettlements,
  bookingsCalendarUrl,
  fetchTripPack,
  fetchTrends,
  fetchOpsStatus,
  institutionEmbedUrl,
  institutionExportUrl,
  markNotificationRead,
  redeemMerchantBooking,
  reportHazard as reportApiHazard,
  saveGoldenHourAlert,
  sendAnalyticsEvent,
  setBeachSaved as apiSetSaved,
  setNotificationPreference,
  setPremium as setApiPremium,
  submitFeedback,
  fetchFriends,
  addFriend,
  deleteFriend,
  updateMerchantInventory,
  voteVibe as apiVoteVibe,
} from "./api";
import { beaches as fallbackBeaches, tideData } from "./data";
import {
  ACTIVITY_OPTIONS,
  AUDIENCE_OPTIONS,
  bookingTotalEuros,
  canCreateTrip,
  canSaveBeach,
  discoveryFreeResults,
  haversineKm,
  PRESET_LOCATIONS,
  rankBeaches,
  travelFor,
} from "./logic";
import type {
  AppNotification,
  Beach,
  Badge,
  Booking,
  HazardAlert,
  InstitutionPortfolio,
  MerchantDashboard,
  OpsStatus,
  Progress,
  Settlement,
  SettlementsResponse,
  TabId,
  TidePoint,
  Trip,
  UserProfile,
} from "./types";

const navItems = [
  { id: "today" as const, label: "Today", icon: House },
  { id: "discover" as const, label: "Discover", icon: Compass },
  { id: "trips" as const, label: "Trips", icon: ShoppingBag },
  { id: "saved" as const, label: "Saved", icon: Heart },
  { id: "profile" as const, label: "Profile", icon: CircleUser },
];

const iconForSuitability = {
  families: Users,
  solo: PersonStanding,
  couples: Heart,
  party: Music,
  clubs: Umbrella,
};

const TidePanel = lazy(() =>
  import("./TidePanel").then((module) => ({ default: module.TidePanel })),
);
const BeachMap = lazy(() =>
  import("./BeachMap").then((module) => ({ default: module.BeachMap })),
);

const eventLog = (name: string, properties: Record<string, unknown> = {}) => {
  window.dispatchEvent(
    new CustomEvent("sunscout:analytics", {
      detail: { name, properties, at: new Date().toISOString() },
    }),
  );
  void sendAnalyticsEvent(name, properties).catch(() => undefined);
};

function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : initial;
  });

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved =
          typeof next === "function"
            ? (next as (current: T) => T)(current)
            : next;
        localStorage.setItem(key, JSON.stringify(resolved));
        return resolved;
      });
    },
    [key],
  );

  return [value, update] as const;
}

function freshnessLabel(beach: Beach): string {
  const receivedAt = beach.provenance?.receivedAt
    ? new Date(beach.provenance.receivedAt)
    : null;
  const ageMinutes = receivedAt
    ? Math.max(0, Math.round((Date.now() - receivedAt.getTime()) / 60_000))
    : null;
  if (ageMinutes == null) return "Offline beach estimate";
  if (ageMinutes < 1) return "Updated just now";
  return `Updated ${ageMinutes} min ago`;
}

function sourceLabel(beach: Beach): string {
  const source = beach.provenance?.source;
  if (!source) return "";
  if (source.startsWith("sofar")) return "SoFar Spotter";
  if (source.startsWith("open_meteo")) return "Open-Meteo";
  if (source.startsWith("provider")) return "Provider demo";
  return source;
}

function Brand() {
  return (
    <div className="brand" aria-label="SunScout">
      <span className="brand-mark">
        <Sunrise />
      </span>
      <span>SunScout</span>
    </div>
  );
}

function AppHeader({
  compact = false,
  onBack,
}: {
  compact?: boolean;
  onBack?: () => void;
}) {
  return (
    <header className={`app-header ${compact ? "compact" : ""}`}>
      <div className="header-row">
        {onBack ? (
          <button className="icon-button" onClick={onBack} aria-label="Go back">
            <ArrowLeft />
          </button>
        ) : (
          <Brand />
        )}
        <button className="location-button">
          <MapPin />
          <span>Algarve, Portugal</span>
          <ChevronDown />
        </button>
      </div>
      {!compact ? (
        <div className="greeting-row">
          <Sun className="coral" />
          <strong>Good morning, Maya</strong>
          <button
            className="icon-button favorite-header"
            aria-label="Open saved beaches"
          >
            <Heart />
          </button>
        </div>
      ) : null}
    </header>
  );
}

function BottomNav({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {navItems.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={active === id ? "active" : ""}
          onClick={() => onChange(id)}
          aria-current={active === id ? "page" : undefined}
        >
          <Icon fill={active === id ? "currentColor" : "none"} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function SuitabilityRail({
  beach,
  onSelect,
}: {
  beach: Beach;
  onSelect: (message: string) => void;
}) {
  return (
    <section className="suitability-section">
      <div className="section-heading compact-heading">
        <h2>Best for today</h2>
        <Info aria-label="Suitability combines conditions, amenities and crowd data" />
      </div>
      <div className="suitability-rail">
        {beach.suitability.map((item) => {
          const Icon =
            iconForSuitability[item.id as keyof typeof iconForSuitability] ??
            Users;
          return (
            <button
              key={item.id}
              className={`suitability-item ${item.id === "party" ? "party" : ""}`}
              onClick={() =>
                onSelect(`${item.label}: ${item.value} at ${beach.name}`)
              }
            >
              <Icon />
              <span className="suitability-label">{item.label}</span>
              {typeof item.score === "number" ? (
                <span className="rating-dots" aria-label={`${item.score} of 3`}>
                  {[0, 1, 2].map((dot) => (
                    <i
                      key={dot}
                      className={dot < item.score! ? "filled" : ""}
                    />
                  ))}
                </span>
              ) : null}
              <strong>{item.value}</strong>
              {item.id === "clubs" ? <ChevronRight /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export const conditionMetrics = (beach: Beach) => {
  const crowdState =
    beach.crowd < 40
      ? "Low"
      : beach.crowd < 70
        ? "Medium"
        : beach.crowd < 90
          ? "High"
          : "Full";
  const metrics: Array<{
    key: string;
    label: string;
    value: string;
    icon: typeof Sun;
    tone?: string;
  }> = [
    {
      key: "sea_temp",
      label: "Sea temp",
      value: beach.seaTemp,
      icon: Thermometer,
    },
    { key: "waves", label: "Waves", value: beach.waves, icon: Waves },
    { key: "uv", label: "UV", value: beach.uv, icon: Sun, tone: "warning" },
    {
      key: "crowd",
      label: "Crowd",
      value: `${beach.crowd}% ${crowdState}`,
      icon: Users,
      tone: beach.crowd < 40 ? "success" : beach.crowd >= 70 ? "warning" : "",
    },
    {
      key: "water_quality",
      label: "Water quality",
      value: beach.waterQuality,
      icon: Droplet,
      tone: "success",
    },
  ];
  if (beach.airTemp)
    metrics.push({
      key: "air_temp",
      label: "Air",
      value: beach.airTemp,
      icon: Sun,
    });
  if (beach.windSpeed)
    metrics.push({
      key: "wind",
      label: "Wind",
      value: beach.windSpeed,
      icon: Wind,
    });
  if (beach.cloudCover)
    metrics.push({
      key: "cloud",
      label: "Cloud",
      value: beach.cloudCover,
      icon: CloudIcon,
    });
  return metrics;
};

function Conditions({ beach }: { beach: Beach }) {
  const metrics = conditionMetrics(beach);
  return (
    <section className="condition-strip" aria-label="Current beach conditions">
      {metrics.map(({ key, label, value, icon: Icon, tone }) => (
        <div className={`condition ${tone ?? ""}`} key={key}>
          <Icon />
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function AccuracyVote({
  beach,
  metrics,
}: {
  beach: Beach;
  metrics: Array<{ key: string; label: string }>;
}) {
  const [votes, setVotes] = useState<Record<string, boolean>>({});
  const vote = (key: string, accurate: boolean) => {
    setVotes((current) => ({ ...current, [key]: accurate }));
    void submitFeedback(beach.slug ?? beach.id, key, accurate).catch(
      () => undefined,
    );
    eventLog("beach_saved", { beachId: beach.id, feedback: key, accurate });
  };
  return (
    <section className="accuracy-vote">
      <div className="section-heading compact-heading">
        <h2>Are these accurate?</h2>
        <Info aria-label="Your rating improves conditions for everyone" />
      </div>
      <div className="accuracy-list">
        {metrics.map((metric) => (
          <span className="accuracy-item" key={metric.key}>
            <small>{metric.label}</small>
            <button
              className={votes[metric.key] === true ? "active" : ""}
              onClick={() => vote(metric.key, true)}
              aria-label={`${metric.label} accurate`}
            >
              <Check size={15} />
            </button>
            <button
              className={votes[metric.key] === false ? "active" : ""}
              onClick={() => vote(metric.key, false)}
              aria-label={`${metric.label} inaccurate`}
            >
              <X size={15} />
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}

function Freshness({ beach }: { beach: Beach }) {
  const source = sourceLabel(beach);
  return (
    <span className="freshness">
      ↻ {freshnessLabel(beach)}
      {source ? ` · ${source}` : ""}
      {beach.provenance?.spotterVerified ? " · Spotter verified" : ""}
    </span>
  );
}

function AlertBanner({ hazard }: { hazard: HazardAlert }) {
  const tone =
    hazard.severity === "danger"
      ? "danger"
      : hazard.severity === "warning"
        ? "warning"
        : "advisory";
  return (
    <section className={`alert-banner ${tone}`} role="status">
      <Info />
      <span>
        <strong>{hazard.title}</strong>
        <small>{hazard.detail}</small>
      </span>
    </section>
  );
}

function ActionRow({
  icon: Icon,
  title,
  subtitle,
  trailing,
  onClick,
}: {
  icon: typeof Sun;
  title: string;
  subtitle: string;
  trailing?: string;
  onClick: () => void;
}) {
  return (
    <button className="action-row" onClick={onClick}>
      <span className="action-icon">
        <Icon />
      </span>
      <span className="action-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </span>
      {trailing ? <span className="action-trailing">{trailing}</span> : null}
      <ChevronRight />
    </button>
  );
}

function TodayScreen({
  beach,
  isSaved,
  booking,
  onToggleSaved,
  onViewBeach,
  onDiscover,
  onOpenBooking,
  onCancelBooking,
  onOpenGoldenHour,
  onToast,
}: {
  beach: Beach;
  isSaved: boolean;
  booking?: Booking;
  onToggleSaved: () => void;
  onViewBeach: () => void;
  onDiscover: () => void;
  onOpenBooking: () => void;
  onCancelBooking: () => void;
  onOpenGoldenHour: () => void;
  onToast: (message: string) => void;
}) {
  const [tideExpanded, setTideExpanded] = useState(false);
  const topHazard = beach.hazards?.[0];
  const waterAdvisory =
    beach.waterQuality === "Advisory" || beach.waterQuality === "Closed";
  return (
    <>
      <AppHeader />
      <main className="screen-content today-screen">
        <button className="hero-image-button" onClick={onViewBeach}>
          <img
            src={beach.image}
            srcSet={`${beach.image.replace(/\.webp$/, "-430.webp")} 430w, ${beach.image} 860w`}
            sizes="(max-width: 430px) 100vw, 430px"
            alt={`Clear turquoise water at ${beach.name}`}
            width={430}
            height={172}
            fetchPriority="high"
            decoding="async"
          />
        </button>
        <section className="beach-intro">
          <button className="beach-title-row" onClick={onViewBeach}>
            <span>
              <h1>{beach.name}</h1>
              <p>{beach.decision}</p>
            </span>
            <ChevronRight />
          </button>
          <button
            className={`floating-save ${isSaved ? "saved" : ""}`}
            onClick={onToggleSaved}
            aria-label={isSaved ? "Remove from saved" : "Save beach"}
          >
            <Heart fill={isSaved ? "currentColor" : "none"} />
          </button>
        </section>
        {topHazard ? <AlertBanner hazard={topHazard} /> : null}
        {waterAdvisory ? (
          <section className="alert-banner advisory" role="status">
            <Droplet />
            <span>
              <strong>Water quality notice</strong>
              <small>{beach.waterQuality} — check before swimming.</small>
            </span>
          </section>
        ) : null}
        <SuitabilityRail beach={beach} onSelect={onToast} />
        <Conditions beach={beach} />
        <AccuracyVote beach={beach} metrics={conditionMetrics(beach)} />
        <Suspense fallback={null}>
          <TidePanel
            points={beach.tide?.points?.length ? beach.tide.points : tideData}
            expanded={tideExpanded}
            onToggle={() => setTideExpanded((current) => !current)}
          />
        </Suspense>
        <div className="action-list">
          <ActionRow
            icon={Sun}
            title="Golden Hour"
            subtitle={beach.goldenHour}
            trailing="in 10h 47m"
            onClick={onOpenGoldenHour}
          />
          <ActionRow
            icon={Ticket}
            title={booking ? "Upcoming booking" : "Reserve your beach day"}
            subtitle={
              booking
                ? `${booking.sunbeds} sunbeds + ${booking.umbrellas} umbrella · ${booking.date} ${booking.time}`
                : `${beach.available.sunbeds} sunbeds available today`
            }
            onClick={onOpenBooking}
          />
          {booking ? (
            <button
              className="text-button cancel-booking"
              onClick={onCancelBooking}
            >
              Cancel booking
            </button>
          ) : null}
        </div>
        <div className="home-actions">
          <Freshness beach={beach} />
          <button className="primary-button" onClick={onViewBeach}>
            View beach <ChevronRight />
          </button>
          <button className="secondary-button" onClick={onDiscover}>
            Find another <ChevronRight />
          </button>
        </div>
      </main>
    </>
  );
}

function ConciergeCard({
  origin,
  onSelectBeach,
}: {
  origin: { label: string; latitude: number; longitude: number } | null;
  onSelectBeach: (beach: Beach) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ beach: Record<string, unknown>; score: number; reasons: string[] }>
  >([]);
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await fetchApiConcierge(
        query,
        origin?.latitude,
        origin?.longitude,
      );
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="concierge-card">
      <div className="concierge-header">
        <Sparkles size={18} />
        <strong>Ask the concierge</strong>
      </div>
      <p className="muted">
        Describe your perfect beach day in your own words.
      </p>
      <div className="search-field">
        <Search />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") ask();
          }}
          placeholder="Quiet family beach with calm water for toddlers, near Lagos"
        />
        <button onClick={ask} disabled={loading || !query.trim()}>
          {loading ? "…" : "Ask"}
        </button>
      </div>
      {results.length ? (
        <div className="concierge-results">
          {results.slice(0, 3).map((result, index) => (
            <button
              key={index}
              className="concierge-result"
              onClick={() => {
                const beach = result.beach as unknown as Beach;
                if (beach?.id) onSelectBeach(beach);
              }}
            >
              <span className="concierge-rank">#{index + 1}</span>
              <span className="concierge-copy">
                <strong>{(result.beach as { name?: string }).name}</strong>
                <small>{result.reasons.join(" · ")}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DiscoverScreen({
  beachCatalog,
  savedIds,
  isPremium,
  onToggleSaved,
  onSelectBeach,
  onOpenPremium,
}: {
  beachCatalog: Beach[];
  savedIds: string[];
  isPremium: boolean;
  onToggleSaved: (id: string) => void;
  onSelectBeach: (beach: Beach) => void;
  onOpenPremium: () => void;
}) {
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<string>("");
  const [activities, setActivities] = useState<string[]>([]);
  const [lowCrowd, setLowCrowd] = useState(false);
  const [nudistOnly, setNudistOnly] = useState(false);
  const [ageMax, setAgeMax] = useState<number>(0);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(0);
  const [origin, setOrigin] = useState<{
    label: string;
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  useEffect(() => {
    eventLog("discovery_started", {});
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({
          label: "My location",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  };

  const results = useMemo(() => {
    const scored = beachCatalog
      .map((beach) => {
        const travel =
          origin && beach.latitude != null && beach.longitude != null
            ? travelFor(
                haversineKm(
                  origin.latitude,
                  origin.longitude,
                  beach.latitude,
                  beach.longitude,
                ),
              )
            : null;
        const haystack = [
          beach.name,
          beach.decision,
          beach.vibes.join(" "),
          (beach.activities ?? []).join(" "),
          beach.suitability
            .map((item) => `${item.label} ${item.value}`)
            .join(" "),
        ]
          .join(" ")
          .toLowerCase();
        let score = beach.match;
        if (query && haystack.includes(query.toLowerCase())) score += 6;
        if (audience && beach.suitability.some((item) => item.id === audience))
          score += 8;
        for (const activity of activities) {
          if ((beach.activities ?? []).includes(activity)) score += 5;
        }
        if (lowCrowd && beach.crowd < 50) score += 9;
        return { beach, score: Math.min(score, 99), travel };
      })
      .filter(({ beach }) =>
        activities.length
          ? activities.every((a) => (beach.activities ?? []).includes(a))
          : true,
      )
      .filter(({ beach }) => !nudistOnly || beach.allowsNudism)
      .filter(({ beach }) => {
        if (!ageMax) return true;
        const family = beach.suitability.find((item) => item.id === "families");
        return Boolean(
          family &&
          family.ageMin != null &&
          family.ageMax != null &&
          family.ageMin <= ageMax &&
          family.ageMax >= ageMax,
        );
      })
      .filter(({ beach }) => !lowCrowd || beach.crowd < 70)
      .filter(
        ({ travel }) =>
          !maxDistanceKm || !travel || travel.distanceKm <= maxDistanceKm,
      )
      .sort((a, b) =>
        origin && a.travel && b.travel
          ? a.travel.distanceKm - b.travel.distanceKm
          : b.score - a.score,
      );
    return scored;
  }, [
    beachCatalog,
    query,
    audience,
    activities,
    lowCrowd,
    nudistOnly,
    maxDistanceKm,
    origin,
  ]);

  const freeResults = discoveryFreeResults(results, isPremium);
  const gatedResults = isPremium ? [] : results.slice(freeResults.length);
  const activeFilters =
    (audience ? 1 : 0) +
    activities.length +
    (lowCrowd ? 1 : 0) +
    (nudistOnly ? 1 : 0) +
    (maxDistanceKm ? 1 : 0);

  const renderResult = ({
    beach,
    score,
    travel,
  }: {
    beach: Beach;
    score: number;
    travel: {
      distanceKm: number;
      walkMinutes: number;
      driveMinutes: number;
    } | null;
  }) => (
    <article className="result-row" key={beach.id}>
      <button className="result-main" onClick={() => onSelectBeach(beach)}>
        <img src={beach.image} alt="" />
        <span className="result-copy">
          <span className="result-topline">
            <strong>{beach.name}</strong>
            <b>{score}</b>
          </span>
          <span>{beach.decision}</span>
          <small className="result-meta">
            {travel
              ? `${travel.distanceKm} km · ${travel.walkMinutes} min walk · ${travel.driveMinutes} min drive`
              : `${beach.drive} · ${beach.distance} · Crowd ${beach.crowd}%`}
            {beach.allowsNudism ? " · clothing-optional" : ""}
          </small>
          {(beach.activities ?? []).length ? (
            <small className="result-activities">
              {(beach.activities ?? []).slice(0, 4).map((a) => (
                <i key={a}>{a.replace(/_/g, " ")}</i>
              ))}
            </small>
          ) : null}
        </span>
      </button>
      <button
        className={`result-save ${savedIds.includes(beach.id) ? "saved" : ""}`}
        onClick={() => onToggleSaved(beach.id)}
        aria-label={savedIds.includes(beach.id) ? "Unsave beach" : "Save beach"}
      >
        <Heart fill={savedIds.includes(beach.id) ? "currentColor" : "none"} />
      </button>
    </article>
  );

  return (
    <>
      <AppHeader compact />
      <main className="screen-content discover-screen">
        <div className="screen-title">
          <h1>Find your beach</h1>
          <p>Where are you, and what kind of day do you want?</p>
        </div>
        <ConciergeCard origin={origin} onSelectBeach={onSelectBeach} />
        <label className="search-field">
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter")
                eventLog("discovery_completed", {
                  query,
                  audience,
                  activities,
                });
            }}
            placeholder="Quiet family beach, water sports, beach club…"
          />
          {query ? (
            <button onClick={() => setQuery("")} aria-label="Clear search">
              <X />
            </button>
          ) : null}
        </label>

        <div className="location-row">
          <MapPin />
          {origin ? (
            <span className="location-pill">
              {origin.label}
              <button
                onClick={() => setOrigin(null)}
                aria-label="Clear location"
              >
                <X size={14} />
              </button>
            </span>
          ) : (
            <span className="location-presets">
              {PRESET_LOCATIONS.map((place) => (
                <button key={place.label} onClick={() => setOrigin(place)}>
                  {place.label}
                </button>
              ))}
              <button onClick={useMyLocation} disabled={locating}>
                {locating ? "Locating…" : "Use my location"}
              </button>
            </span>
          )}
        </div>

        <button
          className="filter-toggle-bar"
          onClick={() => setShowFilters((current) => !current)}
          aria-expanded={showFilters}
        >
          <Sparkles size={16} />
          Filters {activeFilters ? `· ${activeFilters} active` : ""}
          {showFilters ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {showFilters ? (
          <div className="filter-panel">
            <div className="filter-group">
              <small>Who's going</small>
              <div className="filter-row">
                <button
                  className={audience === "" ? "active" : ""}
                  onClick={() => setAudience("")}
                >
                  Anyone
                </button>
                {AUDIENCE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    className={audience === option ? "active" : ""}
                    onClick={() => setAudience(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <small>Activities</small>
              <div className="filter-row">
                {ACTIVITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    className={activities.includes(option) ? "active" : ""}
                    onClick={() =>
                      setActivities((current) =>
                        current.includes(option)
                          ? current.filter((item) => item !== option)
                          : [...current, option],
                      )
                    }
                  >
                    {option.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <small>More</small>
              <div className="filter-row">
                <button
                  className={lowCrowd ? "active" : ""}
                  onClick={() => setLowCrowd((current) => !current)}
                >
                  Low crowd
                </button>
                <button
                  className={nudistOnly ? "active" : ""}
                  onClick={() => setNudistOnly((current) => !current)}
                >
                  Clothing-optional
                </button>
              </div>
              <div className="filter-row">
                <small>Kids up to age</small>
                {[0, 4, 8, 12].map((age) => (
                  <button
                    key={age}
                    className={ageMax === age ? "active" : ""}
                    onClick={() => setAgeMax(ageMax === age ? 0 : age)}
                  >
                    {age === 0 ? "Any" : age}
                  </button>
                ))}
              </div>
              {origin ? (
                <label className="distance-slider">
                  <span>
                    Within{" "}
                    {maxDistanceKm ? `${maxDistanceKm} km` : "any distance"}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={maxDistanceKm}
                    onChange={(event) =>
                      setMaxDistanceKm(Number(event.target.value))
                    }
                  />
                </label>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="result-heading">
          <strong>{results.length} matches</strong>
          <span>{origin ? "Closest first" : "Best fit first"}</span>
        </div>
        {origin ? (
          <Suspense fallback={null}>
            <BeachMap
              origin={origin}
              beaches={results.map((entry) => entry.beach)}
              selectedIds={[]}
              onSelect={onSelectBeach}
            />
          </Suspense>
        ) : null}
        <div className="beach-results">
          {freeResults.map(renderResult)}
          {gatedResults.length ? (
            <button className="premium-gate" onClick={onOpenPremium}>
              <Lock />
              <span>
                <strong>{gatedResults.length} more matches on Premium</strong>
                <small>
                  Full discovery, 14-day forecasts and unlimited trips for
                  €1.99/month.
                </small>
              </span>
              <Crown />
            </button>
          ) : null}
        </div>
      </main>
    </>
  );
}

function VibeVotes({
  beach,
  onVote,
}: {
  beach: Beach;
  onVote: (tag: string) => void;
}) {
  const votes =
    beach.vibeVotes ??
    beach.vibes.map((tag) => ({ tag, votes: 0, userVoted: false }));
  if (!votes.length) return null;
  return (
    <section className="detail-section">
      <div className="section-heading">
        <h2>Vibes</h2>
        <span>Community votes</span>
      </div>
      <div className="vibe-tags">
        {votes.map((vote) => (
          <button
            key={vote.tag}
            className={`vibe-tag ${vote.userVoted ? "voted" : ""}`}
            onClick={() => onVote(vote.tag)}
          >
            <Sparkles size={14} />
            {vote.tag}
            <b>{vote.votes}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

function PhotoGallery({ beach }: { beach: Beach }) {
  const photos = beach.photos ?? [];
  if (!photos.length) return null;
  return (
    <section className="detail-section">
      <div className="section-heading">
        <h2>Gallery</h2>
        <span>Time of day</span>
      </div>
      <div className="photo-gallery" role="list">
        {photos.map((photo) => (
          <figure
            className="photo-tile"
            key={`${photo.timeOfDay}-${photo.caption}`}
            role="listitem"
          >
            <img
              src={photo.url}
              alt={`${beach.name} during ${photo.timeOfDay}`}
            />
            <figcaption>
              <strong>{photo.timeOfDay}</strong>
              <small>{photo.caption}</small>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function HazardList({ beach }: { beach: Beach }) {
  const hazards = beach.hazards ?? [];
  if (!hazards.length) return null;
  return (
    <section className="detail-section">
      <div className="section-heading">
        <h2>Hazards</h2>
        <span>Active alerts</span>
      </div>
      <div className="hazard-list">
        {hazards.map((hazard) => (
          <AlertBanner key={hazard.id} hazard={hazard} />
        ))}
      </div>
    </section>
  );
}

function DayQualityCard({ slug }: { slug?: string }) {
  const [quality, setQuality] = useState<{
    earlyMorning: { score: number; summary: string };
    midday: { score: number; summary: string };
    afternoon: { score: number; summary: string };
    evening: { score: number; summary: string };
    overall: number;
  } | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetchApiDayQuality(slug)
      .then(setQuality)
      .catch(() => undefined);
  }, [slug]);

  if (!quality) return null;
  const segments = [
    { label: "Early morning", data: quality.earlyMorning },
    { label: "Midday", data: quality.midday },
    { label: "Afternoon", data: quality.afternoon },
    { label: "Evening", data: quality.evening },
  ];
  const tone = (score: number) =>
    score >= 80
      ? "var(--green)"
      : score >= 50
        ? "var(--saffron, #e8a33d)"
        : "var(--coral-text)";

  return (
    <section className="detail-section day-quality-card">
      <div className="section-heading">
        <h2>Day quality score</h2>
        <span style={{ color: tone(quality.overall) }}>
          {quality.overall}/100
        </span>
      </div>
      <div className="day-quality-segments">
        {segments.map((seg) => (
          <div className="day-quality-segment" key={seg.label}>
            <span className="day-quality-label">{seg.label}</span>
            <span className="day-quality-bar">
              <i
                style={{
                  width: `${seg.data.score}%`,
                  background: tone(seg.data.score),
                }}
              />
            </span>
            <strong style={{ color: tone(seg.data.score) }}>
              {seg.data.score}
            </strong>
            <small>{seg.data.summary}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function CommunityReportSheet({
  beach,
  onClose,
}: {
  beach: Beach;
  onClose: () => void;
}) {
  const [sandType, setSandType] = useState("");
  const [sandColor, setSandColor] = useState("");
  const [sunbedPrice, setSunbedPrice] = useState("");
  const [umbrellaPrice, setUmbrellaPrice] = useState("");
  const [music, setMusic] = useState("");
  const [food, setFood] = useState("");
  const [showers, setShowers] = useState(false);
  const [changingRooms, setChangingRooms] = useState(false);
  const [toilets, setToilets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const report: Record<string, unknown> = {};
      if (sandType) report.sandType = sandType;
      if (sandColor) report.sandColor = sandColor;
      if (sunbedPrice) report.sunbedPrice = Number(sunbedPrice);
      if (umbrellaPrice) report.umbrellaPrice = Number(umbrellaPrice);
      if (music) report.music = music;
      if (food) report.food = food;
      if (showers) report.showers = true;
      if (changingRooms) report.changingRooms = true;
      if (toilets) report.toilets = true;
      await submitApiReport(beach.slug ?? beach.id, report as never);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.replaceAll("_", " ")
          : "Could not submit",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="booking-sheet">
        <div className="sheet-handle" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <span className="step-label">Community report</span>
        <h2>Confirm details at {beach.name}</h2>
        <p className="muted">
          Your reports improve the data for everyone. Fill in what you know.
        </p>

        <div className="trip-date-grid">
          <label className="trip-field">
            <span>Sand type</span>
            <select
              value={sandType}
              onChange={(e) => setSandType(e.target.value)}
            >
              <option value="">—</option>
              <option value="sand">Sand</option>
              <option value="pebble">Pebble</option>
              <option value="rock">Rock</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label className="trip-field">
            <span>Sand colour</span>
            <select
              value={sandColor}
              onChange={(e) => setSandColor(e.target.value)}
            >
              <option value="">—</option>
              <option value="white">White</option>
              <option value="golden">Golden</option>
              <option value="dark">Dark</option>
              <option value="red">Red</option>
              <option value="black">Black</option>
            </select>
          </label>
        </div>

        <div className="trip-date-grid">
          <label className="trip-field">
            <span>Sunbed price (€)</span>
            <input
              type="number"
              min={0}
              value={sunbedPrice}
              onChange={(e) => setSunbedPrice(e.target.value)}
              placeholder="e.g. 8"
            />
          </label>
          <label className="trip-field">
            <span>Umbrella price (€)</span>
            <input
              type="number"
              min={0}
              value={umbrellaPrice}
              onChange={(e) => setUmbrellaPrice(e.target.value)}
              placeholder="e.g. 5"
            />
          </label>
        </div>

        <div className="trip-date-grid">
          <label className="trip-field">
            <span>Music</span>
            <select value={music} onChange={(e) => setMusic(e.target.value)}>
              <option value="">—</option>
              <option value="none">None</option>
              <option value="background">Background</option>
              <option value="live">Live</option>
              <option value="club">Club/DJ</option>
            </select>
          </label>
          <label className="trip-field">
            <span>Food</span>
            <select value={food} onChange={(e) => setFood(e.target.value)}>
              <option value="">—</option>
              <option value="none">None</option>
              <option value="snack_bar">Snack bar</option>
              <option value="restaurant">Restaurant</option>
              <option value="both">Both</option>
            </select>
          </label>
        </div>

        <div className="filter-row">
          <button
            className={showers ? "active" : ""}
            onClick={() => setShowers(!showers)}
          >
            Showers
          </button>
          <button
            className={changingRooms ? "active" : ""}
            onClick={() => setChangingRooms(!changingRooms)}
          >
            Changing rooms
          </button>
          <button
            className={toilets ? "active" : ""}
            onClick={() => setToilets(!toilets)}
          >
            Toilets
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        <button
          className="primary-button sheet-primary"
          disabled={submitting}
          onClick={submit}
        >
          {submitting ? "Submitting…" : "Submit report"}
        </button>
      </section>
    </div>
  );
}

function SpotterCard({ slug }: { slug?: string }) {
  const [campaign, setCampaign] = useState<{
    public_id: string;
    goal_cents: number;
    raised_cents: number;
    status: string;
  } | null>(null);
  const [contributing, setContributing] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetchApiSpotterCampaign(slug)
      .then(setCampaign)
      .catch(() => undefined);
  }, [slug]);

  if (!campaign) return null;
  const pct = Math.min(
    100,
    Math.round((campaign.raised_cents / campaign.goal_cents) * 100),
  );
  const funded = campaign.status !== "open";

  return (
    <section className="detail-section spotter-card">
      <div className="section-heading">
        <h2>Spotter crowdfunding</h2>
        <span>{funded ? "Funded" : `${pct}% funded`}</span>
      </div>
      <p className="muted">
        Help fund a SoFar Spotter buoy for live, shore-accurate data at this
        beach. Contributors are credited when the buoy goes live.
      </p>
      <div className="light-score">
        <span className="light-bar">
          <i style={{ width: `${pct}%` }} />
        </span>
        <strong>
          €{Math.round(campaign.raised_cents / 100)} / €
          {Math.round(campaign.goal_cents / 100)}
        </strong>
      </div>
      <button
        className="primary-button sheet-primary"
        disabled={funded || contributing}
        onClick={async () => {
          setContributing(true);
          try {
            const result = await contributeApiSpotter(slug ?? "", 500);
            setCampaign((current) =>
              current
                ? {
                    ...current,
                    raised_cents: result.data.raised_cents,
                    status: result.data.status,
                  }
                : current,
            );
          } catch {
            /* offline tolerant */
          } finally {
            setContributing(false);
          }
        }}
      >
        {contributing ? "Contributing…" : "Contribute €5"}
      </button>
    </section>
  );
}

function BeachDetail({
  beach,
  isSaved,
  isPremium,
  onBack,
  onToggleSaved,
  onBook,
  onCheckIn,
  onAddToTrip,
  onOpenGoldenHour,
  onVoteVibe,
  onReportHazard,
  onReport,
  onToast,
}: {
  beach: Beach;
  isSaved: boolean;
  isPremium: boolean;
  onBack: () => void;
  onToggleSaved: () => void;
  onBook: () => void;
  onCheckIn: () => void;
  onAddToTrip: () => void;
  onOpenGoldenHour: () => void;
  onVoteVibe: (tag: string) => void;
  onReportHazard: () => void;
  onReport: () => void;
  onToast: (message: string) => void;
}) {
  const [tideExpanded, setTideExpanded] = useState(false);
  const amenityDetails =
    beach.amenityDetails ??
    beach.amenities.map((name) => ({
      name,
      verifiedAt: null,
      source: null,
    }));
  const gh = beach.goldenHourDetail;
  return (
    <div className="detail-screen">
      <AppHeader compact onBack={onBack} />
      <main className="screen-content">
        <div className="detail-hero">
          <img src={beach.image} alt={`View across ${beach.name}`} />
          <div className="detail-hero-actions">
            <button
              onClick={onToggleSaved}
              aria-label={isSaved ? "Unsave beach" : "Save beach"}
            >
              <Heart fill={isSaved ? "currentColor" : "none"} />
            </button>
            <button
              onClick={() => onToast("Share link copied")}
              aria-label="Share beach"
            >
              <Share2 />
            </button>
          </div>
        </div>
        <section className="detail-intro">
          <span className="match-score">{beach.match} Match</span>
          <h1>{beach.name}</h1>
          <p>{beach.decision}</p>
          <span className="detail-location">
            <MapPin /> {beach.location} · {beach.drive}
          </span>
          {beach.provenance?.blueFlag ? (
            <span className="blue-flag">
              <BadgeCheck /> Blue Flag beach
            </span>
          ) : null}
          <Freshness beach={beach} />
        </section>
        <SuitabilityRail beach={beach} onSelect={onToast} />
        <Conditions beach={beach} />
        <section className="detail-section">
          <div className="section-heading">
            <h2>Water quality</h2>
            <span>
              {beach.provenance?.blueFlag ? "Blue Flag" : "Monitored"}
            </span>
          </div>
          <div className="water-quality-row">
            <Droplet />
            <span>
              <strong>{beach.waterQuality}</strong>
              <small>
                {beach.provenance?.blueFlag
                  ? "Blue Flag certified for the current season."
                  : "Sampled by the local authority. No active advisory."}
              </small>
            </span>
          </div>
        </section>
        <Suspense fallback={null}>
          <TidePanel
            points={beach.tide?.points?.length ? beach.tide.points : tideData}
            expanded={tideExpanded}
            onToggle={() => setTideExpanded((current) => !current)}
          />
        </Suspense>
        <div className="action-list">
          <ActionRow
            icon={Sun}
            title="Golden Hour"
            subtitle={
              gh
                ? `${gh.sunrise}–${gh.sunset} · ${gh.direction}`
                : beach.goldenHour
            }
            trailing={
              gh?.lightScore != null ? `${gh.lightScore} light` : undefined
            }
            onClick={onOpenGoldenHour}
          />
        </div>
        <section className="detail-section">
          <div className="section-heading">
            <h2>What works here</h2>
            <span>Verified this week</span>
          </div>
          <div className="amenity-list">
            {amenityDetails.map((amenity) => (
              <span className="amenity-item" key={amenity.name}>
                <Check /> {amenity.name}
                {amenity.verifiedAt ? (
                  <small>Verified {amenity.verifiedAt}</small>
                ) : null}
              </span>
            ))}
          </div>
        </section>
        {beach.crowdForecast?.length ? (
          <section className="detail-section">
            <div className="section-heading">
              <h2>Crowd forecast</h2>
              <span>Today</span>
            </div>
            <div className="crowd-forecast">
              {beach.crowdForecast.map((point) => (
                <span className="forecast-bar" key={point.hour}>
                  <i style={{ height: `${point.crowd}%` }} />
                  <small>{point.hour}:00</small>
                  <b>{point.crowd}%</b>
                </span>
              ))}
            </div>
          </section>
        ) : null}
        <VibeVotes beach={beach} onVote={onVoteVibe} />
        <PhotoGallery beach={beach} />
        <HazardList beach={beach} />
        <DayQualityCard slug={beach.slug ?? beach.id} />
        <SpotterCard slug={beach.slug ?? beach.id} />
        <button className="text-button report-hazard" onClick={onReportHazard}>
          <Info /> Report a hazard at this beach
        </button>
        <button className="text-button" onClick={onReport}>
          <Check /> Confirm beach details
        </button>
        <section className="detail-section inventory-section">
          <div className="section-heading">
            <h2>Book for today</h2>
            <span>Live inventory</span>
          </div>
          <div className="inventory-row">
            <span>
              <Armchair /> Sunbeds
            </span>
            <strong>{beach.available.sunbeds} available</strong>
          </div>
          <div className="inventory-row">
            <span>
              <Umbrella /> Umbrellas
            </span>
            <strong>{beach.available.umbrellas} available</strong>
          </div>
        </section>
        <div className="sticky-actions">
          <button className="secondary-button" onClick={onCheckIn}>
            <MapPin /> Check in
          </button>
          <button className="secondary-button" onClick={onAddToTrip}>
            <Plus /> Add to trip
          </button>
          <button
            className="primary-button"
            onClick={onBook}
            disabled={beach.available.sunbeds + beach.available.umbrellas === 0}
          >
            Reserve <ChevronRight />
          </button>
        </div>
        {!isPremium ? (
          <button
            className="premium-upsell"
            onClick={() =>
              eventLog("premium_viewed", { source: "beach_detail" })
            }
          >
            <Crown /> Unlock 14-day forecasts and unlimited trips with Premium
          </button>
        ) : null}
      </main>
    </div>
  );
}

function GoldenHourDetail({
  beach,
  onBack,
  onToast,
}: {
  beach: Beach;
  onBack: () => void;
  onToast: (message: string) => void;
}) {
  const gh = beach.goldenHourDetail;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const [alertSaved, setAlertSaved] = useState(false);
  if (!gh) {
    return (
      <div className="detail-screen">
        <AppHeader compact onBack={onBack} />
        <main className="screen-content">
          <div className="screen-title">
            <h1>Golden Hour</h1>
            <p>{beach.goldenHour}</p>
          </div>
        </main>
      </div>
    );
  }
  const direction = gh.direction.toLowerCase();
  const compassRotation = direction.includes("east")
    ? 90
    : direction.includes("west")
      ? -90
      : 0;
  return (
    <div className="detail-screen">
      <AppHeader compact onBack={onBack} />
      <main className="screen-content golden-hour-screen">
        <div className="screen-title">
          <span className="merchant-kicker">
            Light direction · {gh.direction}
          </span>
          <h1>Golden Hour at {beach.name}</h1>
        </div>
        <div className="gh-compass" aria-hidden={reduceMotion}>
          <span
            className="compass-ring"
            style={{
              transform: reduceMotion
                ? undefined
                : `rotate(${compassRotation}deg)`,
            }}
          >
            <Sun size={56} fill="currentColor" />
          </span>
          <small>Sun sets toward {direction}</small>
        </div>
        <section className="gh-times">
          <span>
            <Sunrise fill="currentColor" /> Sunrise<strong>{gh.sunrise}</strong>
          </span>
          <span>
            <Sun fill="currentColor" /> Golden hour
            <strong>{beach.goldenHour}</strong>
          </span>
          <span>
            <Sunrise fill="currentColor" /> Sunset<strong>{gh.sunset}</strong>
          </span>
          <span>
            <Sunrise fill="currentColor" /> Blue hour
            <strong>{gh.blueHourEvening}</strong>
          </span>
        </section>
        <section className="detail-section">
          <div className="section-heading">
            <h2>Six-hour light score</h2>
            <span>Photography quality</span>
          </div>
          <div className="light-score">
            <span className="light-bar">
              <i style={{ width: `${gh.lightScore ?? 0}%` }} />
            </span>
            <strong>{gh.lightScore ?? "—"} / 100</strong>
          </div>
        </section>
        <button
          className={`primary-button ${alertSaved ? "saved" : ""}`}
          onClick={async () => {
            const next = !alertSaved;
            setAlertSaved(next);
            if (next) {
              eventLog("beach_saved", {
                beachId: beach.id,
                goldenHourAlert: true,
              });
              try {
                const result = await saveGoldenHourAlert(beach.id);
                if (result.data.newlyAwarded)
                  onToast("Golden Eye badge unlocked");
                else onToast("Golden Hour alert set");
              } catch {
                onToast("Golden Hour alert set");
              }
            } else {
              onToast("Golden Hour alert removed");
            }
          }}
        >
          {alertSaved ? <Check /> : <Sun />}{" "}
          {alertSaved ? "Alert saved" : "Save Golden Hour alert"}
        </button>
      </main>
    </div>
  );
}

function BookingSheet({
  beach,
  onClose,
  onComplete,
}: {
  beach: Beach;
  onClose: () => void;
  onComplete: (booking: Booking) => Promise<Booking>;
}) {
  const [step, setStep] = useState<"select" | "review" | "done">("select");
  const [sunbeds, setSunbeds] = useState(2);
  const [umbrellas, setUmbrellas] = useState(1);
  const nextSaturday = new Date();
  nextSaturday.setDate(
    nextSaturday.getDate() + ((6 - nextSaturday.getDay() + 7) % 7 || 7),
  );
  const [dateStr, setDateStr] = useState(
    nextSaturday.toISOString().slice(0, 10),
  );
  const [timeStr, setTimeStr] = useState("10:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [qrToken, setQrToken] = useState("");
  const total = bookingTotalEuros(sunbeds, umbrellas);

  useEffect(() => {
    eventLog("booking_started", { beachId: beach.id });
  }, [beach.id]);

  const startsAt = new Date(`${dateStr}T${timeStr}:00`);
  const dateLabel = isNaN(startsAt.getTime())
    ? "Select a date"
    : startsAt.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
  const booking: Booking = {
    id: `SS-${Date.now().toString().slice(-6)}`,
    beachId: beach.id,
    beachName: beach.name,
    date: dateLabel,
    time: timeStr,
    sunbeds,
    umbrellas,
    total,
    startsAt: isNaN(startsAt.getTime()) ? undefined : startsAt.toISOString(),
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="booking-sheet">
        <div className="sheet-handle" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        {step === "select" ? (
          <>
            <span className="step-label">1 of 3 · Pick</span>
            <h2>Reserve at {beach.name}</h2>
            <div className="trip-date-grid">
              <label className="trip-field">
                <span>Date</span>
                <input
                  type="date"
                  value={dateStr}
                  onChange={(event) => setDateStr(event.target.value)}
                />
              </label>
              <label className="trip-field">
                <span>Time</span>
                <input
                  type="time"
                  value={timeStr}
                  onChange={(event) => setTimeStr(event.target.value)}
                />
              </label>
            </div>
            <p className="muted">
              {dateLabel} · {timeStr}–
              {String(Number(timeStr.split(":")[0]) + 6).padStart(2, "0")}:00
            </p>
            <QuantityRow
              icon={Armchair}
              label="Sunbeds"
              price="€12 each"
              value={sunbeds}
              onChange={setSunbeds}
            />
            <QuantityRow
              icon={Umbrella}
              label="Umbrellas"
              price="€8 each"
              value={umbrellas}
              onChange={setUmbrellas}
            />
            <button
              className="primary-button sheet-primary"
              disabled={!dateStr || !timeStr}
              onClick={() => setStep("review")}
            >
              Review · €{total} <ChevronRight />
            </button>
          </>
        ) : null}
        {step === "review" ? (
          <>
            <span className="step-label">2 of 3 · Pay</span>
            <h2>Review your beach day</h2>
            <div className="order-summary">
              <span>{sunbeds} sunbeds</span>
              <strong>€{sunbeds * 12}</strong>
              <span>{umbrellas} umbrella</span>
              <strong>€{umbrellas * 8}</strong>
              <span>Service</span>
              <strong>€3</strong>
              <b>Total</b>
              <b>€{total}</b>
            </div>
            <p className="policy">
              Free cancellation until 24 hours before. 50% refund inside 24
              hours, subject to final legal review. Full prepayment secures your
              inventory.
            </p>
            <button
              className="primary-button sheet-primary"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                setError("");
                try {
                  const result = await onComplete(booking);
                  setQrToken(result.qrToken ?? "");
                  setStep("done");
                  eventLog("booking_completed", { beachId: beach.id, total });
                } catch (bookingError) {
                  setError(
                    bookingError instanceof Error
                      ? bookingError.message.replaceAll("_", " ")
                      : "Could not complete booking",
                  );
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "Securing inventory…" : `Pay €${total}`} <Ticket />
            </button>
            {error ? <p className="form-error">{error}</p> : null}
            <button className="text-button" onClick={() => setStep("select")}>
              Change items
            </button>
          </>
        ) : null}
        {step === "done" ? (
          <div className="booking-success">
            <span className="success-icon">
              <Check strokeWidth={3} />
            </span>
            <span className="step-label">3 of 3 · Confirmed</span>
            <h2>Your beach day is booked</h2>
            <p>
              {sunbeds} sunbeds + {umbrellas} umbrella · {dateLabel} {timeStr}
            </p>
            <div className="qr-card">
              <QRCodeSVG
                value={qrToken || JSON.stringify({ ...booking, signed: false })}
                size={136}
                bgColor="#FFFFFF"
                fgColor="#0F1E2E"
              />
              <span>Show this signed pass to the merchant at check-in</span>
            </div>
            <button className="primary-button sheet-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function QuantityRow({
  icon: Icon,
  label,
  price,
  value,
  onChange,
}: {
  icon: typeof Armchair;
  label: string;
  price: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="quantity-row">
      <span className="quantity-copy">
        <Icon />
        <span>
          <strong>{label}</strong>
          <small>{price}</small>
        </span>
      </span>
      <span className="stepper">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`Remove one ${label.toLowerCase()}`}
        >
          −
        </button>
        <b>{value}</b>
        <button
          onClick={() => onChange(value + 1)}
          aria-label={`Add one ${label.toLowerCase()}`}
        >
          <Plus />
        </button>
      </span>
    </div>
  );
}

function CheckInSheet({
  beach,
  onClose,
  onComplete,
}: {
  beach: Beach;
  onClose: () => void;
  onComplete: (photo?: { url: string; caption?: string }) => Promise<void>;
}) {
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [attachPhoto, setAttachPhoto] = useState(false);

  useEffect(() => {
    eventLog("check_in_started", { beachId: beach.id });
  }, [beach.id]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="booking-sheet checkin-sheet">
        <div className="sheet-handle" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        {!complete ? (
          <>
            <span className="checkin-map">
              <Navigation fill="currentColor" />
            </span>
            <h2>Check in at {beach.name}?</h2>
            <p>
              You are within 100 m. SunScout uses your location only for this
              check-in, then discards the precise point. No background location
              is ever collected.
            </p>
            <button
              type="button"
              className={`photo-toggle ${attachPhoto ? "on" : ""}`}
              onClick={() => setAttachPhoto((current) => !current)}
              aria-pressed={attachPhoto}
            >
              <Camera />{" "}
              {attachPhoto ? "Photo attached" : "Attach a photo check-in"}
            </button>
            <button
              className="primary-button sheet-primary"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                setError("");
                try {
                  await onComplete(
                    attachPhoto
                      ? {
                          url: `https://cdn.sunscout.local/checkins/${beach.slug ?? beach.id}.jpg`,
                          caption: `Check-in at ${beach.name}`,
                        }
                      : undefined,
                  );
                  setComplete(true);
                  eventLog("check_in_completed", {
                    beachId: beach.id,
                    photo: attachPhoto,
                  });
                } catch (checkInError) {
                  setError(
                    checkInError instanceof Error
                      ? checkInError.message.replaceAll("_", " ")
                      : "Could not check in",
                  );
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "Checking location…" : "Confirm check-in"}{" "}
              <MapPin />
            </button>
            {error ? <p className="form-error">{error}</p> : null}
          </>
        ) : (
          <div className="booking-success">
            <span className="success-icon">
              <Sparkles fill="currentColor" />
            </span>
            <h2>{beach.name} unlocked</h2>
            <p>
              +10 points. Your anonymized check-in helped refresh today's crowd
              level.
            </p>
            <button className="primary-button sheet-primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function HazardReportSheet({
  beach,
  onClose,
  onSubmit,
}: {
  beach: Beach;
  onClose: () => void;
  onSubmit: (input: {
    severity: "advisory" | "warning" | "danger";
    title: string;
    detail: string;
  }) => Promise<void>;
}) {
  const [severity, setSeverity] = useState<"advisory" | "warning" | "danger">(
    "advisory",
  );
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="booking-sheet">
        <div className="sheet-handle" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <span className="step-label">Community report</span>
        <h2>Report a hazard at {beach.name}</h2>
        <p className="muted">
          Reports are reviewed before going live. Your name is not shown.
        </p>
        <div className="filter-row" aria-label="Severity">
          {(["advisory", "warning", "danger"] as const).map((level) => (
            <button
              key={level}
              className={severity === level ? "active" : ""}
              onClick={() => setSeverity(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <label className="trip-field">
          <span>Title</span>
          <input
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Jellyfish near the rocks"
          />
        </label>
        <label className="trip-field">
          <span>What did you see?</span>
          <input
            value={detail}
            maxLength={500}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="A visitor reported jellyfish at the east end this morning."
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button
          className="primary-button sheet-primary"
          disabled={submitting || !title.trim() || !detail.trim()}
          onClick={async () => {
            setSubmitting(true);
            setError("");
            try {
              await onSubmit({
                severity,
                title: title.trim(),
                detail: detail.trim(),
              });
              onClose();
            } catch (submitError) {
              setError(
                submitError instanceof Error
                  ? submitError.message.replaceAll("_", " ")
                  : "Could not submit report",
              );
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? "Submitting…" : "Submit report"}
        </button>
      </section>
    </div>
  );
}

function CollectionScreen({
  title,
  subtitle,
  beachesToShow,
  onSelectBeach,
}: {
  title: string;
  subtitle: string;
  beachesToShow: Beach[];
  onSelectBeach: (beach: Beach) => void;
}) {
  return (
    <>
      <AppHeader compact />
      <main className="screen-content collection-screen">
        <div className="screen-title">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {beachesToShow.length ? (
          <div className="collection-list">
            {beachesToShow.map((beach) => (
              <button key={beach.id} onClick={() => onSelectBeach(beach)}>
                <img src={beach.image} alt="" />
                <span>
                  <strong>{beach.name}</strong>
                  <small>{beach.decision}</small>
                </span>
                <ChevronRight />
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Heart />
            <h2>No beaches here yet</h2>
            <p>Save a beach from Today or Discover and it will appear here.</p>
          </div>
        )}
      </main>
    </>
  );
}

function TripsScreen({
  trips,
  bookings,
  beachCatalog,
  isPremium,
  onCreate,
  onSelectBeach,
  onDownloadPack,
  onCancelBooking,
}: {
  trips: Trip[];
  bookings: Booking[];
  beachCatalog: Beach[];
  isPremium: boolean;
  onCreate: () => void;
  onSelectBeach: (beach: Beach) => void;
  onDownloadPack: (trip: Trip) => void;
  onCancelBooking: (booking: Booking) => void;
}) {
  const formatDate = (value?: string | null) =>
    value
      ? new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        })
      : null;

  const conditionsFor = (beachId: string) =>
    beachCatalog.find((beach) => beach.id === beachId);

  return (
    <>
      <AppHeader compact />
      <main className="screen-content trips-screen">
        <div className="screen-title trip-title">
          <span>
            <h1>My Trips</h1>
            <p>Plan a beach run, then keep bookings and conditions together.</p>
          </span>
          <button className="trip-add-button" onClick={onCreate}>
            <Plus /> New
          </button>
        </div>
        {trips.length ? (
          <div className="trip-list">
            {trips.map((trip) => (
              <section className="trip-card" key={trip.id}>
                <div className="trip-card-head">
                  <span>
                    <strong>{trip.name}</strong>
                    <small>
                      {formatDate(trip.startsOn)}
                      {trip.endsOn ? ` – ${formatDate(trip.endsOn)}` : ""}
                    </small>
                  </span>
                  {isPremium ? (
                    <button
                      className="trip-pack-button"
                      onClick={() => onDownloadPack(trip)}
                      aria-label={`Download offline pack for ${trip.name}`}
                    >
                      <Download /> Offline pack
                    </button>
                  ) : null}
                </div>
                <div className="trip-beaches">
                  {trip.beaches.map((tripBeach) => {
                    const snapshot = conditionsFor(tripBeach.id);
                    return (
                      <button
                        key={tripBeach.id}
                        onClick={() => snapshot && onSelectBeach(snapshot)}
                      >
                        <img src={snapshot?.image ?? ""} alt="" />
                        <span>
                          <strong>{tripBeach.name}</strong>
                          <small>
                            {snapshot
                              ? `Crowd ${snapshot.crowd}% · ${snapshot.seaTemp} · GH ${snapshot.goldenHour}`
                              : "Conditions unavailable"}
                          </small>
                        </span>
                        <ChevronRight />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="empty-state trip-empty">
            <ShoppingBag />
            <h2>Your coast is wide open</h2>
            <p>Create a trip and add the beaches you want to compare.</p>
            <button className="primary-button" onClick={onCreate}>
              <Plus /> Plan a trip
            </button>
          </div>
        )}
        {bookings.length ? (
          <section className="merchant-section">
            <div className="section-heading">
              <h2>Bookings</h2>
              <span>Stored under My Trips</span>
            </div>
            <div className="merchant-bookings">
              {bookings.map((booking) => (
                <article className="merchant-booking-card" key={booking.id}>
                  <span>
                    <strong>{booking.beachName}</strong>
                    <small>
                      {booking.sunbeds} sunbeds + {booking.umbrellas} umbrella ·{" "}
                      {booking.date} {booking.time}
                    </small>
                  </span>
                  <span className="booking-status">€{booking.total}</span>
                  <button
                    className="cancel-booking-btn"
                    onClick={() => onCancelBooking(booking)}
                  >
                    Cancel
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

function TripSheet({
  beachCatalog,
  preselected,
  onClose,
  onComplete,
}: {
  beachCatalog: Beach[];
  preselected: string[];
  onClose: () => void;
  onComplete: (input: {
    name: string;
    startsOn?: string;
    endsOn?: string;
    beachPublicIds: string[];
    locationLabel?: string;
    latitude?: number;
    longitude?: number;
    friendIds?: string[];
  }) => Promise<void>;
}) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  const [name, setName] = useState("Algarve beach weekend");
  const [startsOn, setStartsOn] = useState(tomorrow);
  const [endsOn, setEndsOn] = useState(tomorrow);
  const [selected, setSelected] = useState<string[]>(preselected);
  const [origin, setOrigin] = useState<{
    label: string;
    latitude: number;
    longitude: number;
  } | null>(PRESET_LOCATIONS[0] ?? null);
  const [audience, setAudience] = useState("");
  const [activities, setActivities] = useState<string[]>([]);
  const [friends, setFriends] = useState<
    Array<{ public_id: string; name: string; relationship: string }>
  >([]);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchFriends()
      .then(setFriends)
      .catch(() => undefined);
  }, []);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );

  const candidates = useMemo(() => {
    return beachCatalog
      .map((beach) => {
        const travel =
          origin && beach.latitude != null && beach.longitude != null
            ? travelFor(
                haversineKm(
                  origin.latitude,
                  origin.longitude,
                  beach.latitude,
                  beach.longitude,
                ),
              )
            : null;
        return { beach, travel };
      })
      .filter(({ beach }) =>
        activities.length
          ? activities.every((a) => (beach.activities ?? []).includes(a))
          : true,
      )
      .filter(
        ({ beach }) =>
          !audience || beach.suitability.some((item) => item.id === audience),
      )
      .sort((a, b) =>
        a.travel && b.travel
          ? a.travel.distanceKm - b.travel.distanceKm
          : b.beach.match - a.beach.match,
      );
  }, [beachCatalog, origin, audience, activities]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="booking-sheet trip-sheet"
        role="dialog"
        aria-modal="true"
      >
        <span className="sheet-handle" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <span className="step-label">New trip</span>
        <h2>Plan a beach run</h2>
        <p>
          Where are you staying? We'll show every beach nearby and how to get
          there, filtered by what your group wants to do.
        </p>
        <label className="trip-field">
          <span>Trip name</span>
          <input
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="trip-date-grid">
          <label className="trip-field">
            <span>Starts</span>
            <input
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </label>
          <label className="trip-field">
            <span>Ends</span>
            <input
              type="date"
              min={startsOn}
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
            />
          </label>
        </div>
        <div className="location-row">
          <MapPin />
          <span className="location-presets">
            {PRESET_LOCATIONS.map((place) => (
              <button
                key={place.label}
                className={origin?.label === place.label ? "active" : ""}
                onClick={() => setOrigin(place)}
              >
                {place.label}
              </button>
            ))}
          </span>
        </div>
        <div className="filter-row">
          <button
            className={audience === "" ? "active" : ""}
            onClick={() => setAudience("")}
          >
            Anyone
          </button>
          {AUDIENCE_OPTIONS.map((option) => (
            <button
              key={option}
              className={audience === option ? "active" : ""}
              onClick={() => setAudience(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="filter-row">
          {ACTIVITY_OPTIONS.map((option) => (
            <button
              key={option}
              className={activities.includes(option) ? "active" : ""}
              onClick={() =>
                setActivities((current) =>
                  current.includes(option)
                    ? current.filter((item) => item !== option)
                    : [...current, option],
                )
              }
            >
              {option.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        {origin ? (
          <Suspense fallback={null}>
            <BeachMap
              origin={origin}
              beaches={candidates.map((entry) => entry.beach)}
              selectedIds={selected}
              onSelect={(beach) => toggle(beach.id)}
            />
          </Suspense>
        ) : null}
        <div className="trip-picker">
          <strong>Beaches ({candidates.length})</strong>
          {candidates.map(({ beach, travel }) => {
            const isSelected = selected.includes(beach.id);
            return (
              <button
                key={beach.id}
                className={isSelected ? "selected" : ""}
                onClick={() => toggle(beach.id)}
              >
                <img src={beach.image} alt="" />
                <span>
                  <strong>{beach.name}</strong>
                  <small>
                    {travel
                      ? `${travel.distanceKm} km · ${travel.walkMinutes} min walk · ${travel.driveMinutes} min drive`
                      : beach.decision}
                  </small>
                </span>
                <i>{isSelected ? <Check /> : <Plus />}</i>
              </button>
            );
          })}
        </div>
        {friends.length ? (
          <div className="trip-picker">
            <strong>Who's coming ({friendIds.length})</strong>
            <div className="filter-row">
              {friends.map((friend) => (
                <button
                  key={friend.public_id}
                  className={
                    friendIds.includes(friend.public_id) ? "active" : ""
                  }
                  onClick={() =>
                    setFriendIds((current) =>
                      current.includes(friend.public_id)
                        ? current.filter((item) => item !== friend.public_id)
                        : [...current, friend.public_id],
                    )
                  }
                >
                  {friend.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <button
          className="primary-button sheet-primary"
          disabled={submitting || !name.trim() || !selected.length}
          onClick={async () => {
            setSubmitting(true);
            setError("");
            try {
              await onComplete({
                name: name.trim(),
                startsOn,
                endsOn,
                beachPublicIds: selected,
                locationLabel: origin?.label,
                latitude: origin?.latitude,
                longitude: origin?.longitude,
                friendIds,
              });
              onClose();
            } catch (submitError) {
              setError(
                submitError instanceof Error
                  ? submitError.message.replaceAll("_", " ")
                  : "Could not create trip",
              );
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting
            ? "Creating trip…"
            : `Create trip · ${selected.length} beaches`}
        </button>
      </section>
    </div>
  );
}

function MerchantScreen({
  onBack,
  onToast,
}: {
  onBack: () => void;
  onToast: (message: string) => void;
}) {
  const [dashboard, setDashboard] = useState<MerchantDashboard | null>(null);
  const [settlements, setSettlements] = useState<SettlementsResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [newType, setNewType] = useState<
    "sunbed" | "umbrella" | "cabana" | "activity"
  >("sunbed");
  const [newTotal, setNewTotal] = useState(10);
  const [newPrice, setNewPrice] = useState(12);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchMerchantDashboard(), fetchSettlements()]).then(
      ([dashboardResult, settlementsResult]) => {
        if (cancelled) return;
        if (dashboardResult.status === "fulfilled")
          setDashboard(dashboardResult.value);
        else onToast("Merchant data is unavailable");
        if (settlementsResult.status === "fulfilled")
          setSettlements(settlementsResult.value);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [onToast]);

  const changeAvailable = (id: string, change: number) => {
    setDashboard((current) =>
      current
        ? {
            ...current,
            inventory: current.inventory.map((item) =>
              item.public_id === id
                ? {
                    ...item,
                    available_count: Math.max(
                      0,
                      Math.min(item.total_count, item.available_count + change),
                    ),
                  }
                : item,
            ),
          }
        : current,
    );
  };

  return (
    <>
      <AppHeader compact onBack={onBack} />
      <main className="screen-content merchant-screen">
        <div className="screen-title">
          <span className="merchant-kicker">Merchant workspace</span>
          <h1>Beach-day operations</h1>
          <p>
            Manage today's stock, arrivals, and booking value across your
            locations.
          </p>
        </div>
        {loading ? (
          <div className="merchant-loading">Loading live operations…</div>
        ) : dashboard ? (
          <>
            <section className="merchant-summary">
              <span>
                <strong>{dashboard.summary.today_bookings}</strong>Today
              </span>
              <span>
                <strong>{dashboard.summary.upcoming_bookings}</strong>Upcoming
              </span>
              <span>
                <strong>
                  €{Math.round(dashboard.summary.weekly_gmv_cents / 100)}
                </strong>
                Weekly GMV
              </span>
              <span>
                <strong>{dashboard.summary.distinct_guests}</strong>Guests
              </span>
            </section>
            {settlements ? (
              <section className="merchant-section">
                <div className="section-heading">
                  <h2>Settlements</h2>
                  <span>
                    {settlements.summary.pending} pending ·{" "}
                    {settlements.summary.settled} settled
                  </span>
                </div>
                <div className="settlement-summary">
                  <span>
                    <strong>
                      €{Math.round(settlements.summary.net_payable / 100)}
                    </strong>
                    Net payable
                  </span>
                </div>
                <div className="merchant-bookings">
                  {settlements.settlements.slice(0, 8).map((row) => (
                    <article
                      className="merchant-booking-card"
                      key={row.public_id}
                    >
                      <span>
                        <strong>{row.beach_name}</strong>
                        <small>
                          Net €{row.net_cents / 100} · commission €
                          {row.commission_cents / 100}
                        </small>
                      </span>
                      <span className="booking-status">{row.status}</span>
                    </article>
                  ))}
                  {!settlements.settlements.length ? (
                    <p className="muted">No settlements yet.</p>
                  ) : null}
                </div>
              </section>
            ) : null}
            <section className="merchant-section">
              <div className="section-heading">
                <h2>Live inventory</h2>
                <span>{dashboard.summary.locations} locations</span>
              </div>
              <div className="merchant-inventory-list">
                {dashboard.inventory.map((item) => (
                  <article
                    className="merchant-inventory-card"
                    key={item.public_id}
                  >
                    <div>
                      <span className="inventory-icon">
                        {item.amenity_type === "umbrella" ? (
                          <Umbrella />
                        ) : (
                          <Armchair />
                        )}
                      </span>
                      <span>
                        <strong>{item.amenity_type}</strong>
                        <small>
                          {item.beach_name} · €{item.price_cents / 100}
                        </small>
                      </span>
                    </div>
                    <div className="merchant-stock-controls">
                      <button
                        onClick={() => changeAvailable(item.public_id, -1)}
                      >
                        −
                      </button>
                      <span>
                        <strong>{item.available_count}</strong> /{" "}
                        {item.total_count}
                      </span>
                      <button
                        onClick={() => changeAvailable(item.public_id, 1)}
                      >
                        +
                      </button>
                      <button
                        className="stock-save"
                        disabled={savingId === item.public_id}
                        onClick={async () => {
                          setSavingId(item.public_id);
                          try {
                            const result = await updateMerchantInventory(
                              item.public_id,
                              {
                                availableCount: item.available_count,
                                version: item.version,
                              },
                            );
                            setDashboard((current) =>
                              current
                                ? {
                                    ...current,
                                    inventory: current.inventory.map((line) =>
                                      line.public_id === item.public_id
                                        ? {
                                            ...line,
                                            available_count:
                                              result.data.available_count,
                                            price_cents:
                                              result.data.price_cents,
                                            version: result.data.version,
                                          }
                                        : line,
                                    ),
                                  }
                                : current,
                            );
                            onToast("Inventory updated");
                          } catch (error) {
                            onToast(
                              error instanceof Error
                                ? error.message.replaceAll("_", " ")
                                : "Inventory update failed",
                            );
                            const fresh = await fetchMerchantDashboard().catch(
                              () => null,
                            );
                            if (fresh) setDashboard(fresh);
                          } finally {
                            setSavingId("");
                          }
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <details className="add-inventory">
                <summary>Add inventory type</summary>
                <div className="trip-date-grid">
                  <label className="trip-field">
                    <span>Type</span>
                    <select
                      value={newType}
                      onChange={(event) =>
                        setNewType(
                          event.target.value as
                            | "sunbed"
                            | "umbrella"
                            | "cabana"
                            | "activity",
                        )
                      }
                    >
                      <option value="sunbed">Sunbed</option>
                      <option value="umbrella">Umbrella</option>
                      <option value="cabana">Cabana</option>
                      <option value="activity">Activity</option>
                    </select>
                  </label>
                  <label className="trip-field">
                    <span>Count</span>
                    <input
                      type="number"
                      min={0}
                      value={newTotal}
                      onChange={(event) =>
                        setNewTotal(Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="trip-field">
                    <span>Price €</span>
                    <input
                      type="number"
                      min={0}
                      value={newPrice}
                      onChange={(event) =>
                        setNewPrice(Number(event.target.value))
                      }
                    />
                  </label>
                </div>
                <button
                  className="primary-button sheet-primary"
                  disabled={adding || !dashboard.inventory[0]}
                  onClick={async () => {
                    const first = dashboard.inventory[0];
                    if (!first?.beach_public_id) return;
                    setAdding(true);
                    try {
                      await createMerchantInventory({
                        beachPublicId: first.beach_public_id,
                        amenityType: newType,
                        totalCount: newTotal,
                        priceCents: Math.round(newPrice * 100),
                      });
                      onToast("Inventory type added");
                      const fresh = await fetchMerchantDashboard().catch(
                        () => null,
                      );
                      if (fresh) setDashboard(fresh);
                    } catch (error) {
                      onToast(
                        error instanceof Error
                          ? error.message.replaceAll("_", " ")
                          : "Could not add inventory",
                      );
                    } finally {
                      setAdding(false);
                    }
                  }}
                >
                  {adding ? "Adding…" : "Add inventory"} <Plus />
                </button>
              </details>
            </section>
            <section className="merchant-section">
              <div className="section-heading">
                <h2>Today and upcoming bookings</h2>
                <span>Redeem with QR</span>
              </div>
              <div className="merchant-bookings">
                {dashboard.bookings.map((booking) => (
                  <article
                    className="merchant-booking-card"
                    key={booking.public_id}
                  >
                    <span>
                      <strong>{booking.beach_name}</strong>
                      <small>
                        {booking.guest_name} ·{" "}
                        {booking.items
                          .map((item) => `${item.quantity} ${item.type}`)
                          .join(", ")}
                      </small>
                    </span>
                    <span className="booking-status">{booking.status}</span>
                    <button
                      disabled={booking.status !== "confirmed"}
                      onClick={async () => {
                        try {
                          await redeemMerchantBooking(
                            booking.public_id,
                            booking.qr_token,
                          );
                          onToast("Booking redeemed");
                          const fresh = await fetchMerchantDashboard().catch(
                            () => null,
                          );
                          if (fresh) setDashboard(fresh);
                        } catch (error) {
                          onToast(
                            error instanceof Error
                              ? error.message.replaceAll("_", " ")
                              : "Redeem failed",
                          );
                        }
                      }}
                    >
                      Redeem
                    </button>
                  </article>
                ))}
                {!dashboard.bookings.length ? (
                  <p className="muted">No bookings yet.</p>
                ) : null}
              </div>
            </section>
          </>
        ) : (
          <div className="empty-state">
            <h2>Merchant data unavailable</h2>
            <p>Start the API and seed the database to view operations.</p>
          </div>
        )}
      </main>
    </>
  );
}

function PremiumModal({
  onClose,
  onUpgrade,
}: {
  onClose: () => void;
  onUpgrade: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    eventLog("premium_viewed", { source: "modal" });
  }, []);
  const benefits = [
    "Full discovery results, not just the first three",
    "14-day conditions and tide forecast",
    "Golden Hour alerts and unlimited trips",
    "Offline trip packs and ad-free experience",
  ];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="booking-sheet premium-sheet">
        <div className="sheet-handle" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <span className="merchant-kicker">SunScout Premium</span>
        <h2>Better beach days, €1.99/month</h2>
        <ul className="premium-benefits">
          {benefits.map((benefit) => (
            <li key={benefit}>
              <Check /> {benefit}
            </li>
          ))}
        </ul>
        <button
          className="primary-button sheet-primary"
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            try {
              await onUpgrade();
              onClose();
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? "Upgrading…" : "Start Premium (test mode)"} <Crown />
        </button>
        <button className="text-button" onClick={onClose}>
          Maybe later
        </button>
      </section>
    </div>
  );
}

function JournalScreen({ onBack }: { onBack: () => void }) {
  const [stats, setStats] = useState<{
    totalVisits: number;
    beachDays: number;
    distinctBeaches: number;
    moodBreakdown: Array<{ mood: string; count: number }>;
    topBeaches: Array<{ name: string; slug: string; visits: number }>;
    averageRatingGiven: string | null;
  } | null>(null);
  const [entries, setEntries] = useState<
    Array<{
      public_id: string;
      notes: string | null;
      mood: string | null;
      visited_on: string;
      name: string;
      slug: string;
      cover_photo_url: string;
    }>
  >([]);

  useEffect(() => {
    Promise.allSettled([fetchApiStats(), fetchApiJournal()]).then(
      ([statsResult, journalResult]) => {
        if (statsResult.status === "fulfilled") setStats(statsResult.value);
        if (journalResult.status === "fulfilled")
          setEntries(journalResult.value);
      },
    );
  }, []);

  const moodEmoji: Record<string, string> = {
    relaxed: "😌",
    energetic: "⚡",
    social: "🎉",
    adventurous: "🤿",
    family: "👨‍👩‍👧",
  };

  return (
    <>
      <AppHeader compact onBack={onBack} />
      <main className="screen-content journal-screen">
        <div className="screen-title">
          <span className="merchant-kicker">Personal tracker</span>
          <h1>My beach journal</h1>
          <p>Your beach days, visits, moods, and ratings.</p>
        </div>
        {stats ? (
          <>
            <section className="merchant-summary">
              <span>
                <strong>{stats.beachDays}</strong>Beach days
              </span>
              <span>
                <strong>{stats.distinctBeaches}</strong>Beaches visited
              </span>
              <span>
                <strong>{stats.totalVisits}</strong>Total check-ins
              </span>
              <span>
                <strong>{stats.averageRatingGiven ?? "—"}</strong>Avg rating
                given
              </span>
            </section>
            {stats.topBeaches.length ? (
              <section className="merchant-section">
                <div className="section-heading">
                  <h2>Most visited</h2>
                </div>
                <div className="portfolio-table">
                  {stats.topBeaches.map((beach) => (
                    <div className="portfolio-row" key={beach.slug}>
                      <span className="portfolio-name">
                        <strong>{beach.name}</strong>
                      </span>
                      <span className="portfolio-cell">
                        <b>{beach.visits}</b>
                        <small>visits</small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {stats.moodBreakdown.length ? (
              <section className="merchant-section">
                <div className="section-heading">
                  <h2>Mood breakdown</h2>
                </div>
                <div className="crowd-forecast">
                  {stats.moodBreakdown.map((mood) => (
                    <span className="forecast-bar" key={mood.mood}>
                      <i
                        style={{ height: `${Math.min(100, mood.count * 30)}%` }}
                      />
                      <small>{moodEmoji[mood.mood] ?? mood.mood}</small>
                      <b>{mood.count}</b>
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
        {entries.length ? (
          <section className="merchant-section">
            <div className="section-heading">
              <h2>Journal entries</h2>
              <span>{entries.length}</span>
            </div>
            <div className="collection-list">
              {entries.map((entry) => (
                <div className="journal-entry" key={entry.public_id}>
                  <img src={entry.cover_photo_url} alt="" />
                  <span>
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.visited_on} ·{" "}
                      {moodEmoji[entry.mood ?? ""] ?? entry.mood ?? ""}
                    </small>
                    {entry.notes ? (
                      <p className="journal-notes">{entry.notes}</p>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

function OpsScreen({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  useEffect(() => {
    fetchOpsStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  const flags: Array<[string, boolean | undefined]> = status
    ? [
        ["Auth adapter", status.auth_adapter_configured],
        ["Payments (Stripe)", status.payments_configured],
        ["Push (VAPID)", status.push_configured],
        ["Error tracking (Sentry)", status.error_tracking_configured],
      ]
    : [];
  return (
    <>
      <AppHeader compact onBack={onBack} />
      <main className="screen-content institution-screen">
        <div className="screen-title">
          <span className="merchant-kicker">Operational status</span>
          <h1>System health</h1>
          <p>Adapter configuration and live service status.</p>
        </div>
        {status ? (
          <>
            <section className="merchant-summary">
              <span>
                <strong>{status.status}</strong>Status
              </span>
              <span>
                <strong>{Math.round(status.uptime_seconds / 60)}</strong>Uptime
                (min)
              </span>
              <span>
                <strong>{status.beaches}</strong>Beaches
              </span>
              <span>
                <strong>{status.active_hazards}</strong>Active hazards
              </span>
            </section>
            <section className="merchant-section">
              <div className="section-heading">
                <h2>Adapter configuration</h2>
                <span>env-gated</span>
              </div>
              <div className="portfolio-table">
                {flags.map(([label, configured]) => (
                  <div className="portfolio-row" key={label}>
                    <span className="portfolio-name">
                      <strong>{label}</strong>
                    </span>
                    <span className="portfolio-cell">
                      <b
                        style={{
                          color: configured
                            ? "var(--green)"
                            : "var(--coral-text)",
                        }}
                      >
                        {configured ? "Live" : "Mocked"}
                      </b>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className="merchant-loading">Loading status…</div>
        )}
      </main>
    </>
  );
}

function InstitutionScreen({
  onBack,
  onToast,
}: {
  onBack: () => void;
  onToast: (message: string) => void;
}) {
  const [portfolio, setPortfolio] = useState<InstitutionPortfolio | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchInstitutionDashboard()
      .then((result) => {
        if (!cancelled) setPortfolio(result);
      })
      .catch(() => {
        if (!cancelled) onToast("Institutional data is unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onToast]);

  const embedToken = "algarve-public-status-2026";
  const [trendSlug, setTrendSlug] = useState("");
  const [trends, setTrends] = useState<
    Array<{
      day: string;
      avg_crowd: number | null;
      water_quality: string | null;
      samples: number;
    }>
  >([]);
  useEffect(() => {
    if (!trendSlug) return;
    fetchTrends(trendSlug)
      .then(setTrends)
      .catch(() => undefined);
  }, [trendSlug]);

  return (
    <>
      <AppHeader compact onBack={onBack} />
      <main className="screen-content institution-screen">
        <div className="screen-title">
          <span className="merchant-kicker">Institutional intelligence</span>
          <h1>Beach status portfolio</h1>
          <p>
            Anonymized, sourced condition status across your contracted region.
          </p>
        </div>
        {loading ? (
          <div className="merchant-loading">Loading portfolio…</div>
        ) : portfolio ? (
          <>
            <section className="merchant-summary">
              <span>
                <strong>{portfolio.beaches.length}</strong>Beaches
              </span>
              <span>
                <strong>{portfolio.contract.status}</strong>Contract
              </span>
              <span>
                <strong>{portfolio.contract.exports_used}</strong>Exports used
              </span>
            </section>
            <section className="merchant-section">
              <div className="section-heading">
                <h2>Portfolio status</h2>
                <span>
                  {portfolio.institution.region ?? portfolio.institution.name}
                </span>
              </div>
              <div className="portfolio-table" role="table">
                {portfolio.beaches.map((beach) => (
                  <div
                    className="portfolio-row"
                    key={beach.public_id}
                    role="row"
                  >
                    <span className="portfolio-name">
                      <strong>{beach.name}</strong>
                      <small>{beach.region}</small>
                    </span>
                    <span className="portfolio-cell">
                      <b>{beach.crowd_percent ?? "—"}%</b>
                      <small>crowd</small>
                    </span>
                    <span className="portfolio-cell">
                      <b>{beach.water_quality ?? "—"}</b>
                      <small>water</small>
                    </span>
                    <span className="portfolio-cell">
                      <b>{beach.hazard_count}</b>
                      <small>hazards</small>
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <section className="merchant-section">
              <div className="section-heading">
                <h2>Crowd and water-quality trends</h2>
                <span>30 days</span>
              </div>
              <select
                value={trendSlug}
                onChange={(event) => setTrendSlug(event.target.value)}
                className="trend-select"
              >
                <option value="">Select a beach…</option>
                {portfolio.beaches.map((beach) => (
                  <option key={beach.public_id} value={beach.slug}>
                    {beach.name}
                  </option>
                ))}
              </select>
              {trends.length ? (
                <div className="trend-chart">
                  {trends.map((point) => (
                    <span className="forecast-bar" key={point.day}>
                      <i
                        style={{
                          height: `${Math.min(100, point.avg_crowd ?? 0)}%`,
                        }}
                      />
                      <small>{point.day.slice(5)}</small>
                      <b>
                        {point.avg_crowd != null
                          ? `${Math.round(point.avg_crowd)}%`
                          : "—"}
                      </b>
                    </span>
                  ))}
                </div>
              ) : trendSlug ? (
                <p className="muted">No trend data yet for this beach.</p>
              ) : null}
            </section>
            <section className="merchant-section">
              <div className="section-heading">
                <h2>Exports</h2>
                <span>CSV · GeoJSON</span>
              </div>
              <div className="export-actions">
                <button
                  onClick={() => {
                    window.open(institutionExportUrl("csv"), "_blank");
                    onToast("CSV export downloaded");
                  }}
                >
                  <Download /> Download CSV
                </button>
                <button
                  onClick={() => {
                    window.open(institutionExportUrl("geojson"), "_blank");
                    onToast("GeoJSON export downloaded");
                  }}
                >
                  <Download /> Download GeoJSON
                </button>
              </div>
            </section>
            <section className="merchant-section">
              <div className="section-heading">
                <h2>Public status embed</h2>
                <span>iframe</span>
              </div>
              <p className="muted">
                Paste this snippet on a public site to show a live status board.
              </p>
              <code className="embed-snippet">{`<iframe src="${institutionEmbedUrl(embedToken)}" width="100%" height="420" frameborder="0" title="SunScout beach status"></iframe>`}</code>
            </section>
          </>
        ) : (
          <div className="empty-state">
            <h2>No institutional access</h2>
            <p>Your account is not linked to an institution contract.</p>
          </div>
        )}
      </main>
    </>
  );
}

function ClaimMerchantSheet({
  beachCatalog,
  onClose,
  onSubmit,
}: {
  beachCatalog: Beach[];
  onClose: () => void;
  onSubmit: (input: {
    beachPublicId: string;
    businessName: string;
  }) => Promise<void>;
}) {
  const [beachId, setBeachId] = useState(beachCatalog[0]?.id ?? "");
  const [businessName, setBusinessName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="booking-sheet">
        <div className="sheet-handle" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <span className="step-label">Merchant onboarding</span>
        <h2>Claim your beach</h2>
        <p className="muted">
          List your beach club or activity operator. Claims are reviewed before
          going live.
        </p>
        <label className="trip-field">
          <span>Beach</span>
          <select
            value={beachId}
            onChange={(event) => setBeachId(event.target.value)}
          >
            {beachCatalog.map((beach) => (
              <option key={beach.id} value={beach.id}>
                {beach.name}
              </option>
            ))}
          </select>
        </label>
        <label className="trip-field">
          <span>Business name</span>
          <input
            value={businessName}
            maxLength={120}
            onChange={(event) => setBusinessName(event.target.value)}
            placeholder="Coelha Beach Club"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button
          className="primary-button sheet-primary"
          disabled={submitting || !beachId || !businessName.trim()}
          onClick={async () => {
            setSubmitting(true);
            setError("");
            try {
              await onSubmit({
                beachPublicId: beachId,
                businessName: businessName.trim(),
              });
              onClose();
            } catch (submitError) {
              setError(
                submitError instanceof Error
                  ? submitError.message.replaceAll("_", " ")
                  : "Could not submit claim",
              );
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? "Submitting…" : "Submit claim"}
        </button>
      </section>
    </div>
  );
}

function ProfileScreen({
  profile,
  progress,
  notifications,
  onMerchant,
  onOpenPremium,
  onOpenInstitution,
  onOpenJournal,
  onOpenOps,
  onOpenClaim,
  onDeleteAccount,
  onMarkNotificationRead,
  onExportCalendar,
}: {
  profile: UserProfile | null;
  progress: Progress | null;
  notifications: AppNotification[];
  onMerchant: () => void;
  onOpenPremium: () => void;
  onOpenInstitution: () => void;
  onOpenJournal: () => void;
  onOpenOps: () => void;
  onOpenClaim: () => void;
  onDeleteAccount: () => void;
  onMarkNotificationRead: (id: string) => void;
  onExportCalendar: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [friends, setFriends] = useState<
    Array<{ public_id: string; name: string; relationship: string }>
  >([]);
  const [friendName, setFriendName] = useState("");
  const [friendRel, setFriendRel] = useState("friend");
  const points = progress?.points ?? 0;
  const badges = progress?.badges ?? [];
  const unread = notifications.filter((item) => !item.read_at);

  useEffect(() => {
    fetchFriends()
      .then(setFriends)
      .catch(() => undefined);
  }, []);

  const addCompanion = async () => {
    if (!friendName.trim()) return;
    try {
      await addFriend(friendName.trim(), friendRel);
      setFriends(await fetchFriends());
      setFriendName("");
    } catch {
      /* offline tolerant */
    }
  };
  return (
    <>
      <AppHeader compact />
      <main className="screen-content profile-screen">
        <div className="profile-hero">
          <span className="avatar">M</span>
          <div>
            <h1>{profile?.display_name ?? "Maya"}</h1>
            <p>
              Coastal Local · {points} points
              {profile?.is_premium ? " · Premium" : ""}
            </p>
          </div>
        </div>
        <div className="profile-stats">
          <span>
            <strong>{badges.length}</strong> badges
          </span>
          <span>
            <strong>{points}</strong> points
          </span>
          <span>
            <strong>{unread.length}</strong> alerts
          </span>
        </div>
        {profile && !profile.is_premium ? (
          <button className="premium-card" onClick={onOpenPremium}>
            <Crown />
            <span>
              <strong>Go Premium</strong>
              <small>
                Full discovery, forecasts and unlimited trips — €1.99/month
              </small>
            </span>
            <ChevronRight />
          </button>
        ) : null}
        {badges.length ? (
          <section className="profile-section">
            <h2>Badges</h2>
            <div className="badge-grid">
              {badges.map((badge) => (
                <span className="badge-chip" key={badge.public_id}>
                  <Medal /> {badge.name}
                  <small>{badge.description}</small>
                </span>
              ))}
            </div>
          </section>
        ) : null}
        {notifications.length ? (
          <section className="profile-section">
            <h2>Notifications</h2>
            <div className="notification-list">
              {notifications.slice(0, 8).map((item) => (
                <button
                  className={`notification-item ${item.read_at ? "read" : "unread"}`}
                  key={item.public_id}
                  onClick={() =>
                    !item.read_at && onMarkNotificationRead(item.public_id)
                  }
                >
                  <Bell />
                  <span>
                    <strong>{item.title}</strong>
                    {item.body ? <small>{item.body}</small> : null}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <section className="profile-section">
          <h2>Companions</h2>
          <p className="muted">
            Add family and friends so trips can be planned for the whole group.
          </p>
          <div className="friend-list">
            {friends.map((friend) => (
              <span className="friend-chip" key={friend.public_id}>
                <Users size={15} /> {friend.name}
                <small>{friend.relationship}</small>
                <button
                  onClick={async () => {
                    await deleteFriend(friend.public_id).catch(() => undefined);
                    setFriends((current) =>
                      current.filter(
                        (item) => item.public_id !== friend.public_id,
                      ),
                    );
                  }}
                  aria-label={`Remove ${friend.name}`}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
            {!friends.length ? (
              <small className="muted">No companions yet.</small>
            ) : null}
          </div>
          <div className="friend-add">
            <input
              value={friendName}
              maxLength={80}
              onChange={(event) => setFriendName(event.target.value)}
              placeholder="Add a companion by name"
            />
            <select
              value={friendRel}
              onChange={(event) => setFriendRel(event.target.value)}
            >
              <option value="friend">Friend</option>
              <option value="family">Family</option>
              <option value="partner">Partner</option>
              <option value="kid">Kid</option>
              <option value="solo">Solo</option>
            </select>
            <button className="primary-button" onClick={addCompanion}>
              <Plus size={16} /> Add
            </button>
          </div>
        </section>
        <section className="profile-section">
          <h2>Your preferences</h2>
          <button>
            <Users /> Family profile <ChevronRight />
          </button>
          <button>
            <Accessibility /> Accessibility <ChevronRight />
          </button>
          <button onClick={onExportCalendar}>
            <Calendar /> Export bookings to calendar <ChevronRight />
          </button>
          <button onClick={onOpenJournal}>
            <BookOpen /> My beach journal
          </button>
          <button onClick={onOpenOps}>
            <Activity /> Operational status <ChevronRight />
          </button>
          <button onClick={onOpenInstitution}>
            <Compass /> Institutional dashboard <ChevronRight />
          </button>
          <button onClick={onMerchant}>
            <Armchair /> Merchant dashboard <ChevronRight />
          </button>
          <button>
            <LogOut /> Sign out <ChevronRight />
          </button>
        </section>
        <section className="profile-section danger-section">
          <h2>Privacy and data</h2>
          {!confirmingDelete ? (
            <button
              className="danger-button"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 /> Delete account and data
            </button>
          ) : (
            <div className="delete-confirm">
              <p>
                This erases your profile, saved beaches, trips, check-ins, votes
                and badges. This cannot be undone.
              </p>
              <div className="delete-confirm-actions">
                <button
                  className="text-button"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
                <button className="danger-button" onClick={onDeleteAccount}>
                  Confirm delete
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>("today");
  const [selectedBeach, setSelectedBeach] = useState<Beach | null>(null);
  const [goldenHourBeach, setGoldenHourBeach] = useState<Beach | null>(null);
  const [bookingBeach, setBookingBeach] = useState<Beach | null>(null);
  const [checkInBeach, setCheckInBeach] = useState<Beach | null>(null);
  const [hazardReportBeach, setHazardReportBeach] = useState<Beach | null>(
    null,
  );
  const [reportBeach, setReportBeach] = useState<Beach | null>(null);
  const [tripSheetOpen, setTripSheetOpen] = useState(false);
  const [tripPreselect, setTripPreselect] = useState<string[]>([]);
  const [merchantOpen, setMerchantOpen] = useState(false);
  const [institutionOpen, setInstitutionOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [beachCatalog, setBeachCatalog] = useState<Beach[]>(fallbackBeaches);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isPremium, setIsPremium] = useStoredState<boolean>(
    "sunscout:premium",
    false,
  );
  const [savedIds, setSavedIds] = useStoredState<string[]>(
    "sunscout:saved",
    [],
  );
  const [bookings, setBookings] = useStoredState<Booking[]>(
    "sunscout:bookings",
    [],
  );
  const [trips, setTrips] = useState<Trip[]>([]);
  const homeBeach = beachCatalog[0] ?? fallbackBeaches[0];

  useEffect(() => {
    eventLog("app_opened", { tab: "today" });
  }, []);

  const refreshProgress = useCallback(() => {
    Promise.allSettled([fetchProgress(), fetchNotifications()]).then(
      ([progressResult, notificationsResult]) => {
        if (progressResult.status === "fulfilled")
          setProgress(progressResult.value);
        if (notificationsResult.status === "fulfilled")
          setNotifications(notificationsResult.value);
      },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetchBeaches(),
      fetchSavedBeachIds(),
      fetchBookings(),
      fetchTrips(),
      fetchMe(),
      fetchProgress(),
      fetchNotifications(),
    ]).then(
      ([
        beachResult,
        savedResult,
        bookingResult,
        tripResult,
        meResult,
        progressResult,
        notificationsResult,
      ]) => {
        if (cancelled) return;
        if (beachResult.status === "fulfilled" && beachResult.value.length) {
          setBeachCatalog(beachResult.value);
        }
        if (savedResult.status === "fulfilled") {
          setSavedIds(savedResult.value);
        }
        if (bookingResult.status === "fulfilled") {
          setBookings(bookingResult.value);
        }
        if (tripResult.status === "fulfilled") {
          setTrips(tripResult.value);
        }
        if (meResult.status === "fulfilled" && meResult.value) {
          setProfile(meResult.value);
          setIsPremium(meResult.value.is_premium);
        }
        if (progressResult.status === "fulfilled") {
          setProgress(progressResult.value);
        }
        if (notificationsResult.status === "fulfilled") {
          setNotifications(notificationsResult.value);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [setBookings, setSavedIds, setIsPremium]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  const toggleSaved = (id: string) => {
    setSavedIds((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      const guard = canSaveBeach(current.length, isPremium);
      if (!guard.ok && !current.includes(id)) {
        showToast("Saved beaches cap is 50 on free tier");
        setPremiumOpen(true);
        return current;
      }
      eventLog("beach_saved", { beachId: id, saved: next.includes(id) });
      void apiSetSaved(id, next.includes(id)).catch(() => undefined);
      return next;
    });
  };

  const selectBeach = (beach: Beach) => {
    setSelectedBeach(beach);
    eventLog("discovery_result_opened", { beachId: beach.id });
  };

  const openTab = (tab: TabId) => {
    setSelectedBeach(null);
    setGoldenHourBeach(null);
    setInstitutionOpen(false);
    setOpsOpen(false);
    setJournalOpen(false);
    setActiveTab(tab);
  };

  const voteVibe = async (tag: string) => {
    if (!selectedBeach) return;
    const beachId = selectedBeach.id;
    try {
      const result = await apiVoteVibe(beachId, tag);
      setSelectedBeach((current) =>
        current
          ? {
              ...current,
              vibeVotes: (current.vibeVotes ?? []).map((vote) =>
                vote.tag === tag
                  ? {
                      ...vote,
                      userVoted: result.data.voted,
                      votes:
                        result.data.votes.find((v) => v.tag === tag)?.votes ??
                        vote.votes,
                    }
                  : {
                      ...vote,
                      userVoted: false,
                      votes:
                        result.data.votes.find((v) => v.tag === vote.tag)
                          ?.votes ?? vote.votes,
                    },
              ),
            }
          : current,
      );
      showToast(
        result.data.voted ? `Voted for ${tag}` : `Removed vote for ${tag}`,
      );
    } catch {
      setSelectedBeach((current) =>
        current
          ? {
              ...current,
              vibeVotes: (current.vibeVotes ?? []).map((vote) =>
                vote.tag === tag
                  ? {
                      ...vote,
                      userVoted: !vote.userVoted,
                      votes: Math.max(
                        0,
                        vote.votes + (vote.userVoted ? -1 : 1),
                      ),
                    }
                  : vote,
              ),
            }
          : current,
      );
      showToast(`Voted for ${tag}`);
    }
  };

  const startTrip = (preselected: string[] = []) => {
    const activeTrips = trips.filter((trip) => trip.status === "active");
    if (!canCreateTrip(activeTrips.length, isPremium).ok) {
      showToast("Free tier allows one active trip");
      setPremiumOpen(true);
      return;
    }
    setTripPreselect(preselected);
    setTripSheetOpen(true);
  };

  const savedBeaches = beachCatalog.filter((beach) =>
    savedIds.includes(beach.id),
  );
  let screen;
  if (merchantOpen) {
    screen = (
      <MerchantScreen
        onBack={() => setMerchantOpen(false)}
        onToast={showToast}
      />
    );
  } else if (journalOpen) {
    screen = <JournalScreen onBack={() => setJournalOpen(false)} />;
  } else if (opsOpen) {
    screen = <OpsScreen onBack={() => setOpsOpen(false)} />;
  } else if (institutionOpen) {
    screen = (
      <InstitutionScreen
        onBack={() => setInstitutionOpen(false)}
        onToast={showToast}
      />
    );
  } else if (goldenHourBeach) {
    screen = (
      <GoldenHourDetail
        beach={goldenHourBeach}
        onBack={() => setGoldenHourBeach(null)}
        onToast={showToast}
      />
    );
  } else if (selectedBeach) {
    screen = (
      <BeachDetail
        beach={selectedBeach}
        isSaved={savedIds.includes(selectedBeach.id)}
        isPremium={isPremium}
        onBack={() => setSelectedBeach(null)}
        onToggleSaved={() => toggleSaved(selectedBeach.id)}
        onBook={() => setBookingBeach(selectedBeach)}
        onCheckIn={() => setCheckInBeach(selectedBeach)}
        onAddToTrip={() => startTrip([selectedBeach.id])}
        onOpenGoldenHour={() => setGoldenHourBeach(selectedBeach)}
        onVoteVibe={voteVibe}
        onReportHazard={() => setHazardReportBeach(selectedBeach)}
        onReport={() => setReportBeach(selectedBeach)}
        onToast={showToast}
      />
    );
  } else if (activeTab === "today") {
    screen = (
      <TodayScreen
        beach={homeBeach}
        isSaved={savedIds.includes(homeBeach.id)}
        booking={bookings[0]}
        onToggleSaved={() => toggleSaved(homeBeach.id)}
        onViewBeach={() => selectBeach(homeBeach)}
        onDiscover={() => openTab("discover")}
        onOpenBooking={() => setBookingBeach(homeBeach)}
        onCancelBooking={async () => {
          const upcoming = bookings[0];
          if (!upcoming) return;
          try {
            const result = await cancelApiBooking(upcoming.id);
            setBookings((current) =>
              current.filter((item) => item.id !== upcoming.id),
            );
            showToast(`Booking cancelled · ${result.data.tier} refund`);
          } catch (error) {
            showToast(
              error instanceof Error
                ? error.message.replaceAll("_", " ")
                : "Could not cancel",
            );
          }
        }}
        onOpenGoldenHour={() => setGoldenHourBeach(homeBeach)}
        onToast={showToast}
      />
    );
  } else if (activeTab === "discover") {
    screen = (
      <DiscoverScreen
        beachCatalog={beachCatalog}
        savedIds={savedIds}
        isPremium={isPremium}
        onToggleSaved={toggleSaved}
        onSelectBeach={selectBeach}
        onOpenPremium={() => setPremiumOpen(true)}
      />
    );
  } else if (activeTab === "trips") {
    screen = (
      <TripsScreen
        trips={trips}
        bookings={bookings}
        beachCatalog={beachCatalog}
        isPremium={isPremium}
        onCreate={() => startTrip()}
        onSelectBeach={selectBeach}
        onCancelBooking={async (booking) => {
          try {
            const result = await cancelApiBooking(booking.id);
            setBookings((current) =>
              current.filter((item) => item.id !== booking.id),
            );
            showToast(`Booking cancelled · ${result.data.tier} refund`);
          } catch (error) {
            showToast(
              error instanceof Error
                ? error.message.replaceAll("_", " ")
                : "Could not cancel",
            );
          }
        }}
        onDownloadPack={async (trip) => {
          const pack = await fetchTripPack(trip.id);
          if (!pack) {
            showToast("Offline pack needs Premium");
            setPremiumOpen(true);
            return;
          }
          const blob = new Blob([JSON.stringify(pack, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `sunscout-trip-${trip.id}.json`;
          link.click();
          URL.revokeObjectURL(url);
          eventLog("beach_saved", { tripPack: trip.id });
          showToast("Offline trip pack downloaded");
        }}
      />
    );
  } else if (activeTab === "saved") {
    screen = (
      <CollectionScreen
        title="Saved beaches"
        subtitle="Watch crowd and conditions before you choose the day."
        beachesToShow={savedBeaches}
        onSelectBeach={selectBeach}
      />
    );
  } else {
    screen = (
      <ProfileScreen
        profile={profile}
        progress={progress}
        notifications={notifications}
        onMerchant={() => setMerchantOpen(true)}
        onOpenPremium={() => setPremiumOpen(true)}
        onOpenInstitution={() => setInstitutionOpen(true)}
        onOpenJournal={() => setJournalOpen(true)}
        onOpenOps={() => setOpsOpen(true)}
        onOpenClaim={() => setClaimOpen(true)}
        onMarkNotificationRead={async (id) => {
          setNotifications((current) =>
            current.map((item) =>
              item.public_id === id
                ? { ...item, read_at: new Date().toISOString() }
                : item,
            ),
          );
          try {
            await markNotificationRead(id);
          } catch {
            /* offline tolerant */
          }
        }}
        onExportCalendar={() => {
          window.open(bookingsCalendarUrl(), "_blank");
          showToast("Calendar export opened");
        }}
        onDeleteAccount={async () => {
          try {
            await deleteApiAccount();
          } catch {
            /* fall through to local wipe */
          }
          localStorage.removeItem("sunscout:saved");
          localStorage.removeItem("sunscout:bookings");
          localStorage.removeItem("sunscout:premium");
          setSavedIds([]);
          setBookings([]);
          setIsPremium(false);
          setProgress(null);
          setNotifications([]);
          showToast("Account and local data deleted");
          openTab("today");
        }}
      />
    );
  }

  return (
    <div className="site-shell">
      <div className="app-frame">
        {screen}
        {!selectedBeach &&
        !merchantOpen &&
        !institutionOpen &&
        !goldenHourBeach ? (
          <BottomNav active={activeTab} onChange={openTab} />
        ) : null}
        {toast ? (
          <div className="toast" role="status">
            {toast}
          </div>
        ) : null}
      </div>
      {bookingBeach ? (
        <BookingSheet
          beach={bookingBeach}
          onClose={() => setBookingBeach(null)}
          onComplete={async (booking) => {
            try {
              const result = await createApiBooking(
                booking.beachId,
                booking.sunbeds,
                booking.umbrellas,
                booking.startsAt ? new Date(booking.startsAt) : undefined,
              );
              const confirmed = {
                ...booking,
                id: result.data.id,
                total: result.data.totalCents / 100,
                qrToken: result.data.qrToken,
              };
              setBookings((current) => [confirmed, ...current]);
              refreshProgress();
              return confirmed;
            } catch (error) {
              if (!(error instanceof TypeError)) throw error;
              setBookings((current) => [booking, ...current]);
              return booking;
            }
          }}
        />
      ) : null}
      {checkInBeach ? (
        <CheckInSheet
          beach={checkInBeach}
          onClose={() => setCheckInBeach(null)}
          onComplete={async (photo) => {
            try {
              await createApiCheckIn(checkInBeach.id, photo);
            } catch (error) {
              if (!(error instanceof TypeError)) throw error;
            }
            showToast(
              photo ? "+10 points · photo check-in logged" : "+10 points added",
            );
            refreshProgress();
          }}
        />
      ) : null}
      {reportBeach ? (
        <CommunityReportSheet
          beach={reportBeach}
          onClose={() => setReportBeach(null)}
        />
      ) : null}
      {hazardReportBeach ? (
        <HazardReportSheet
          beach={hazardReportBeach}
          onClose={() => setHazardReportBeach(null)}
          onSubmit={async (input) => {
            try {
              await reportApiHazard({
                beachPublicId: hazardReportBeach.id,
                ...input,
              });
              showToast("Hazard report submitted for review");
            } catch (error) {
              if (error instanceof TypeError) {
                showToast("Hazard report submitted for review");
              } else {
                throw error;
              }
            }
          }}
        />
      ) : null}
      {tripSheetOpen ? (
        <TripSheet
          beachCatalog={beachCatalog}
          preselected={tripPreselect}
          onClose={() => setTripSheetOpen(false)}
          onComplete={async (input) => {
            try {
              await createApiTrip(input);
              setTrips(await fetchTrips());
            } catch (error) {
              if (!(error instanceof TypeError)) throw error;
              setTrips((current) => [
                {
                  id: crypto.randomUUID(),
                  name: input.name,
                  startsOn: input.startsOn,
                  endsOn: input.endsOn,
                  status: "active",
                  beaches: input.beachPublicIds
                    .map((id) => beachCatalog.find((beach) => beach.id === id))
                    .filter(Boolean)
                    .map((beach) => ({
                      id: beach!.id,
                      slug: beach!.slug ?? beach!.id,
                      name: beach!.name,
                    })),
                },
                ...current,
              ]);
            }
            eventLog("trip_created", {
              name: input.name,
              beaches: input.beachPublicIds.length,
            });
            showToast("Trip created");
          }}
        />
      ) : null}
      {premiumOpen ? (
        <PremiumModal
          onClose={() => setPremiumOpen(false)}
          onUpgrade={async () => {
            try {
              const next = await setApiPremium(true);
              setIsPremium(next);
              setProfile((current) =>
                current ? { ...current, is_premium: next } : current,
              );
            } catch {
              setIsPremium(true);
            }
            showToast("Premium unlocked (test mode)");
          }}
        />
      ) : null}
      {claimOpen ? (
        <ClaimMerchantSheet
          beachCatalog={beachCatalog}
          onClose={() => setClaimOpen(false)}
          onSubmit={async (input) => {
            try {
              await claimApiMerchant(input);
              showToast("Beach claim submitted for review");
            } catch (error) {
              if (error instanceof TypeError) {
                showToast("Beach claim submitted for review");
              } else {
                throw error;
              }
            }
          }}
        />
      ) : null}
    </div>
  );
}
