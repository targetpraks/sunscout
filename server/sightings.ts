import { newPublicId } from "./tokens";

/**
 * Ephemeral beach-scoped Sightings.
 *
 * A sighting is the lightest-weight proof that a beach is alive right now
 * (PRD §5). Two capture forms exist and are mutually exclusive:
 *
 *  - native:  a photo/video blob uploaded through SunScout. Ephemeral by
 *             design — it expires exactly SIGHTING_TTL_DAYS after capture.
 *  - link:    an outbound TikTok/Instagram URL. Stored as reference +
 *             attribution only (never rehosted), so it persists beyond the
 *             native TTL, but its freshness weight decays monotonically.
 *
 * All time-dependent functions take `now` explicitly so the 7-day TTL can
 * be proven with fixed injected timestamps in tests.
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

/** Recognizable-people consent. Required on every sighting. */
export type SightingConsent = {
  peopleInFrame: boolean;
  peopleConsent: boolean;
};

export type Sighting = {
  id: string;
  beachId: string;
  audience: SightingAudience;
  timeOfDay: SightingTimeOfDay | null;
  moderationState: SightingModerationState;
  consent: SightingConsent;
  media: SightingMedia;
  caption: string | null;
  capturedAt: Date;
  /** Native media only. Link sightings are references and never auto-expire. */
  expiresAt: Date | null;
};

/** Raw, unvalidated capture input. Exactly one media form must be present. */
export type NewSightingInput = {
  beachId?: unknown;
  audience?: unknown;
  timeOfDay?: unknown;
  moderationState?: unknown;
  consent?: unknown;
  caption?: unknown;
  nativeMedia?: unknown;
  socialLink?: unknown;
};

export type ValidatedSightingInput = {
  beachId: string;
  audience: SightingAudience;
  timeOfDay: SightingTimeOfDay | null;
  moderationState: SightingModerationState;
  consent: SightingConsent;
  caption: string | null;
  media: SightingMedia;
};

export type SightingValidation =
  | { ok: true; value: ValidatedSightingInput }
  | { ok: false; issues: string[] };

export type CreateSightingResult =
  | { ok: true; sighting: Sighting }
  | { ok: false; issues: string[] };

const SOCIAL_HOST_SUFFIXES: Record<string, string> = {
  tiktok: "tiktok.com",
  instagram: "instagram.com",
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

function hostMatchesPlatform(host: string, platform: string): boolean {
  const suffix = SOCIAL_HOST_SUFFIXES[platform];
  return host === suffix || host.endsWith(`.${suffix}`);
}

/**
 * Outbound social URLs are accepted only as https references on the platform
 * they claim to be. They are stored verbatim — never fetched, proxied, or
 * rehosted as media.
 */
export function isAllowedSocialUrl(platform: string, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || !SOCIAL_HOST_SUFFIXES[platform]) {
    return false;
  }
  return hostMatchesPlatform(parsed.hostname.toLowerCase(), platform);
}

