import { afterEach, describe, expect, it, vi } from "vitest";
import coordinatorApiSource from "./api.ts?raw";
import coordinatorTypesSource from "./types.ts?raw";
import eventsApiSource from "../api.ts?raw";
import pulseScoringSource from "../../pulse/scoring.ts?raw";
import pulseTypesSource from "../../pulse/types.ts?raw";
import serverPulseSource from "../../../server/beachPulse.ts?raw";
import {
  applyTakeoverChange,
  createAndPublishEvent,
  replaceEvent,
} from "./api";
import {
  EVENT_AUDIENCES,
  SPONSORED_LABEL,
  emptyPublisherForm,
  eventToPayload,
  formStateFromEvent,
  mergeEventList,
  normalizeTakeover,
  removeEvent,
  sponsorProblem,
  takeoverBadgeText,
  toEventPayload,
  validateEventForm,
  type PublisherFormState,
} from "./types";
import {
  consumerCalendarPartition,
  consumerVisibleEvents,
  PAID_TAKEOVER_LABEL,
  type BeachEvent,
} from "../types";
import {
  AUDIENCE_PROFILES,
  computePulse,
  rankByPulse,
} from "../../pulse/scoring";
import type { PulseInput } from "../../pulse/types";

const BEACH_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-06-15T12:00:00Z");

function makeEvent(overrides: Partial<BeachEvent> = {}): BeachEvent {
  return {
    id: 1,
    publicId: "11111111-1111-4111-8111-111111111111",
    beachPublicId: BEACH_ID,
    beachName: "Praia Test",
    coordinatorId: 7,
    title: "Sunset party",
    description: null,
    category: "party",
    state: "published",
    startsAt: "2026-06-15T10:00:00Z",
    endsAt: "2026-06-15T18:00:00Z",
    paidTakeover: {
      isPaid: false,
      label: PAID_TAKEOVER_LABEL,
      sponsorName: null,
    },
    createdAt: "2026-06-01T09:00:00Z",
    updatedAt: "2026-06-01T09:00:00Z",
    ...overrides,
  };
}

function validForm(): PublisherFormState {
  return {
    ...emptyPublisherForm(),
    beachPublicId: BEACH_ID,
    title: "Sunset sessions",
    category: "party",
    audienceTags: ["friends"],
    // datetime-local values: interpreted in the test runner's local TZ,
    // exactly as the browser form produces them. Expected ISO strings below
    // are built with new Date(value) for the same reason — never hard-code
    // a UTC literal or the test breaks on other machines.
    startsAt: "2026-06-20T10:00",
    endsAt: "2026-06-20T18:00",
  };
}

describe("validateEventForm", () => {
  it("accepts a fully valid form", () => {
    expect(validateEventForm(validForm())).toBeNull();
  });

  it("rejects a non-uuid beach id", () => {
    const errors = validateEventForm({
      ...validForm(),
      beachPublicId: "not-a-uuid",
    });
    expect(errors?.beachPublicId).toBeTruthy();
  });

  it("rejects a blank and an over-long title", () => {
    expect(
      validateEventForm({ ...validForm(), title: "   " })?.title,
    ).toBeTruthy();
    expect(
      validateEventForm({ ...validForm(), title: "x".repeat(121) })?.title,
    ).toBeTruthy();
    expect(
      validateEventForm({ ...validForm(), title: "x".repeat(120) }),
    ).toBeNull();
  });

  it("rejects a description over 2000 characters", () => {
    const errors = validateEventForm({
      ...validForm(),
      description: "x".repeat(2001),
    });
    expect(errors?.description).toBeTruthy();
  });

  it("rejects a window that does not end after it starts", () => {
    const sameInstant = validateEventForm({
      ...validForm(),
      endsAt: "2026-06-20T10:00",
    });
    expect(sameInstant?.endsAt).toBeTruthy();
    const inverted = validateEventForm({
      ...validForm(),
      endsAt: "2026-06-20T09:59",
    });
    expect(inverted?.endsAt).toBeTruthy();
  });

  it("rejects missing datetimes", () => {
    const empty = emptyPublisherForm();
    const errors = validateEventForm(empty);
    expect(errors?.startsAt).toBeTruthy();
    expect(errors?.endsAt).toBeTruthy();
  });

  it("requires a sponsor name (1-80 chars) only when the window is paid", () => {
    const paid = { ...validForm(), isPaidTakeover: true };
    expect(validateEventForm(paid)?.sponsorName).toBeTruthy();
    expect(
      validateEventForm({ ...paid, sponsorName: "Sunblock Co" }),
    ).toBeNull();
    expect(
      validateEventForm({ ...paid, sponsorName: "x".repeat(81) })?.sponsorName,
    ).toBeTruthy();
    // Unpaid windows ignore the sponsor field entirely.
    expect(validateEventForm({ ...validForm(), sponsorName: "" })).toBeNull();
  });

  it("rejects unknown audience tags", () => {
    const errors = validateEventForm({
      ...validForm(),
      audienceTags: ["friends", "not-an-audience" as never],
    });
    expect(errors?.audienceTags).toBeTruthy();
  });
});

