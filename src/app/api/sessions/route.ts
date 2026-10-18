import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { reapStaleSessions } from "@/lib/billing";
import { jsonError } from "@/lib/http";
import { RESOLUTIONS, formatUsd, minStartBalanceMc } from "@/lib/pricing";

const schema = z.object({ resolution: z.enum(RESOLUTIONS) });

// Reserves a billing record before the browser opens the realtime session. The browser then
// talks to fal through /api/fal/proxy?sid=<id>, which is where the actual metering happens.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid resolution.");

  const required = minStartBalanceMc(parsed.data.resolution);
  if (user.balanceMc < required) {
    return jsonError(402, `You need at least ${formatUsd(required)} of credit to start. Top up first.`);
  }
  await reapStaleSessions(user.id);

  const session = await db.renderSession.create({
    data: { userId: user.id, resolution: parsed.data.resolution },
  });
  return NextResponse.json({ id: session.id });
}
