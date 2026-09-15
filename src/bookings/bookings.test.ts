import { describe, expect, it } from "vitest";
import {
  computeCancelPreview,
  formatBookingWhen,
  formatMoney,
  isCancellable,
  partitionBookings,
  type MyBooking,
} from "./types";

const NOW = new Date("2026-09-15T12:00:00Z");
const HOUR = 60 * 60 * 1_000;

function makeBooking(overrides: Partial<MyBooking> = {}): MyBooking {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    beachPublicId: "22222222-2222-4222-8222-222222222222",
    beachName: "Praia Test",
    startsAt: new Date(NOW.getTime() + 3 * HOUR).toISOString(),
    endsAt: new Date(NOW.getTime() + 9 * HOUR).toISOString(),
    status: "confirmed",
    totalCents: 8_000,
    currency: "EUR",
    qrToken: "signed.token",
    items: [{ type: "sunbed", quantity: 2, unitPriceCents: 4_000 }],
    ...overrides,
  };
}

describe("computeCancelPreview (mirrors the server policy)", () => {
  it("full refund more than 24 hours out", () => {
    const preview = computeCancelPreview(
      10_000,
      new Date(NOW.getTime() + 24 * HOUR + 1),
      NOW,
    );
    expect(preview).toEqual({
      tier: "full",
      refundCents: 10_000,
      forfeitCents: 0,
    });
  });

  it("50% refund exactly 24 hours out", () => {
    const preview = computeCancelPreview(
      10_001,
      new Date(NOW.getTime() + 24 * HOUR),
      NOW,
    );
    expect(preview.tier).toBe("partial");
    expect(preview.refundCents).toBe(5_001);
    expect(preview.forfeitCents).toBe(5_000);
  });

  it("50% refund exactly 2 hours out", () => {
    const preview = computeCancelPreview(
      9_000,
      new Date(NOW.getTime() + 2 * HOUR),
      NOW,
    );
    expect(preview).toEqual({
      tier: "partial",
      refundCents: 4_500,
      forfeitCents: 4_500,
    });
  });

  it("no refund just under 2 hours out", () => {
    const preview = computeCancelPreview(
      9_000,
      new Date(NOW.getTime() + 2 * HOUR - 1),
      NOW,
    );
    expect(preview).toEqual({
      tier: "none",
      refundCents: 0,
      forfeitCents: 9_000,
    });
  });

  it("no refund once the slot has started", () => {
    const preview = computeCancelPreview(
      9_000,
      new Date(NOW.getTime() - 1),
      NOW,
    );
    expect(preview.tier).toBe("none");
  });
});

describe("partitionBookings", () => {
  it("keeps an in-progress booking in upcoming until its slot ends", () => {
    const inProgress = makeBooking({
      startsAt: new Date(NOW.getTime() - HOUR).toISOString(),
      endsAt: new Date(NOW.getTime() + HOUR).toISOString(),
    });
    const { upcoming, past } = partitionBookings([inProgress], NOW);
    expect(upcoming).toHaveLength(1);
    expect(past).toHaveLength(0);
  });

  it("moves a cancelled future booking to past", () => {
    const cancelled = makeBooking({ status: "cancelled" });
    const { upcoming, past } = partitionBookings([cancelled], NOW);
    expect(upcoming).toHaveLength(0);
    expect(past).toHaveLength(1);
  });

  it("sorts upcoming ascending and past descending by start", () => {
    const early = makeBooking({
      id: "early",
      startsAt: new Date(NOW.getTime() + 2 * HOUR).toISOString(),
      endsAt: new Date(NOW.getTime() + 8 * HOUR).toISOString(),
    });
    const late = makeBooking({
      id: "late",
      startsAt: new Date(NOW.getTime() + 5 * HOUR).toISOString(),
      endsAt: new Date(NOW.getTime() + 11 * HOUR).toISOString(),
    });
    const oldPast = makeBooking({
      id: "old",
      startsAt: new Date(NOW.getTime() - 10 * HOUR).toISOString(),
      endsAt: new Date(NOW.getTime() - 4 * HOUR).toISOString(),
    });
    const recentPast = makeBooking({
      id: "recent",
      startsAt: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
      endsAt: new Date(NOW.getTime() - HOUR).toISOString(),
    });
    const { upcoming, past } = partitionBookings(
      [late, recentPast, early, oldPast],
      NOW,
    );
    expect(upcoming.map((b) => b.id)).toEqual(["early", "late"]);
    expect(past.map((b) => b.id)).toEqual(["recent", "old"]);
  });
});

describe("isCancellable", () => {
  it("allows confirmed bookings only", () => {
    expect(isCancellable(makeBooking())).toBe(true);
    expect(isCancellable(makeBooking({ status: "cancelled" }))).toBe(false);
    expect(isCancellable(makeBooking({ status: "redeemed" }))).toBe(false);
    expect(isCancellable(makeBooking({ status: "pending" }))).toBe(false);
  });
});

describe("formatMoney", () => {
  it("formats minor units as currency", () => {
    expect(formatMoney(8_000, "EUR")).toContain("80");
    expect(formatMoney(4_050, "EUR")).toContain("40.50");
  });
});

describe("formatBookingWhen", () => {
  it("renders date and time window", () => {
    const startsAt = new Date("2026-09-15T10:00:00Z");
    const endsAt = new Date("2026-09-15T16:00:00Z");
    const label = formatBookingWhen(
      startsAt.toISOString(),
      endsAt.toISOString(),
    );
    // Timezone-agnostic: the label must carry the date, the en-dash window,
    // and both endpoints formatted identically to a direct locale call.
    expect(label).toContain("–");
    expect(label).toContain("·");
    expect(label).toContain(
      startsAt.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    );
    expect(label).toContain(
      startsAt.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    expect(label).toContain(
      endsAt.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  });
});
