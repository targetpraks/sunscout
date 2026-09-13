import { describe, expect, it } from "vitest";
import {
  createSighting,
  freshnessWeight,
  isAllowedNativeMediaUrl,
  isAllowedSocialUrl,
  isExpired,
  parseSightingRecord,
  SIGHTING_TTL_DAYS,
  selectRailSightings,
  toSightingRecord,
  validateSightingInput,
  type Sighting,
} from "./sightings";

const T0 = new Date("2026-06-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const validNativeInput = {
  beachId: "beach-1",
  audience: "friends",
  moderationState: "approved",
  consent: { peopleInFrame: false, peopleConsent: false },
  caption: "Glassy morning",
  nativeMedia: {
    url: "https://cdn.sunscout.app/s/abc.jpg",
    mimeType: "image/jpeg",
  },
};

const validLinkInput = {
  beachId: "beach-1",
  audience: "solo",
  moderationState: "approved",
  consent: { peopleInFrame: true, peopleConsent: true },
  socialLink: {
    platform: "tiktok",
    url: "https://www.tiktok.com/@creator/video/123",
    attribution: "@creator",
  },
};

describe("validateSightingInput", () => {
  it("accepts a valid native-media sighting", () => {
    const result = validateSightingInput(validNativeInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.media.form).toBe("native");
      expect(result.value.audience).toBe("friends");
    }
  });

  it("accepts a valid outbound social-link sighting", () => {
    const result = validateSightingInput(validLinkInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.media.form).toBe("link");
      if (result.value.media.form === "link") {
        expect(result.value.media.url).toBe(validLinkInput.socialLink.url);
        expect(result.value.media.attribution).toBe("@creator");
      }
    }
  });

  it("rejects a sighting with neither media nor social URL", () => {
    const { nativeMedia: _native, ...bare } = validNativeInput;
    const result = validateSightingInput(bare);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/exactly one media form/i);
    }
  });

  it("rejects a sighting with both native media and a social URL", () => {
    const result = validateSightingInput({
      ...validNativeInput,
      socialLink: validLinkInput.socialLink,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/not both/i);
    }
  });

  it("rejects a social URL on a non-social host", () => {
    const result = validateSightingInput({
      ...validLinkInput,
      socialLink: {
        platform: "tiktok",
        url: "https://example.com/watch?v=1",
        attribution: "@creator",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/tiktok\.com or instagram\.com/i);
    }
  });

  it("rejects a mismatched platform/host pair (instagram URL labelled tiktok)", () => {
    const result = validateSightingInput({
      ...validLinkInput,
      socialLink: {
        platform: "tiktok",
        url: "https://www.instagram.com/reel/abc123/",
        attribution: "@creator",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects non-https social URLs", () => {
    const result = validateSightingInput({
      ...validLinkInput,
      socialLink: {
        platform: "instagram",
        url: "http://www.instagram.com/reel/abc123/",
        attribution: "@creator",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("fails validation when the audience tag is missing", () => {
    const { audience: _audience, ...missing } = validNativeInput;
    const result = validateSightingInput(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/audience is required/);
    }
  });

  it("fails validation when the moderation state is missing", () => {
    const { moderationState: _m, ...missing } = validNativeInput;
    const result = validateSightingInput(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/moderationState is required/);
    }
  });

  it("fails validation when consent flags are missing", () => {
    const { consent: _c, ...missing } = validNativeInput;
    const result = validateSightingInput(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/consent is required/);
    }
  });

  it("fails validation when recognizable people lack consent", () => {
    const result = validateSightingInput({
      ...validNativeInput,
      consent: { peopleInFrame: true, peopleConsent: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/peopleConsent must be true/);
    }
  });

  it("rejects an out-of-range audience and time-of-day", () => {
    const result = validateSightingInput({
      ...validNativeInput,
      audience: "aliens",
      timeOfDay: "eclipse",
    });
    expect(result.ok).toBe(false);
  });
});

describe("isAllowedSocialUrl / isAllowedNativeMediaUrl", () => {
  it("accepts tiktok and instagram https hosts including www subdomains", () => {
    expect(
      isAllowedSocialUrl("tiktok", "https://www.tiktok.com/@c/video/1"),
    ).toBe(true);
    expect(
      isAllowedSocialUrl("instagram", "https://instagram.com/reel/x/"),
    ).toBe(true);
    expect(
      isAllowedSocialUrl("instagram", "https://www.instagram.com/p/x/"),
    ).toBe(true);
  });

  it("rejects lookalike and non-https hosts", () => {
    expect(isAllowedSocialUrl("tiktok", "https://tiktok.com.evil.io/x")).toBe(
      false,
    );
    expect(isAllowedSocialUrl("tiktok", "https://not-tiktok.com/video/1")).toBe(
      false,
    );
    expect(isAllowedSocialUrl("tiktok", "ftp://tiktok.com/x")).toBe(false);
    expect(
      isAllowedSocialUrl("instagram", "https://instagram.evil.com/p/x"),
    ).toBe(false);
  });

  it("accepts https URLs and absolute storage paths for native media", () => {
    expect(isAllowedNativeMediaUrl("https://cdn.sunscout.app/a.mp4")).toBe(
      true,
    );
    expect(isAllowedNativeMediaUrl("/uploads/media/a.jpg")).toBe(true);
    expect(isAllowedNativeMediaUrl("http://cdn.sunscout.app/a.jpg")).toBe(
      false,
    );
    expect(isAllowedNativeMediaUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("createSighting — 7-day TTL", () => {
  it("expires a native-media sighting exactly 7 days after capture", () => {
    const created = createSighting(validNativeInput, T0);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sighting = created.sighting;
    expect(sighting.expiresAt).not.toBeNull();
    expect(sighting.expiresAt!.getTime() - sighting.capturedAt.getTime()).toBe(
      SIGHTING_TTL_DAYS * DAY,
    );
    // 1 ms before the boundary: alive.
    expect(isExpired(sighting, new Date(T0.getTime() + 7 * DAY - 1))).toBe(
      false,
    );
    // exactly at the boundary: expired.
    expect(isExpired(sighting, new Date(T0.getTime() + 7 * DAY))).toBe(true);
    // far past: expired.
    expect(isExpired(sighting, new Date(T0.getTime() + 30 * DAY))).toBe(true);
  });

  it("never auto-expires a link-based sighting", () => {
    const created = createSighting(validLinkInput, T0);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sighting = created.sighting;
    expect(sighting.expiresAt).toBeNull();
    expect(isExpired(sighting, new Date(T0.getTime() + 30 * DAY))).toBe(false);
    expect(isExpired(sighting, new Date(T0.getTime() + 365 * DAY))).toBe(false);
  });

  it("returns validation issues instead of a sighting for invalid input", () => {
    const created = createSighting({ beachId: "b1" }, T0);
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.issues.length).toBeGreaterThan(0);
    }
  });

  it("stores the outbound URL verbatim as reference + attribution, never as hosted media", () => {
    const created = createSighting(validLinkInput, T0);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.sighting.media.form).toBe("link");
    if (created.sighting.media.form === "link") {
      expect(created.sighting.media.url).toBe(validLinkInput.socialLink.url);
      expect(created.sighting.media.attribution).toBe("@creator");
    }
  });
});

describe("freshnessWeight", () => {
  it("is 1 at capture and decays monotonically for link sightings", () => {
    const created = createSighting(validLinkInput, T0);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sighting = created.sighting;
    const weights = [0, 1, 2, 3.5, 7, 14, 30, 60].map((days) =>
      freshnessWeight(sighting, new Date(T0.getTime() + days * DAY)),
    );
    expect(weights[0]).toBe(1);
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
      expect(weights[i]).toBeGreaterThan(0);
    }
  });

  it("drops to 0 once a native sighting expires", () => {
    const created = createSighting(validNativeInput, T0);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sighting = created.sighting;
    expect(
      freshnessWeight(sighting, new Date(T0.getTime() + 6 * DAY)),
    ).toBeGreaterThan(0);
    expect(freshnessWeight(sighting, new Date(T0.getTime() + 7 * DAY))).toBe(0);
  });
});

describe("selectRailSightings", () => {
  const base = {
    beachId: "beach-1",
    audience: "friends" as const,
    timeOfDay: null,
    moderationState: "approved" as const,
    consent: { peopleInFrame: false, peopleConsent: false },
    caption: null,
  };
  const native = (capturedAt: Date, id: string): Sighting => ({
    ...base,
    id,
    media: {
      form: "native",
      url: "https://cdn.sunscout.app/x.jpg",
      mimeType: "image/jpeg",
    },
    capturedAt,
    expiresAt: new Date(capturedAt.getTime() + 7 * DAY),
  });
  const link = (capturedAt: Date, id: string): Sighting => ({
    ...base,
    id,
    media: {
      form: "link",
      platform: "instagram",
      url: "https://www.instagram.com/reel/x/",
      attribution: "@creator",
    },
    capturedAt,
    expiresAt: null,
  });

  const now = new Date(T0.getTime() + 2 * DAY);

  it("excludes expired and non-approved sightings and returns the N most recent", () => {
    const sightings: Sighting[] = [
      native(new Date(T0.getTime() - 1 * DAY), "fresh-native"), // alive
      native(new Date(T0.getTime() - 10 * DAY), "expired-native"), // expired by `now`
      {
        ...native(new Date(T0.getTime() - 0.5 * DAY), "pending"),
        moderationState: "pending",
      },
      {
        ...native(new Date(T0.getTime() - 0.5 * DAY), "rejected"),
        moderationState: "rejected",
      },
      link(new Date(T0.getTime() - 1.5 * DAY), "old-link"), // link persists
      native(new Date(T0.getTime() - 0.25 * DAY), "newest-native"),
    ];
    const rail = selectRailSightings(sightings, { now, limit: 10 });
    const ids = rail.map((s) => s.id);
    expect(ids).toEqual(["newest-native", "fresh-native", "old-link"]);
  });

  it("caps the result at the limit, keeping the most recent", () => {
    const sightings = [
      native(new Date(T0.getTime() - 3 * DAY), "a"),
      native(new Date(T0.getTime() - 2 * DAY), "b"),
      native(new Date(T0.getTime() - 1 * DAY), "c"),
    ];
    const rail = selectRailSightings(sightings, { now, limit: 2 });
    expect(rail.map((s) => s.id)).toEqual(["c", "b"]);
  });

  it("filters to a single beach when beachId is provided", () => {
    const sightings = [
      native(new Date(T0.getTime() - 1 * DAY), "beach-1-item"),
      {
        ...native(new Date(T0.getTime() - 1 * DAY), "beach-2-item"),
        beachId: "beach-2",
      },
    ];
    const rail = selectRailSightings(sightings, {
      now,
      limit: 10,
      beachId: "beach-1",
    });
    expect(rail.map((s) => s.id)).toEqual(["beach-1-item"]);
  });

  it("returns an empty rail when everything has expired", () => {
    const sightings = [native(new Date(T0.getTime() - 30 * DAY), "gone")];
    expect(selectRailSightings(sightings, { now, limit: 10 })).toEqual([]);
  });
});

describe("record round-trip", () => {
  it("serializes to a snake_case wire record and back", () => {
    const created = createSighting(validLinkInput, T0);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const record = toSightingRecord(created.sighting);
    expect(record.media_form).toBe("link");
    expect(record.media_url).toBe(validLinkInput.socialLink.url);
    expect(record.expires_at).toBeNull();
    const restored = parseSightingRecord(record);
    expect(restored.capturedAt.toISOString()).toBe(T0.toISOString());
    expect(restored.media).toEqual(created.sighting.media);
  });
});
