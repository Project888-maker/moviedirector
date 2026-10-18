import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const { id } = await params;

  const session = await db.renderSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return jsonError(404, "Session not found.");
  return NextResponse.json({
    status: session.status,
    endReason: session.endReason,
    billedSeconds: session.billedSeconds,
    chargedMc: session.chargedMc,
    balanceMc: user.balanceMc,
  });
}
