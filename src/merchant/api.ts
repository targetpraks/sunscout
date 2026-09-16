/**
 * Merchant settlement API client. Same request pattern as src/bookings/api.ts
 * (shared dev auth header, { data } envelope, error passthrough).
 */
import type { MerchantProfile, SettlementLedgerResponse } from "./types";

const apiBase = import.meta.env.VITE_API_URL ?? "/api";

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-sunscout-user-id": "00000000-0000-7000-8000-000000000001",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `api_${response.status}`);
  }
  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/**
 * Merchants owned by the signed-in user. Empty for non-merchants — the
 * settlement dashboard is gated on this returning at least one row.
 */
export async function fetchMerchantProfiles(): Promise<MerchantProfile[]> {
  const result = await apiRequest<{ data: MerchantProfile[] }>(
    "/merchant/profile",
  );
  return result.data;
}

/** Settlement ledger, payout history and computed balances. */
export async function fetchSettlementLedger(): Promise<SettlementLedgerResponse> {
  const result = await apiRequest<{ data: SettlementLedgerResponse }>(
    "/merchant/settlements/ledger",
  );
  return result.data;
}
