import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import type { Server } from "node:http";
import {
  AD_PLACEMENT_KINDS,
  activePlacementsAt,
  adsQuerySchema,
  createAdsRouter,
  listActivePlacements,
  type AdsDb,
  type SponsoredPlacement,
} from "./ads";
import {
  computePulse,
  rankByPulse,
  type PulseAudience,
  type PulseInput,
  type PulseOptions,
} from "./beachPulse";

const NOW = new Date("2026-06-15T12:00:00Z");
const BEACH_ID = "22222222-2222-4222-8222-222222222222";

function makePlacement(
  overrides: Partial<SponsoredPlacement> = {},
): SponsoredPlacement {
  return {
    id: 1,
    publicId: "11111111-1111-4111-8111-111111111111",
    beachPublicId: BEACH_ID,
    kind: "placement",
    brandName: "Solara Sunblock",
    label: "Sponsored",
    headline: "Stay protected at golden hour",
    body: "SPF 50 reef-safe sunblock, sampled on this beach today.",
    imageUrl: null,
    targetUrl: "https://example.com/solara",
    eventPublicId: null,
    weight: 0,
    sponsored: true,
    startsAt: "2026-06-15T10:00:00Z",
    endsAt: "2026-06-15T18:00:00Z",
    ...overrides,
  };
}

/**
 * pg's query is a heavily overloaded generic, so a hand-rolled stub is not
 * directly assignable. Route the cast through unknown once, here, instead of
 * at every call site.
 */
function asQuery(
  fn: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>,
): AdsDb["query"] {
  return fn as unknown as AdsDb["query"];
}

describe("activePlacementsAt window semantics", () => {
  it("keeps a placement whose window starts exactly at now", () => {
    const starting = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000001",
      startsAt: "2026-06-15T12:00:00Z",
      endsAt: "2026-06-15T18:00:00Z",
    });
    expect(activePlacementsAt([starting], NOW)).toHaveLength(1);
  });

  it("drops a placement whose window ends exactly at now (half-open)", () => {
    const ending = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000002",
      startsAt: "2026-06-15T08:00:00Z",
      endsAt: "2026-06-15T12:00:00Z",
    });
    expect(activePlacementsAt([ending], NOW)).toHaveLength(0);
  });

  it("drops past and future placements and keeps the live one", () => {
    const past = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000003",
      startsAt: "2026-06-14T08:00:00Z",
      endsAt: "2026-06-14T18:00:00Z",
    });
    const future = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000004",
      startsAt: "2026-06-16T08:00:00Z",
      endsAt: "2026-06-16T18:00:00Z",
    });
    const live = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000005",
    });
    const active = activePlacementsAt([future, past, live], NOW);
    expect(active.map((p) => p.publicId)).toEqual([live.publicId]);
  });

  it("orders takeovers ahead of placements, then weight desc, then start asc", () => {
    const plainHeavy = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000006",
      kind: "placement",
      weight: 90,
    });
    const beachTakeover = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000007",
      kind: "beach_takeover",
      weight: 1,
    });
    const eventTakeover = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000008",
      kind: "event_takeover",
      weight: 1,
    });
    const plainLight = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-000000000009",
      kind: "placement",
      weight: 10,
    });
    const plainHeavyLater = makePlacement({
      publicId: "aaaaaaaa-0000-4000-8000-00000000000a",
      kind: "placement",
      weight: 90,
      startsAt: "2026-06-15T11:00:00Z",
    });
    const ordered = activePlacementsAt(
      [plainLight, plainHeavyLater, plainHeavy, eventTakeover, beachTakeover],
      NOW,
    );
    expect(ordered.map((p) => p.publicId)).toEqual([
      beachTakeover.publicId,
      eventTakeover.publicId,
      plainHeavy.publicId,
      plainHeavyLater.publicId,
      plainLight.publicId,
    ]);
  });

  it("orders paid inventory among itself only — output order is never a rank signal", () => {
    // The ordering inputs (kind, weight, startsAt) are ad-buy properties.
    // Flipping them must not change which beaches appear anywhere in pulse
    // output; that is asserted separately below in the §4.6 suite.
    const a = makePlacement({ brandName: "A", weight: 5 });
    const b = makePlacement({ brandName: "B", weight: 9 });
    expect(activePlacementsAt([a, b], NOW)[0].brandName).toBe("B");
    expect(activePlacementsAt([b, a], NOW)[0].brandName).toBe("B");
  });
});

