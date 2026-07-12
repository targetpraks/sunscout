/**
 * Payments adapter boundary. When STRIPE_SECRET_KEY is set, checkout sessions
 * are created against Stripe test mode. Otherwise the booking flow uses the
 * simulated prepayment state (PRD Release 0). Webhook signature verification
 * uses STRIPE_WEBHOOK_SECRET when configured.
 */
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export function paymentsConfigured(): boolean {
  return Boolean(stripeSecret);
}

export type CheckoutSession = {
  url: string;
  id: string;
  simulated: boolean;
};

export async function createCheckoutSession(input: {
  bookingPublicId: string;
  amountCents: number;
  beachName: string;
}): Promise<CheckoutSession> {
  if (!stripeSecret) {
    return {
      url: `sunscout://booking/${input.bookingPublicId}/simulated`,
      id: `simulated_${input.bookingPublicId}`,
      simulated: true,
    };
  }
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${stripeSecret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": "card",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][product_data][name]": `SunScout · ${input.beachName}`,
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][quantity]": "1",
      success_url: `sunscout://booking/${input.bookingPublicId}/success`,
      cancel_url: `sunscout://booking/${input.bookingPublicId}/cancel`,
      "metadata[booking_public_id]": input.bookingPublicId,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`stripe_${response.status}`);
  }
  const json = (await response.json()) as { id: string; url: string };
  return { url: json.url, id: json.id, simulated: false };
}

export function webhookSecretConfigured(): boolean {
  return Boolean(webhookSecret);
}
