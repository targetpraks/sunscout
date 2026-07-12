export type SettlementBreakdown = {
  grossCents: number;
  commissionCents: number;
  netCents: number;
};

export function computeSettlement(
  grossCents: number,
  commissionBasisPoints: number,
): SettlementBreakdown {
  if (grossCents < 0) throw new Error("gross_cents_negative");
  if (commissionBasisPoints < 0 || commissionBasisPoints > 10_000) {
    throw new Error("commission_basis_points_out_of_range");
  }
  const commissionCents = Math.round(
    (grossCents * commissionBasisPoints) / 10_000,
  );
  return {
    grossCents,
    commissionCents,
    netCents: grossCents - commissionCents,
  };
}

export type RefundResult = {
  refundCents: number;
  forfeitCents: number;
  tier: "full" | "partial" | "none";
};

/**
 * PRD §8.8: free cancellation until 24 hours before start; 50% refund inside
 * 24 hours; no refund once the slot has started (treated as no-show).
 */
export function computeRefund(
  totalCents: number,
  startsAt: Date,
  now: Date = new Date(),
): RefundResult {
  if (totalCents < 0) throw new Error("total_cents_negative");
  const msUntilStart = startsAt.getTime() - now.getTime();
  if (msUntilStart >= 24 * 60 * 60 * 1_000) {
    return { refundCents: totalCents, forfeitCents: 0, tier: "full" };
  }
  if (msUntilStart > 0) {
    const refundCents = Math.round(totalCents / 2);
    return {
      refundCents,
      forfeitCents: totalCents - refundCents,
      tier: "partial",
    };
  }
  return { refundCents: 0, forfeitCents: totalCents, tier: "none" };
}
