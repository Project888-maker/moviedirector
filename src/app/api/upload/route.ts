import { NextResponse } from "next/server";
import { createFalClient } from "@fal-ai/client";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// Vercel caps request bodies at 4.5 MB; larger videos go straight to fal via /api/upload/initiate.
const MAX_VIDEO_BYTES = 4 * 1024 * 1024;
const fal = createFalClient({ credentials: () => process.env.FAL_KEY });

// Uploads a reference image, audio clip or short video to fal storage server-side, so the browser never needs fal access.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(400, "No file uploaded.");
  const isImage = file.type.startsWith("image/");
  const isAudio = file.type.startsWith("audio/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isAudio && !isVideo) return jsonError(400, "Only images, videos and audio files are supported.");
  if (isImage && file.size > MAX_IMAGE_BYTES) return jsonError(400, "Images must be 10 MB or smaller.");
  if (isAudio && file.size > MAX_AUDIO_BYTES) return jsonError(400, "Audio files must be 25 MB or smaller.");
  if (isVideo && file.size > MAX_VIDEO_BYTES) return jsonError(400, "Videos must be 4 MB or smaller here.");

  const url = await fal.storage.upload(file);
  return NextResponse.json({ url });
}
