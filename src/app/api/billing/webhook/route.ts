import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { CHECKOUT_APP_TAG, stripe } from "@/lib/stripe";

// Stripe calls this after a successful payment. Credits are only ever added here,
// never from the browser's success redirect.
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return jsonError(400, "Missing signature.");

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return jsonError(400, "Invalid signature.");
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const checkout = event.data.object;
    // Ignore payments that belong to another site on the same Stripe account.
    if (checkout.metadata?.app !== CHECKOUT_APP_TAG) return NextResponse.json({ received: true });
    const userId = checkout.metadata?.userId;
    const user = userId ? await db.user.findUnique({ where: { id: userId } }) : null;
    if (checkout.payment_status === "paid" && user && checkout.amount_total) {
      // 1 cent = 1,000 millicents
      const amountMc = checkout.amount_total * 1000;
      try {
        await db.$transaction([
          db.topUp.create({ data: { userId: user.id, stripeSessionId: checkout.id, amountMc } }),
          db.user.update({ where: { id: user.id }, data: { balanceMc: { increment: amountMc } } }),
        ]);
      } catch (error) {
        // Stripe retries webhooks; the unique stripeSessionId makes crediting idempotent.
        const duplicate =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
        if (!duplicate) throw error;
      }
    }
  }
  return NextResponse.json({ received: true });
}
