import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { TOP_UP_AMOUNTS_USD, stripe } from "@/lib/stripe";

const schema = z.object({
  amountUsd: z.number().refine((n) => (TOP_UP_AMOUNTS_USD as readonly number[]).includes(n)),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid amount.");

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const checkout = await stripe().checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
    client_reference_id: user.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: parsed.data.amountUsd * 100,
          product_data: { name: `$${parsed.data.amountUsd} MovieDirector credits` },
        },
      },
    ],
    metadata: { userId: user.id },
    success_url: `${appUrl}/billing?success=1`,
    cancel_url: `${appUrl}/billing?canceled=1`,
  });
  return NextResponse.json({ url: checkout.url });
}
