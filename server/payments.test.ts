import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The payments adapter reads its configuration at module load, so each test
 * resets the module registry and sets the environment before importing.
 */
async function loadPayments() {
  vi.resetModules();
  return import("./payments");
}

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("payments configuration", () => {
  it("reports unconfigured when no Stripe secret is set", async () => {
    const payments = await loadPayments();
    expect(payments.paymentsConfigured()).toBe(false);
    expect(payments.webhookSecretConfigured()).toBe(false);
  });

  it("reports configured when the Stripe secrets are set", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
    const payments = await loadPayments();
    expect(payments.paymentsConfigured()).toBe(true);
    expect(payments.webhookSecretConfigured()).toBe(true);
  });

  it("treats the webhook secret as independent of the API key", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
    const payments = await loadPayments();
    expect(payments.paymentsConfigured()).toBe(false);
    expect(payments.webhookSecretConfigured()).toBe(true);
  });
});

describe("simulated checkout", () => {
  it("creates a simulated prepayment session when Stripe is unset", async () => {
    const payments = await loadPayments();
    const session = await payments.createCheckoutSession({
      bookingPublicId: "bk-123",
      amountCents: 3200,
      beachName: "Cove Beach",
    });
    expect(session.simulated).toBe(true);
    expect(session.url).toBe("sunscout://booking/bk-123/simulated");
    expect(session.id).toBe("simulated_bk-123");
  });

  it("rejects checkout creation if Stripe errors", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    const payments = await loadPayments();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 402 }),
    );
    try {
      await expect(
        payments.createCheckoutSession({
          bookingPublicId: "bk-123",
          amountCents: 3200,
          beachName: "Cove Beach",
        }),
      ).rejects.toThrow("stripe_402");
    } finally {
      vi.unstubAllGlobals();
      void originalFetch;
    }
  });
});