describe("toEventPayload", () => {
  it("produces the flat payload the server schema accepts", () => {
    const payload = toEventPayload({
      ...validForm(),
      description: "  Bring the crew.  ",
      isPaidTakeover: true,
      sponsorName: " Sunblock Co ",
    });
    expect(Object.keys(payload).sort()).toEqual([
      "audienceTags",
      "beachPublicId",
      "category",
      "description",
      "endsAt",
      "isPaidTakeover",
      "sponsorName",
      "startsAt",
      "title",
    ]);
    expect(payload.beachPublicId).toBe(BEACH_ID);
    expect(payload.title).toBe("Sunset sessions");
    expect(payload.description).toBe("Bring the crew.");
    expect(payload.category).toBe("party");
    expect(payload.isPaidTakeover).toBe(true);
    expect(payload.sponsorName).toBe("Sunblock Co");
    expect(payload.audienceTags).toEqual(["friends"]);
  });

  it("never sends a nested paidTakeover object or server-only fields", () => {
    const payload = toEventPayload({
      ...validForm(),
      isPaidTakeover: true,
      sponsorName: "Sunblock Co",
    }) as Record<string, unknown>;
    expect(payload.paidTakeover).toBeUndefined();
    expect(payload.state).toBeUndefined();
    expect(payload.publicId).toBeUndefined();
    expect(payload.createdAt).toBeUndefined();
  });

  it("converts datetime-local values to ISO in the same instant", () => {
    const payload = toEventPayload(validForm());
    expect(new Date(payload.startsAt).getTime()).toBe(
      new Date("2026-06-20T10:00").getTime(),
    );
    expect(new Date(payload.endsAt).getTime()).toBe(
      new Date("2026-06-20T18:00").getTime(),
    );
    expect(payload.startsAt).toMatch(/Z$/);
  });

  it("omits the description and sponsor name when empty or unpaid", () => {
    const unpaid = toEventPayload({
      ...validForm(),
      isPaidTakeover: false,
      sponsorName: "leftover text",
    });
    expect(unpaid.isPaidTakeover).toBe(false);
    expect(unpaid.sponsorName).toBeUndefined();
    expect(unpaid.description).toBeUndefined();
  });
});