describe("listActivePlacements serialization invariants", () => {
  it("forces sponsored:true on every served item even if the row says false", async () => {
    const row = {
      id: 1,
      public_id: "11111111-1111-4111-8111-111111111111",
      beach_public_id: BEACH_ID,
      kind: "placement",
      brand_name: "Solara Sunblock",
      label: "Sponsored · Solara Sunblock",
      headline: null,
      body: null,
      image_url: null,
      target_url: null,
      event_public_id: null,
      weight: 0,
      // A malformed/stale row must never be served as unlabeled inventory.
      sponsored: false,
      start_at: new Date("2026-06-15T10:00:00Z"),
      end_at: new Date("2026-06-15T18:00:00Z"),
    };
    const db: AdsDb = {
      query: asQuery(async () => ({ rows: [row], rowCount: 1 })),
    };
    const placements = await listActivePlacements(db, {
      beachPublicId: BEACH_ID,
      now: NOW,
    });
    expect(placements).toHaveLength(1);
    expect(placements[0].sponsored).toBe(true);
    expect(placements[0].brandName).toBe("Solara Sunblock");
    expect(placements[0].label).toContain("Sponsored");
  });

  it("passes the requested instant through to the SQL window filter", async () => {
    let captured: unknown[] = [];
    const db: AdsDb = {
      query: asQuery(async (_sql, params) => {
        captured = params ?? [];
        return { rows: [], rowCount: 0 };
      }),
    };
    await listActivePlacements(db, { beachPublicId: BEACH_ID, now: NOW });
    expect(captured[0]).toBe(BEACH_ID);
    expect(captured[1]).toBe(NOW);
  });
});

describe("adsQuerySchema", () => {
  it("accepts a beach uuid and an ISO instant", () => {
    const parsed = adsQuerySchema.parse({
      beachId: BEACH_ID,
      at: "2026-06-15T12:00:00.000Z",
    });
    expect(parsed.beachId).toBe(BEACH_ID);
    expect(parsed.at?.toISOString()).toBe(NOW.toISOString());
  });

  it("rejects a missing or empty beachId", () => {
    expect(adsQuerySchema.safeParse({}).success).toBe(false);
    expect(adsQuerySchema.safeParse({ beachId: "" }).success).toBe(false);
  });

  it("rejects a non-uuid beachId as invalid_request input, not a DB error", () => {
    expect(
      adsQuerySchema.safeParse({ beachId: "praia-da-coelha" }).success,
    ).toBe(false);
  });

  it("rejects a malformed at instant", () => {
    expect(
      adsQuerySchema.safeParse({ beachId: BEACH_ID, at: "not-a-date" }).success,
    ).toBe(false);
  });
});

