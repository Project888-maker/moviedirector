import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

const MAX_BYTES = { image: 10, audio: 25, video: 100 } as const;
const schema = z.object({ contentType: z.string().max(100), fileName: z.string().max(200), size: z.number().int().positive() });

// Gets a one-time upload link from fal storage so the browser can upload large files directly
// (Vercel functions only accept 4.5 MB request bodies). Returns { uploadUrl, fileUrl }.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid file.");
  const { contentType, fileName, size } = parsed.data;
  const kind = contentType.split("/")[0] as keyof typeof MAX_BYTES;
  if (!(kind in MAX_BYTES)) return jsonError(400, "Only images, videos and audio files are supported.");
  if (size > MAX_BYTES[kind] * 1024 * 1024) return jsonError(400, `${kind[0].toUpperCase()}${kind.slice(1)} files must be ${MAX_BYTES[kind]} MB or smaller.`);

  const res = await fetch("https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType, file_name: fileName.replace(/[^\w.\- ]/g, "_") }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.upload_url || !body?.file_url) {
    console.error("fal upload initiate failed", res.status, JSON.stringify(body)?.slice(0, 300));
    return jsonError(502, "Upload is unavailable right now. Try again in a minute.");
  }
  return NextResponse.json({ uploadUrl: body.upload_url, fileUrl: body.file_url });
}
