import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  return NextResponse.json({ email: user.email, balanceMc: user.balanceMc });
}