/** Native media must be an https URL or an absolute storage path. */
export function isAllowedNativeMediaUrl(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function validateSightingInput(
  input: NewSightingInput,
): SightingValidation {
  const issues: string[] = [];

  const beachId = input.beachId;
  if (!isNonEmptyString(beachId)) {
    issues.push("beachId is required");
  }

  const audience = input.audience;
  if (!isOneOf(audience, SIGHTING_AUDIENCES)) {
    issues.push(
      `audience is required and must be one of: ${SIGHTING_AUDIENCES.join(", ")}`,
    );
  }

  const moderationState = input.moderationState;
  if (!isOneOf(moderationState, SIGHTING_MODERATION_STATES)) {
    issues.push(
      `moderationState is required and must be one of: ${SIGHTING_MODERATION_STATES.join(", ")}`,
    );
  }

  let timeOfDay: SightingTimeOfDay | null = null;
  if (input.timeOfDay !== undefined && input.timeOfDay !== null) {
    if (!isOneOf(input.timeOfDay, SIGHTING_TIMES_OF_DAY)) {
      issues.push(
        `timeOfDay must be one of: ${SIGHTING_TIMES_OF_DAY.join(", ")}`,
      );
    } else {
      timeOfDay = input.timeOfDay;
    }
  }

  const consentRaw = input.consent;
  let consent: SightingConsent | null = null;
  if (
    typeof consentRaw !== "object" ||
    consentRaw === null ||
    typeof (consentRaw as { peopleInFrame?: unknown }).peopleInFrame !==
      "boolean" ||
    typeof (consentRaw as { peopleConsent?: unknown }).peopleConsent !==
      "boolean"
  ) {
    issues.push(
      "consent is required with boolean peopleInFrame and peopleConsent flags",
    );
  } else {
    const flags = consentRaw as SightingConsent;
    if (flags.peopleInFrame && !flags.peopleConsent) {
      issues.push(
        "consent.peopleConsent must be true when people are recognizable in frame",
      );
    }
    consent = flags;
  }

  let caption: string | null = null;
  if (input.caption !== undefined && input.caption !== null) {
    if (typeof input.caption !== "string") {
      issues.push("caption must be a string");
    } else if (input.caption.trim().length > SIGHTING_CAPTION_MAX_CHARS) {
      issues.push(
        `caption must be ${SIGHTING_CAPTION_MAX_CHARS} characters or fewer`,
      );
    } else {
      caption = input.caption.trim() || null;
    }
  }

  const hasNative =
    input.nativeMedia !== undefined && input.nativeMedia !== null;
  const hasSocial = input.socialLink !== undefined && input.socialLink !== null;
  if (hasNative && hasSocial) {
    issues.push(
      "exactly one media form is allowed: provide nativeMedia or socialLink, not both",
    );
  } else if (!hasNative && !hasSocial) {
    issues.push(
      "exactly one media form is required: provide nativeMedia or socialLink",
    );
  }

  let media: SightingMedia | null = null;
  if (hasNative) {
    const native = input.nativeMedia as {
      url?: unknown;
      mimeType?: unknown;
    };
    if (!isNonEmptyString(native.url)) {
      issues.push("nativeMedia.url is required");
    } else if (!isAllowedNativeMediaUrl(native.url.trim())) {
      issues.push(
        "nativeMedia.url must be an https URL or an absolute storage path",
      );
    }
    if (!isNonEmptyString(native.mimeType)) {
      issues.push("nativeMedia.mimeType is required");
    } else {
      const mimeType = (native.mimeType as string).trim().toLowerCase();
      if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
        issues.push("nativeMedia.mimeType must be an image/* or video/* type");
      }
    }
    if (isNonEmptyString(native.url) && isNonEmptyString(native.mimeType)) {
      media = {
        form: "native",
        url: (native.url as string).trim(),
        mimeType: (native.mimeType as string).trim().toLowerCase(),
      };
    }
  } else if (hasSocial) {
    const social = input.socialLink as {
      platform?: unknown;
      url?: unknown;
      attribution?: unknown;
    };
    const platform = social.platform;
    if (!isOneOf(platform, ["tiktok", "instagram"] as const)) {
      issues.push("socialLink.platform must be tiktok or instagram");
    }
    if (!isNonEmptyString(social.url)) {
      issues.push("socialLink.url is required");
    } else if (
      isOneOf(platform, ["tiktok", "instagram"] as const) &&
      !isAllowedSocialUrl(platform, (social.url as string).trim())
    ) {
      issues.push(
        "socialLink.url must be an https URL on the tiktok.com or instagram.com domain matching the platform",
      );
    }
    if (!isNonEmptyString(social.attribution)) {
      issues.push("socialLink.attribution is required");
    }
    if (
      isOneOf(platform, ["tiktok", "instagram"] as const) &&
      isNonEmptyString(social.url) &&
      isNonEmptyString(social.attribution)
    ) {
      media = {
        form: "link",
        platform,
        url: (social.url as string).trim(),
        attribution: (social.attribution as string).trim(),
      };
    }
  }

  if (issues.length > 0 || media === null) {
    return { ok: false, issues };
  }
  if (!isNonEmptyString(beachId)) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      beachId: beachId.trim(),
      audience: audience as SightingAudience,
      timeOfDay,
      moderationState: moderationState as SightingModerationState,
      consent: consent as SightingConsent,
      caption,
      media,
    },
  };
}

/**
 * Capture a sighting at `now`. Native media expires exactly
 * SIGHTING_TTL_DAYS later; outbound links never auto-expire (they are
 * references, not hosted content).
 */
