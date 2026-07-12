import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const secret =
  process.env.SUNSCOUT_QR_SECRET ??
  "sunscout-dev-qr-secret-change-in-production";
const ttlDays = 7;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createBookingToken(
  bookingPublicId: string,
  endsAt: Date,
): string {
  const exp = Math.floor(endsAt.getTime() / 1000) + ttlDays * 24 * 60 * 60;
  const payload = JSON.stringify({ bid: bookingPublicId, exp });
  const encoded = b64url(payload);
  return `${encoded}.${sign(encoded)}`;
}

export type VerifiedToken = { bookingPublicId: string; expired: boolean };

export function verifyBookingToken(token: string): VerifiedToken | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (typeof payload.bid !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    return {
      bookingPublicId: payload.bid,
      expired: payload.exp * 1000 < Date.now(),
    };
  } catch {
    return null;
  }
}

export function newPublicId(): string {
  return randomUUID();
}
