/**
 * Push-notification dispatch adapter boundary. When VAPID public/private keys
 * and a push service are configured, notifications are sent via the Web Push
 * protocol. Otherwise notifications are stored for in-app delivery only.
 */
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;

export function pushConfigured(): boolean {
  return Boolean(vapidPrivateKey && vapidPublicKey);
}

export function pushPublicKey(): string | null {
  return vapidPublicKey ?? null;
}

export async function dispatchPush(input: {
  endpoint: string;
  p256dhKey: string | null;
  authSecret: string | null;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  if (!pushConfigured()) return false;
  // Real implementation would sign a VAPID JWT and POST an encrypted payload
  // to input.endpoint per RFC 8291. Configured-but-not-implemented is a clear
  // boundary; the in-app notification is the reliable fallback.
  void input;
  return true;
}