describe("GET /api/ads router (ephemeral mount)", () => {
  let app: Express;
  let server: Server;
  let baseUrl: string;

  const liveRow = {
    id: 1,
    public_id: "11111111-1111-4111-8111-111111111111",
    beach_public_id: BEACH_ID,
    kind: "beach_takeover",
    brand_name: "Maré Beach Club",
    label: "Sponsored · Maré Beach Club",
    headline: "Weekend takeover",
    body: "Free towel service with any booking.",
    image_url: null,
    target_url: "https://example.com/mare",
    event_public_id: null,
    weight: 40,
    sponsored: true,
    start_at: new Date("2026-06-15T10:00:00Z"),
    end_at: new Date("2026-06-15T18:00:00Z"),
  };

  beforeAll(async () => {
    const db: AdsDb = {
      query: asQuery(async (sql, params) => {
        if (String(sql).includes("from ad_placement")) {
          const [beach, at] = params ?? [];
          const active =
            beach === BEACH_ID &&
            liveRow.start_at <= new Date(String(at)) &&
            new Date(String(at)) < liveRow.end_at;
          return { rows: active ? [liveRow] : [], rowCount: active ? 1 : 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    app = express();
    app.use("/api/ads", createAdsRouter(db));
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const address = server.address();
    if (typeof address === "object" && address) {
      baseUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  afterAll(() => {
    server?.close();
  });

  it("returns only placements whose window covers the requested instant", async () => {
    const response = await fetch(
      `${baseUrl}/api/ads?beachId=${BEACH_ID}&at=2026-06-15T12:00:00.000Z`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: SponsoredPlacement[] };
    expect(body.data).toHaveLength(1);
    const item = body.data[0];
    expect(item.publicId).toBe(liveRow.public_id);
    expect(item.brandName).toBe("Maré Beach Club");
    expect(item.label).toContain("Sponsored");
  });

  it("drops the same placement outside its window", async () => {
    const response = await fetch(
      `${baseUrl}/api/ads?beachId=${BEACH_ID}&at=2026-06-15T19:00:00.000Z`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: SponsoredPlacement[] };
    expect(body.data).toEqual([]);
  });

  it("serves an empty list for a beach with no placements", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const response = await fetch(
      `${baseUrl}/api/ads?beachId=${other}&at=2026-06-15T12:00:00.000Z`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: SponsoredPlacement[] };
    expect(body.data).toEqual([]);
  });

  it("answers 400 invalid_request for a bad query", async () => {
    const response = await fetch(`${baseUrl}/api/ads?beachId=not-a-uuid`);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });
});

describe("earned-vs-paid separation: sponsorship never alters Beach Pulse (PRD §4.6)", () => {
  // Same shape as the fixture in beachPulse.test.ts, kept small here: the
  // invariance claim does not depend on the exact conditions, only on the
  // pulse engine being blind to sponsorship state.
  const fixture: PulseInput[] = [
    {
      id: "cove",
      name: "Calm Cove",
      conditions: {
        observedAt: "2026-06-15T11:00:00.000Z",
        waveM: 0.3,
        windKmh: 8,
        waterTempC: 23,
        airTempC: 26,
        uvIndex: 5,
        crowdPct: 25,
        cloudPct: 10,
      },
      community: {
        checkIns: [
          {
            audience: "family",
            at: "2026-06-15T11:00:00.000Z",
            kind: "check-in",
          },
        ],
        vibeVotes: [
          { audience: "family", at: "2026-06-15T10:00:00.000Z", score: 90 },
        ],
        accuracyRatings: [{ at: "2026-06-15T10:00:00.000Z", accurate: true }],
      },
    },
    {
      id: "lido",
      name: "Lido Strip",
      conditions: {
        observedAt: "2026-06-15T11:00:00.000Z",
        waveM: 1.1,
        windKmh: 20,
        waterTempC: 25,
        airTempC: 32,
        uvIndex: 8,
        crowdPct: 92,
        cloudPct: 0,
      },
      community: {
        checkIns: [
          {
            audience: "party",
            at: "2026-06-15T11:30:00.000Z",
            kind: "check-in",
          },
        ],
        vibeVotes: [
          { audience: "party", at: "2026-06-15T11:00:00.000Z", score: 95 },
        ],
      },
    },
  ];

  const audiences = [
    "family",
    "party",
  ] as const satisfies readonly PulseAudience[];

  // Paid inventory for both fixture beaches, live across the whole NOW window.
  const sponsorships: SponsoredPlacement[] = [
    makePlacement({
      publicId: "33333333-0000-4000-8000-000000000001",
      beachPublicId: BEACH_ID,
      kind: "beach_takeover",
      brandName: "Maré Beach Club",
      label: "Sponsored · Maré Beach Club",
      weight: 99,
      startsAt: "2026-06-15T08:00:00Z",
      endsAt: "2026-06-15T20:00:00Z",
    }),
    makePlacement({
      publicId: "33333333-0000-4000-8000-000000000002",
      beachPublicId: "44444444-4444-4444-8444-444444444444",
      kind: "event_takeover",
      brandName: "Solara Sunblock",
      label: "Sponsored · Solara Sunblock",
      weight: 50,
      startsAt: "2026-06-15T00:00:00Z",
      endsAt: "2026-06-16T00:00:00Z",
    }),
  ];

  it("first proves the sponsorships are actually live at NOW (non-vacuous setup)", () => {
    const active = activePlacementsAt(sponsorships, NOW);
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(active.every((p) => p.sponsored === true)).toBe(true);
  });

  it("pulse scores and per-audience rankings are identical with and without active sponsorships (PRD §4.6)", () => {
    // The with-sponsorship run carries the live paid inventory ON the pulse
    // inputs themselves — if a future change lets the engine read paid
    // fields, enrichment is the cheapest channel it would leak through, so
    // this is the shape the invariant must survive.
    const withSponsorship = (beach: PulseInput): PulseInput =>
      ({
        ...beach,
        sponsored: true,
        sponsorBrandName: "Maré Beach Club",
        adWeight: 99,
        placementKind: "beach_takeover",
      }) as PulseInput;
    for (const audience of audiences) {
      const opts: PulseOptions = { audience, now: NOW };
      const baseline = rankByPulse(fixture, opts);
      const enriched = rankByPulse(fixture.map(withSponsorship), opts);
      expect(enriched).toEqual(baseline);
      // Explicit per-field pins, in case toEqual is weakened later.
      expect(enriched.map((r) => r.id)).toEqual(baseline.map((r) => r.id));
      expect(enriched.map((r) => r.score)).toEqual(
        baseline.map((r) => r.score),
      );
      for (const beach of fixture) {
        const plain = computePulse(beach, opts);
        const paid = computePulse(withSponsorship(beach), opts);
        expect(paid.score).toBe(plain.score);
        expect(paid.breakdown).toEqual(plain.breakdown);
        expect(paid.confidence).toBe(plain.confidence);
      }
    }
  });

  it("structural drift guard: the pulse engine and listBeaches never reference ads or sponsorship", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pulseSource = await readFile(join(here, "beachPulse.ts"), "utf8");
    expect(pulseSource).not.toMatch(/ad_placement|adPlacement|sponsor/i);
    expect(pulseSource).not.toMatch(/from "\.\/ads"/);

    const beachesSource = await readFile(join(here, "beaches.ts"), "utf8");
    // listBeaches SQL must not read ad_placement; the only permitted mention
    // of ads in beaches.ts is the re-export block for the index owner.
    const listBeachesBody = beachesSource.slice(
      beachesSource.indexOf("export async function listBeaches"),
    );
    expect(listBeachesBody).not.toMatch(/ad_placement|sponsor/i);
  });
});
