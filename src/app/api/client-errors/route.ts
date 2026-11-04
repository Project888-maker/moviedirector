import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

// Playback failures reported by the browser. They land in the Vercel runtime logs as "client-error".
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 204 });
  const text = (await req.text().catch(() => "")).slice(0, 2000);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  console.warn("client-error", JSON.stringify({
    user: user.id,
    event: String(data.event ?? "").slice(0, 20),
    url: String(data.url ?? "").slice(0, 300),
    code: data.code,
    kind: data.kind,
    attempt: data.attempt,
    at: data.at,
    ua: req.headers.get("user-agent")?.slice(0, 200),
  }));
  return new NextResponse(null, { status: 204 });
}
