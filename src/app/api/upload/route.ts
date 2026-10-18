import { NextResponse } from "next/server";
import { createFalClient } from "@fal-ai/client";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

const MAX_BYTES = 10 * 1024 * 1024;
const fal = createFalClient({ credentials: () => process.env.FAL_KEY });

// Uploads a reference image to fal storage server-side, so the browser never needs fal access.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(400, "No file uploaded.");
  if (!file.type.startsWith("image/")) return jsonError(400, "Only images are supported.");
  if (file.size > MAX_BYTES) return jsonError(400, "Images must be 10 MB or smaller.");

  const url = await fal.storage.upload(file);
  return NextResponse.json({ url });
}
