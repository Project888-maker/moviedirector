import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clearAlerts, setAutoPause, setMaintenance } from "@/lib/status";

const body = z.object({
  maintenance: z.boolean().optional(),
  message: z.string().max(300).optional(),
  autoPause: z.boolean().optional(),
  clearAlerts: z.boolean().optional(),
});

// Admin controls for the maintenance switch and provider alerts.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.email)) return jsonError(404, "Not found.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid request.");
  const { maintenance, message, autoPause, clearAlerts: clear } = parsed.data;
  if (maintenance !== undefined || message !== undefined) await setMaintenance(maintenance ?? true, message, "manual");
  if (autoPause !== undefined) await setAutoPause(autoPause);
  if (clear) await clearAlerts();
  return NextResponse.json({ ok: true });
}