export function createSighting(
  input: NewSightingInput,
  now: Date,
  id: string = newPublicId(),
): CreateSightingResult {
  const validated = validateSightingInput(input);
  if (!validated.ok) {
    return { ok: false, issues: validated.issues };
  }
  const value = validated.value;
  const expiresAt =
    value.media.form === "native"
      ? new Date(now.getTime() + SIGHTING_TTL_MS)
      : null;
  return {
    ok: true,
    sighting: {
      id,
      beachId: value.beachId,
      audience: value.audience,
      timeOfDay: value.timeOfDay,
      moderationState: value.moderationState,
      consent: value.consent,
      media: value.media,
      caption: value.caption,
      capturedAt: now,
      expiresAt,
    },
  };
}

/** A sighting is expired once `now` reaches its TTL boundary (native only). */
export function isExpired(sighting: Sighting, now: Date): boolean {
  if (sighting.expiresAt === null) return false;
  return now.getTime() >= sighting.expiresAt.getTime();
}

/**
 * Freshness weight in [0, 1] for Pulse recency. Native media drops to 0 at
 * expiry; link sightings persist but their weight decays monotonically
 * (exponentially, half-life SIGHTING_FRESHNESS_HALF_LIFE_MS) with age.
 */
export function freshnessWeight(sighting: Sighting, now: Date): number {
  if (isExpired(sighting, now)) return 0;
  const ageMs = Math.max(0, now.getTime() - sighting.capturedAt.getTime());
  return Math.pow(0.5, ageMs / SIGHTING_FRESHNESS_HALF_LIFE_MS);
}

export type RailSelectorOptions = {
  now: Date;
  /** Maximum number of sightings returned. */
  limit: number;
  /** Restrict to a single beach when provided. */
  beachId?: string;
};

/**
 * Expiry- and moderation-aware rail selector: excludes expired and
 * non-approved sightings, sorts most recent first, caps at `limit`.
 */
export function selectRailSightings(
  sightings: Sighting[],
  options: RailSelectorOptions,
): Sighting[] {
  const { now, limit } = options;
  return sightings
    .filter((sighting) => sighting.moderationState === "approved")
    .filter((sighting) => !isExpired(sighting, now))
    .filter(
      (sighting) =>
        options.beachId === undefined || sighting.beachId === options.beachId,
    )
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
    .slice(0, Math.max(0, limit));
}

/** Wire/DB record shape (snake_case, ISO timestamps). */
export type SightingRecord = {
  id: string;
  beach_id: string;
  audience: string;
  time_of_day: string | null;
  moderation_state: string;
  people_in_frame: boolean;
  people_consent: boolean;
  media_form: SightingMediaForm;
  media_url: string;
  media_mime_type: string | null;
  media_platform: string | null;
  media_attribution: string | null;
  caption: string | null;
  captured_at: string;
  expires_at: string | null;
};

export function toSightingRecord(sighting: Sighting): SightingRecord {
  return {
    id: sighting.id,
    beach_id: sighting.beachId,
    audience: sighting.audience,
    time_of_day: sighting.timeOfDay,
    moderation_state: sighting.moderationState,
    people_in_frame: sighting.consent.peopleInFrame,
    people_consent: sighting.consent.peopleConsent,
    media_form: sighting.media.form,
    media_url: sighting.media.url,
    media_mime_type:
      sighting.media.form === "native" ? sighting.media.mimeType : null,
    media_platform:
      sighting.media.form === "link" ? sighting.media.platform : null,
    media_attribution:
      sighting.media.form === "link" ? sighting.media.attribution : null,
    caption: sighting.caption,
    captured_at: sighting.capturedAt.toISOString(),
    expires_at: sighting.expiresAt ? sighting.expiresAt.toISOString() : null,
  };
}

export function parseSightingRecord(record: SightingRecord): Sighting {
  const consent: SightingConsent = {
    peopleInFrame: record.people_in_frame,
    peopleConsent: record.people_consent,
  };
  const media: SightingMedia =
    record.media_form === "native"
      ? {
          form: "native",
          url: record.media_url,
          mimeType: record.media_mime_type ?? "",
        }
      : {
          form: "link",
          platform:
            (record.media_platform as "tiktok" | "instagram") ?? "tiktok",
          url: record.media_url,
          attribution: record.media_attribution ?? "",
        };
  return {
    id: record.id,
    beachId: record.beach_id,
    audience: record.audience as SightingAudience,
    timeOfDay: record.time_of_day as SightingTimeOfDay | null,
    moderationState: record.moderation_state as SightingModerationState,
    consent,
    media,
    caption: record.caption,
    capturedAt: new Date(record.captured_at),
    expiresAt: record.expires_at ? new Date(record.expires_at) : null,
  };
}
