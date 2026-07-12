import { describe, expect, it } from "vitest";
import { computeSettlement, computeRefund } from "./billing";

describe("settlement math", () => {
  it("splits gross into commission and net at the configured rate", () => {
    const result = computeSettlement(3200, 500); // 5%
    expect(result.grossCents).toBe(3200);
    expect(result.commissionCents).toBe(160);
    expect(result.netCents).toBe(3040);
  });

  it("rounds commission to the nearest cent", () => {
    const result = computeSettlement(333, 500);
    expect(result.commissionCents).toBe(Math.round((333 * 500) / 10_000));
    expect(result.netCents).toBe(333 - result.commissionCents);
  });

  it("charges zero commission at 0 bps", () => {
    const result = computeSettlement(1000, 0);
    expect(result.commissionCents).toBe(0);
    expect(result.netCents).toBe(1000);
  });

  it("rejects negative gross and out-of-range basis points", () => {
    expect(() => computeSettlement(-1, 500)).toThrow();
    expect(() => computeSettlement(1000, 10_001)).toThrow();
  });
});

describe("refund math", () => {
  const start = new Date("2026-07-01T10:00:00Z");
  it("refunds fully when cancelling more than 24h before start", () => {
    const result = computeRefund(3500, start, new Date("2026-06-30T09:00:00Z"));
    expect(result.tier).toBe("full");
    expect(result.refundCents).toBe(3500);
    expect(result.forfeitCents).toBe(0);
  });

  it("refunds 50% when cancelling inside 24h before start", () => {
    const result = computeRefund(3500, start, new Date("2026-07-01T09:00:00Z"));
    expect(result.tier).toBe("partial");
    expect(result.refundCents).toBe(1750);
    expect(result.forfeitCents).toBe(1750);
  });

  it("refunds nothing once the slot has started", () => {
    const result = computeRefund(3500, start, new Date("2026-07-01T10:30:00Z"));
    expect(result.tier).toBe("none");
    expect(result.refundCents).toBe(0);
    expect(result.forfeitCents).toBe(3500);
  });

  it("rejects negative totals", () => {
    expect(() =>
      computeRefund(-1, start, new Date("2026-06-30T09:00:00Z")),
    ).toThrow();
  });
});
