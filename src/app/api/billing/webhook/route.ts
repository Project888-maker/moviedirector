import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { jsonError } from "@/lib/http";
import { stripe } from "@/lib/stripe";
import { creditCheckoutSession } from "@/lib/topups";

// Stripe calls this after a successful payment. It is verified by signature, so it is trusted.
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not set.");
    return jsonError(500, "Webhook not configured.");
  }
  if (!signature) return jsonError(400, "Missing signature.");

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch (error) {
    console.error(
      "Stripe webhook rejected: signature check failed. Is STRIPE_WEBHOOK_SECRET this endpoint's signing secret?",
      error instanceof Error ? error.message : error,
    );
    return jsonError(400, "Invalid signature.");
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await creditCheckoutSession(event.data.object);
  }
  return NextResponse.json({ received: true });
}