describe("sponsorship helpers", () => {
  it("takeoverBadgeText labels paid windows as Sponsored", () => {
    expect(takeoverBadgeText(makeEvent())).toBeNull();
    expect(SPONSORED_LABEL).toBe("Sponsored");
    expect(
      takeoverBadgeText(
        makeEvent({
          paidTakeover: {
            isPaid: true,
            label: PAID_TAKEOVER_LABEL,
            sponsorName: "Sunblock Co",
          },
        }),
      ),
    ).toBe("Sponsored · Sunblock Co");
    expect(
      takeoverBadgeText(
        makeEvent({
          paidTakeover: {
            isPaid: true,
            label: PAID_TAKEOVER_LABEL,
            sponsorName: null,
          },
        }),
      ),
    ).toBe("Sponsored");
  });

  it("normalizeTakeover never pairs an unpaid window with a sponsor", () => {
    expect(normalizeTakeover(false, "Sunblock Co")).toEqual({
      isPaid: false,
      sponsorName: null,
    });
    expect(normalizeTakeover(true, " Sunblock Co ")).toEqual({
      isPaid: true,
      sponsorName: "Sunblock Co",
    });
  });

  it("eventToPayload rebuilds a create payload with the next sponsorship", () => {
    const payload = eventToPayload(
      makeEvent({
        paidTakeover: {
          isPaid: true,
          label: PAID_TAKEOVER_LABEL,
          sponsorName: "Old Sponsor",
        },
      }),
      { isPaid: true, sponsorName: "New Sponsor" },
    );
    expect(payload.isPaidTakeover).toBe(true);
    expect(payload.sponsorName).toBe("New Sponsor");
    expect(payload.startsAt).toBe("2026-06-15T10:00:00Z");
    expect(payload.beachPublicId).toBe(BEACH_ID);
  });

  it("sponsorProblem mirrors the server sponsor rules", () => {
    expect(sponsorProblem("")).toBeTruthy();
    expect(sponsorProblem("   ")).toBeTruthy();
    expect(sponsorProblem("x".repeat(81))).toBeTruthy();
    expect(sponsorProblem(" Sunblock Co ")).toBeNull();
  });

  it("formStateFromEvent prefills title, window and sponsor state", () => {
    const sponsored = makeEvent({
      description: "Existing copy",
      paidTakeover: {
        isPaid: true,
        label: PAID_TAKEOVER_LABEL,
        sponsorName: "Sunblock Co",
      },
    });
    const form = formStateFromEvent(sponsored);
    expect(form.title).toBe("Sunset party");
    expect(form.description).toBe("Existing copy");
    expect(form.beachPublicId).toBe(BEACH_ID);
    expect(form.isPaidTakeover).toBe(true);
    expect(form.sponsorName).toBe("Sunblock Co");
    // datetime-local strings are in the runner's local TZ — compare the
    // instants they encode, never the literal strings (TZ-agnostic test).
    expect(new Date(form.startsAt).getTime()).toBe(
      new Date(sponsored.startsAt).getTime(),
    );
    expect(new Date(form.endsAt).getTime()).toBe(
      new Date(sponsored.endsAt).getTime(),
    );
    expect(form.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("list helpers", () => {
  const a = makeEvent({ publicId: "aaaaaaaa-0000-4000-8000-000000000001" });
  const b = makeEvent({ publicId: "aaaaaaaa-0000-4000-8000-000000000002" });

  it("mergeEventList upserts by publicId and appends new events", () => {
    const updatedB = { ...b, title: "Renamed" };
    const merged = mergeEventList([a, b], updatedB);
    expect(merged).toHaveLength(2);
    expect(merged.find((event) => event.publicId === b.publicId)?.title).toBe(
      "Renamed",
    );
    const appended = mergeEventList([a], b);
    expect(appended).toHaveLength(2);
    expect(appended[1].publicId).toBe(b.publicId);
  });

  it("removeEvent drops exactly the named event", () => {
    expect(removeEvent([a, b], a.publicId)).toEqual([b]);
  });
});

describe("coordinator api (fetch-stubbed)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type StubbedResponse = { ok: boolean; status: number; body: unknown };

  function stubFetchSequence(responses: StubbedResponse[]) {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const response = responses.shift() ?? {
          ok: false,
          status: 500,
          body: { error: "stub_exhausted" },
        };
        return {
          ok: response.ok,
          status: response.status,
          json: async () => response.body,
        } as unknown as Response;
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    return {
      fetchMock,
      calls: () => fetchMock.mock.calls as unknown as [string, RequestInit][],
    };
  }

  const draftCreated = makeEvent({
    publicId: "33333333-3333-4333-8333-333333333333",
    state: "draft",
    startsAt: "2026-06-20T10:00:00Z",
    endsAt: "2026-06-20T18:00:00Z",
  });
  const publishedCreated = makeEvent({
    publicId: "33333333-3333-4333-8333-333333333333",
    state: "published",
    startsAt: "2026-06-20T10:00:00Z",
    endsAt: "2026-06-20T18:00:00Z",
  });

  it("createAndPublishEvent posts the payload then publishes the created event", async () => {
    const { calls } = stubFetchSequence([
      { ok: true, status: 200, body: draftCreated },
      { ok: true, status: 200, body: publishedCreated },
    ]);
    const result = await createAndPublishEvent({
      beachPublicId: BEACH_ID,
      title: "Sunset sessions",
      category: "party",
      startsAt: "2026-06-20T10:00:00Z",
      endsAt: "2026-06-20T18:00:00Z",
      isPaidTakeover: false,
      audienceTags: ["friends"],
    });
    expect(result.state).toBe("published");
    const [createUrl, createInit] = calls()[0];
    expect(createUrl).toMatch(/\/events$/);
    expect(createInit.method).toBe("POST");
    const body = JSON.parse(String(createInit.body));
    expect(body.title).toBe("Sunset sessions");
    expect(body.audienceTags).toEqual(["friends"]);
    expect(body.paidTakeover).toBeUndefined();
    const [publishUrl, publishInit] = calls()[1];
    expect(publishUrl).toContain(
      "/events/33333333-3333-4333-8333-333333333333/publish",
    );
    expect(publishInit.method).toBe("POST");
  });

  it("replaceEvent re-publishes a replacement when the original was published", async () => {
    const original = makeEvent(); // published
    const { calls } = stubFetchSequence([
      { ok: true, status: 200, body: draftCreated },
      { ok: true, status: 200, body: publishedCreated },
      { ok: true, status: 200, body: { ...original, state: "cancelled" } },
    ]);
    const result = await replaceEvent(original, {
      beachPublicId: BEACH_ID,
      title: original.title,
      category: original.category,
      startsAt: "2026-06-20T10:00:00Z",
      endsAt: "2026-06-20T18:00:00Z",
      isPaidTakeover: false,
      audienceTags: [],
    });
    expect(result.replacement.state).toBe("published");
    expect(result.originalPublicId).toBe(original.publicId);
    expect(result.originalCancelled).toBe(true);
    expect(result.cancelError).toBeNull();
    const urls = calls().map(([url]) => url);
    expect(urls[0]).toMatch(/\/events$/);
    expect(urls[1]).toContain("/publish");
    expect(urls[2]).toContain(
      "/events/11111111-1111-4111-8111-111111111111/cancel",
    );
  });

  it("replaceEvent skips the publish step when the original was only a draft", async () => {
    const original = makeEvent({ state: "draft" });
    const { calls } = stubFetchSequence([
      { ok: true, status: 200, body: draftCreated },
      { ok: true, status: 200, body: { ...original, state: "cancelled" } },
    ]);
    const result = await replaceEvent(original, {
      beachPublicId: BEACH_ID,
      title: original.title,
      category: original.category,
      startsAt: "2026-06-20T10:00:00Z",
      endsAt: "2026-06-20T18:00:00Z",
      isPaidTakeover: false,
      audienceTags: [],
    });
    expect(result.replacement.state).toBe("draft");
    expect(calls()).toHaveLength(2);
    expect(calls()[1][0]).toContain("/cancel");
  });

  it("replaceEvent surfaces a failed original-cancel instead of throwing", async () => {
    const original = makeEvent({ state: "draft" });
    const { calls } = stubFetchSequence([
      { ok: true, status: 200, body: draftCreated },
      { ok: false, status: 403, body: { error: "event_forbidden" } },
    ]);
    const result = await replaceEvent(original, {
      beachPublicId: BEACH_ID,
      title: original.title,
      category: original.category,
      startsAt: "2026-06-20T10:00:00Z",
      endsAt: "2026-06-20T18:00:00Z",
      isPaidTakeover: false,
      audienceTags: [],
    });
    expect(result.originalCancelled).toBe(false);
    expect(result.cancelError).toBe("event_forbidden");
    expect(result.replacement.publicId).toBe(draftCreated.publicId);
  });

  it("applyTakeoverChange refuses a paid window without a sponsor before any fetch", async () => {
    const { fetchMock } = stubFetchSequence([]);
    await expect(
      applyTakeoverChange(makeEvent(), { isPaid: true, sponsorName: "" }),
    ).rejects.toThrow("sponsor_name_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applyTakeoverChange flips sponsorship via create-replacement + cancel", async () => {
    const original = makeEvent(); // published, organic
    const sponsoredReplacement = makeEvent({
      publicId: "44444444-4444-4444-8444-444444444444",
      state: "published",
      paidTakeover: {
        isPaid: true,
        label: PAID_TAKEOVER_LABEL,
        sponsorName: "Sunblock Co",
      },
    });
    const { calls } = stubFetchSequence([
      {
        ok: true,
        status: 200,
        body: { ...sponsoredReplacement, state: "draft" },
      },
      { ok: true, status: 200, body: sponsoredReplacement },
      { ok: true, status: 200, body: { ...original, state: "cancelled" } },
    ]);
    const result = await applyTakeoverChange(original, {
      isPaid: true,
      sponsorName: "Sunblock Co",
    });
    expect(result.replacement.paidTakeover.isPaid).toBe(true);
    expect(result.replacement.paidTakeover.sponsorName).toBe("Sunblock Co");
    expect(result.originalCancelled).toBe(true);
    const createBody = JSON.parse(String(calls()[0][1].body));
    expect(createBody.isPaidTakeover).toBe(true);
    expect(createBody.sponsorName).toBe("Sunblock Co");
    expect(calls()[2][0]).toContain(
      "/events/11111111-1111-4111-8111-111111111111/cancel",
    );
  });

  it("propagates a create failure without cancelling the original", async () => {
    const original = makeEvent({ state: "draft" });
    const { fetchMock, calls } = stubFetchSequence([
      { ok: false, status: 400, body: { error: "event_window_invalid" } },
    ]);
    await expect(
      replaceEvent(original, {
        beachPublicId: BEACH_ID,
        title: original.title,
        category: original.category,
        startsAt: "2026-06-20T18:00:00Z",
        endsAt: "2026-06-20T10:00:00Z",
        isPaidTakeover: false,
        audienceTags: [],
      }),
    ).rejects.toThrow("event_window_invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls()[0][1].method).toBe("POST");
  });
});

describe("dashboard <-> calendar data flow", () => {
  it("a published created event is what the consumer calendar shows", () => {
    const created = makeEvent({
      publicId: "55555555-5555-4555-8555-555555555555",
      state: "published",
      startsAt: "2026-06-17T10:00:00Z",
      endsAt: "2026-06-17T18:00:00Z",
    });
    const coordinatorList = [created, makeEvent({ state: "draft" })];
    const visible = consumerVisibleEvents(coordinatorList);
    expect(visible.map((event) => event.publicId)).toEqual([created.publicId]);
    const partition = consumerCalendarPartition(coordinatorList, NOW);
    expect(partition.upcoming.map((event) => event.publicId)).toEqual([
      created.publicId,
    ]);
  });
});

describe("earned-vs-paid separation (advertising integrity rule)", () => {
  /**
   * Behavioral pin of the advertising integrity rule: sponsorship owns only
   * the curated/branding layer and can never reach Beach Pulse scoring or
   * live-condition data. (Verified on-disk too: pulse sources contain no
   * sponsor/paidTakeover/isPaid tokens, and the coordinator module never
   * calls pulse/condition endpoints — its fetches go to /api/events only.)
   * These tests assert the boundary at runtime against the real scoring
   * exports instead of scanning sources.
   */
  const audience = "family";
  const now = NOW;

  function makePulseInput(): PulseInput {
    return {
      id: "beach-alpha",
      conditions: {
        observedAt: "2026-06-15T11:00:00Z",
        waveM: 0.6,
        windKmh: 10,
        airTempC: 25,
        waterTempC: 22,
        uvIndex: 5,
        crowdPct: 30,
        cloudPct: 20,
      },
      community: {
        checkIns: [{ audience, at: "2026-06-15T11:30:00Z", kind: "check-in" }],
        vibeVotes: [{ audience, at: "2026-06-15T11:00:00Z", score: 80 }],
      },
    };
  }

  it("PulseInput has no sponsorship surface: BeachEvent's paidTakeover cannot reach computePulse", () => {
    const organic = computePulse(makePulseInput(), { audience, now });
    const again = computePulse(makePulseInput(), { audience, now });
    expect(again.score).toBe(organic.score);
    // The boundary is structural: PulseInput is built only from id/conditions/
    // community — there is no field through which a BeachEvent (and its
    // paidTakeover) can pass. Demonstrate that side by side.
    const sponsored = makeEvent({
      paidTakeover: {
        isPaid: true,
        label: PAID_TAKEOVER_LABEL,
        sponsorName: "Sunblock Co",
      },
    });
    expect(
      (sponsored as unknown as Record<string, unknown>).paidTakeover,
    ).toBeDefined();
    expect(
      (makePulseInput() as unknown as Record<string, unknown>).paidTakeover,
    ).toBeUndefined();
  });

  it("rankByPulse ordering is identical for sponsored and organic windows", () => {
    // Two beaches with identical conditions/community. Whether their event
    // windows are sponsored cannot enter the ranking — PulseInput carries
    // no sponsorship field, so the inputs are literally identical.
    const ranked = rankByPulse(
      [makePulseInput(), { ...makePulseInput(), id: "beach-beta" }],
      { audience, now },
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score).toBe(ranked[1].score);
    // Score is a pure function of the input: same input, same score.
    const single = computePulse(makePulseInput(), { audience, now });
    expect(single.score).toBe(ranked[0].score);
  });

  it("coordinator audience vocabulary mirrors the pulse audience vocabulary", () => {
    // Deliberately duplicated (not imported) in ./types so the modules stay
    // decoupled — this is the drift check. If either side adds an audience
    // the other lacks, this fails loudly.
    const pulseAudiences = Object.keys(AUDIENCE_PROFILES);
    expect(pulseAudiences).toEqual(
      expect.arrayContaining([...EVENT_AUDIENCES]),
    );
    expect(EVENT_AUDIENCES).toEqual(expect.arrayContaining(pulseAudiences));
  });

  /**
   * Source-level invariant, pinned statically so a regression fails the
   * suite: the Beach Pulse scoring sources must never read the sponsorship
   * flag. Sources are loaded via Vite ?raw imports (typed by vite/client)
   * instead of node:fs — the front-end tsconfig has no node types.
   */
  /** Strips JSDoc/line comments so the scan matches code, not prose. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  }

  it("pulse sources contain no sponsorship tokens", () => {
    const FORBIDDEN = /sponsor|paidtakeover|ispaid/i;
    const sources: Record<string, string> = {
      "src/pulse/scoring.ts": pulseScoringSource,
      "src/pulse/types.ts": pulseTypesSource,
      "server/beachPulse.ts": serverPulseSource,
    };
    for (const [name, source] of Object.entries(sources)) {
      expect(
        stripComments(source),
        `${name} must never mention sponsorship`,
      ).not.toMatch(FORBIDDEN);
    }
  });

  /**
   * The mirror of the same rule: the coordinator module may only write
   * event windows through /api/events. It must never touch pulse,
   * condition, day-quality, check-in or sighting endpoints.
   */
  it("coordinator sources never call pulse or condition endpoints", () => {
    const FORBIDDEN = /\/(pulse|conditions|day-quality|check-ins|sightings)/;
    const sources: Record<string, string> = {
      "src/events/coordinator/api.ts": coordinatorApiSource,
      "src/events/coordinator/types.ts": coordinatorTypesSource,
      "src/events/api.ts": eventsApiSource,
    };
    for (const [name, source] of Object.entries(sources)) {
      expect(
        stripComments(source),
        `${name} must never call pulse or condition paths`,
      ).not.toMatch(FORBIDDEN);
    }
  });
});
