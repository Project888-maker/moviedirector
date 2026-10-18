import Stripe from "stripe";

let client: Stripe | null = null;

export function stripe() {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key);
  }
  return client;
}

// Tags our Checkout Sessions, so a Stripe account shared with another site
// never credits its payments here (its webhooks receive ours, and ours theirs).
export const CHECKOUT_APP_TAG = "aimoviedirector";

export const TOP_UP_AMOUNTS_USD = [10, 25, 50, 100] as const;
