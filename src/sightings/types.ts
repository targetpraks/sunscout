/**
 * Client-side mirror of the ephemeral beach-scoped Sightings domain.
 *
 * The root tsconfig includes only `src` and the server project has
 * `rootDir: "."`, so the client cannot import from `server/sightings.ts`.
 * The types and the pure expiry/freshness/selector functions below are
 * deliberate mirrors of the server module — identical semantics, no
 * cross-root import.
 *
 * All time-dependent helpers take `now` explicitly so rendering stays
 * deterministic and testable.
 */

export const SIGHTING_TTL_DAYS = 7;
export const SIGHTING_TTL_MS = SIGHTING_TTL_DAYS * 24 * 60 * 60 * 1000;
export const SIGHTING_FRESHNESS_HALF_LIFE_MS = 3.5 * 24 * 60 * 60 * 1000;
export const SIGHTING_CAPTION_MAX_CHARS = 280;

export type SightingMediaForm = "native" | "link";
export type SightingModerationState = "pending" | "approved" | "rejected";
export type SightingAudience =
  | "family"
  | "friends"
  | "solo"
  | "couple"
  | "group"
  | "beach-club";
export type SightingTimeOfDay =
  | "sunrise"
  | "morning"
  | "midday"
  | "afternoon"
  | "golden-hour"
  | "dusk"
  | "night";

export const SIGHTING_AUDIENCES: readonly SightingAudience[] = [
  "family",
  "friends",
  "solo",
  "couple",
  "group",
  "beach-club",
];

export const SIGHTING_TIMES_OF_DAY: readonly SightingTimeOfDay[] = [
  "sunrise",
  "morning",
  "midday",
  "afternoon",
  "golden-hour",
  "dusk",
  "night",
];

export const SIGHTING_MODERATION_STATES: readonly SightingModerationState[] = [
  "pending",
  "approved",
  "rejected",
];

export type NativeMedia = {
  form: "native";
  url: string;
  mimeType: string;
};

export type OutboundSocialLink = {
  form: "link";
  platform: "tiktok" | "instagram";
  url: string;
  attribution: string;
};

export type SightingMedia = NativeMedia | OutboundSocialLink;

export type SightingConsent = {
  peopleInFrame: boolean;
  peopleConsent: boolean;
};

/** Client view of a sighting. Timestamps are ISO strings over the wire. */
export type Sighting = {
  id: string;
  beachId: string;
  audience: SightingAudience;
  timeOfDay: SightingTimeOfDay | null;
  moderationState: SightingModerationState;
  consent: SightingConsent;
  media: SightingMedia;
  caption: string | null;
  capturedAt: string;
  /** Native media only; link sightings never auto-expire. */
  expiresAt: string | null;
};

/** Capture-form payload posted to the API. Exactly one media form. */
export type NewSightingInput = {
  beachId: string;
  audience: SightingAudience;
  timeOfDay?: SightingTimeOfDay | null;
  consent: SightingConsent;
  caption?: string | null;
  nativeMedia?: { url: string; mimeType: string };
  socialLink?: {
    platform: "tiktok" | "instagram";
    url: string;
    attribution: string;
  };
};

export function isExpiredSighting(sighting: Sighting, now: Date): boolean {
  if (sighting.expiresAt === null) return false;
  return now.getTime() >= new Date(sighting.expiresAt).getTime();
}

/**
 * Freshness weight in [0, 1] for Pulse recency. Mirrors the server:
 * native media drops to 0 at expiry; link sightings persist but decay
 * monotonically (half-life SIGHTING_FRESHNESS_HALF_LIFE_MS).
 */
export function freshnessWeight(sighting: Sighting, now: Date): number {
  if (isExpiredSighting(sighting, now)) return 0;
  const ageMs = Math.max(
    0,
    now.getTime() - new Date(sighting.capturedAt).getTime(),
  );
  return Math.pow(0.5, ageMs / SIGHTING_FRESHNESS_HALF_LIFE_MS);
}

/**
 * Expiry- and moderation-aware rail selector: excludes expired and
 * non-approved sightings, sorts most recent first, caps at `limit`.
 */
export function selectRailSightings(
  sightings: Sighting[],
  options: { now: Date; limit: number; beachId?: string },
): Sighting[] {
  const { now, limit } = options;
  return sightings
    .filter((sighting) => sighting.moderationState === "approved")
    .filter((sighting) => !isExpiredSighting(sighting, now))
    .filter(
      (sighting) =>
        options.beachId === undefined || sighting.beachId === options.beachId,
    )
    .sort(
      (a, b) =>
        new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
    )
    .slice(0, Math.max(0, limit));
}

/** Compact human age for rail labels, e.g. "2h ago", "3d ago". */
export function formatSightingAge(capturedAt: string, now: Date): string {
  const ageMs = Math.max(0, now.getTime() - new Date(capturedAt).getTime());
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function isAllowedSocialUrl(platform: string, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const suffix = platform === "tiktok" ? "tiktok.com" : "instagram.com";
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}

/**
 * Client-side pre-flight validation mirroring the server rules. Used by
 * the capture form for immediate feedback; the server remains the source
 * of truth.
 */
export function validateCaptureInput(input: NewSightingInput): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (!SIGHTING_AUDIENCES.includes(input.audience)) {
    issues.push("Pick who this sighting is for (audience tag).");
  }
  const hasNative = input.nativeMedia !== undefined;
  const hasSocial = input.socialLink !== undefined;
  if (hasNative && hasSocial) {
    issues.push("Choose either an upload or a social link, not both.");
  } else if (!hasNative && !hasSocial) {
    issues.push("Add a photo/video or a TikTok/Instagram link.");
  }
  if (hasNative && input.nativeMedia) {
    if (!input.nativeMedia.url) issues.push("Upload media is missing.");
    if (
      !input.nativeMedia.mimeType.startsWith("image/") &&
      !input.nativeMedia.mimeType.startsWith("video/")
    ) {
      issues.push("Upload must be a photo or a video.");
    }
  }
  if (hasSocial && input.socialLink) {
    if (!isAllowedSocialUrl(input.socialLink.platform, input.socialLink.url)) {
      issues.push(
        "Link must be an https TikTok or Instagram URL matching the platform.",
      );
    }
    if (!input.socialLink.attribution.trim()) {
      issues.push("Credit the original creator (attribution).");
    }
  }
  if (input.consent.peopleInFrame && !input.consent.peopleConsent) {
    issues.push(
      "People are recognizable in frame — their consent is required.",
    );
  }
  if ((input.caption ?? "").length > SIGHTING_CAPTION_MAX_CHARS) {
    issues.push(
      `Caption must be ${SIGHTING_CAPTION_MAX_CHARS} characters or fewer.`,
    );
  }
  return { ok: issues.length === 0, issues };
}

const AUDIENCE_LABELS: Record<SightingAudience, string> = {
  family: "Family",
  friends: "Friends",
  solo: "Solo",
  couple: "Couple",
  group: "Group",
  "beach-club": "Beach club",
};

export function formatSightingAudience(audience: SightingAudience): string {
  return AUDIENCE_LABELS[audience];
}

const TIME_OF_DAY_LABELS: Record<SightingTimeOfDay, string> = {
  sunrise: "Sunrise",
  morning: "Morning",
  midday: "Midday",
  afternoon: "Afternoon",
  "golden-hour": "Golden hour",
  dusk: "Dusk",
  night: "Night",
};

export function formatSightingTimeOfDay(timeOfDay: SightingTimeOfDay): string {
  return TIME_OF_DAY_LABELS[timeOfDay];
}
