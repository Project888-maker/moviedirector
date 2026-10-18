import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { startSession } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { usdToMc } from "@/lib/pricing";

const schema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Enter a valid email and a password of 8+ characters.");
  const email = parsed.data.email.toLowerCase();

  if (await db.user.findUnique({ where: { email } })) {
    return jsonError(409, "An account with this email already exists.");
  }
  const user = await db.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(parsed.data.password, 12),
      balanceMc: usdToMc(Number(process.env.SIGNUP_BONUS_USD ?? "0")),
    },
  });
  await startSession(user.id);
  return NextResponse.json({ ok: true });
}
