import { describe, expect, it } from "vitest";
import { createBookingToken, verifyBookingToken } from "./tokens";

describe("booking QR tokens", () => {
  it("round-trips a signed token for a booking id", () => {
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    const id = "11111111-2222-3333-4444-555555555555";
    const token = createBookingToken(id, endsAt);
    const verified = verifyBookingToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.bookingPublicId).toBe(id);
    expect(verified?.expired).toBe(false);
  });

  it("rejects a tampered token", () => {
    const endsAt = new Date(Date.now() + 60 * 60 * 1_000);
    const token = createBookingToken(
      "11111111-2222-3333-4444-555555555555",
      endsAt,
    );
    const tampered = `${token.slice(0, -2)}aa`;
    expect(verifyBookingToken(tampered)).toBeNull();
  });

  it("marks an expired token as expired but still verifies the signature", () => {
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000);
    const id = "22222222-3333-4444-5555-666666666666";
    const token = createBookingToken(id, past);
    const verified = verifyBookingToken(token);
    expect(verified?.bookingPublicId).toBe(id);
    expect(verified?.expired).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(verifyBookingToken("not-a-token")).toBeNull();
    expect(verifyBookingToken("")).toBeNull();
  });
});
