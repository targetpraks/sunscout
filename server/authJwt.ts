import { createPublicKey, createVerify } from "node:crypto";

/**
 * Auth adapter boundary. When SUNSCOUT_JWKS_URL is set (e.g. Clerk's JWKS),
 * requireUser verifies the Authorization: Bearer <jwt> token against the
 * provider keys. Otherwise it falls back to the development header adapter.
 *
 * This is intentionally dependency-free: RS256 verification uses node:crypto.
 * Swap the JWKS client for `jose` once a provider is chosen.
 */

type Jwk = {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
  alg?: string;
};

let cachedKeys: { keys: Jwk[]; at: number } | null = null;
const jwksUrl = process.env.SUNSCOUT_JWKS_URL;
const issuer = process.env.SUNSCOUT_JWT_ISSUER;
const cacheMs = 60_000;

async function fetchJwks(): Promise<Jwk[]> {
  if (!jwksUrl) return [];
  if (cachedKeys && Date.now() - cachedKeys.at < cacheMs)
    return cachedKeys.keys;
  const response = await fetch(jwksUrl, {
    headers: { "user-agent": "SunScout/0.1 auth" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`jwks_${response.status}`);
  const json = (await response.json()) as { keys: Jwk[] };
  cachedKeys = { keys: json.keys ?? [], at: Date.now() };
  return cachedKeys.keys;
}

function base64urlToBuffer(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export async function verifyJwt(
  token: string,
): Promise<{ sub: string } | null> {
  if (!jwksUrl) return null;
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) return null;
  const header = JSON.parse(base64urlToBuffer(headerB64).toString("utf8")) as {
    kid?: string;
    alg: string;
  };
  const payload = JSON.parse(
    base64urlToBuffer(payloadB64).toString("utf8"),
  ) as {
    sub: string;
    iss?: string;
    exp?: number;
  };
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  if (issuer && payload.iss !== issuer) return null;

  const keys = await fetchJwks();
  const key = keys.find((k) => k.kid === header.kid) ?? keys[0];
  if (!key) return null;

  const data = `${headerB64}.${payloadB64}`;
  const signature = base64urlToBuffer(signatureB64);
  const public_key = createPublicKey({
    key: { kty: key.kty, n: key.n, e: key.e, x: key.x, y: key.y, crv: key.crv },
    format: "jwk",
  });
  const algorithm =
    header.alg === "RS256"
      ? "RSA-SHA256"
      : header.alg === "ES256"
        ? "SHA256"
        : "RSA-SHA256";
  const verifier = createVerify(algorithm);
  verifier.update(data);
  verifier.end();
  const ok = verifier.verify(public_key, signature);
  return ok && payload.sub ? { sub: payload.sub } : null;
}

export function authAdapterConfigured(): boolean {
  return Boolean(jwksUrl);
}
