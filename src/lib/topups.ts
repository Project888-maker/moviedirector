import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { CHECKOUT_APP_TAG } from "./stripe";

/**
 * Adds a paid Checkout Session's amount to its user's balance, exactly once.
 * Called from the Stripe webhook and from the billing page on return from Checkout,
 * whichever arrives first; the unique stripeSessionId makes the second a no-op.
 */
export async function creditCheckoutSession(checkout: Stripe.Checkout.Session): Promise<boolean> {
  // Ignore payments that belong to another site on the same Stripe account.
  if (checkout.metadata?.app !== CHECKOUT_APP_TAG) return false;
  if (checkout.payment_status !== "paid" || !checkout.amount_total) return false;

  const userId = checkout.metadata?.userId;
  const user = userId ? await db.user.findUnique({ where: { id: userId } }) : null;
  if (!user) return false;

  // 1 cent = 1,000 millicents
  const amountMc = checkout.amount_total * 1000;
  try {
    await db.$transaction([
      db.topUp.create({ data: { userId: user.id, stripeSessionId: checkout.id, amountMc } }),
      db.user.update({ where: { id: user.id }, data: { balanceMc: { increment: amountMc } } }),
    ]);
    return true;
  } catch (error) {
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (duplicate) return false;
    throw error;
  }
}
