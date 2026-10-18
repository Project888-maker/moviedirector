import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { finishSession } from "@/lib/billing";
import { jsonError } from "@/lib/http";

// Called by the studio (via sendBeacon) when the user stops or leaves the page.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const { id } = await params;

  const session = await db.renderSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return jsonError(404, "Session not found.");
  await finishSession(session.id, "stopped");
  return NextResponse.json({ ok: true });
}
