import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { publicJob, refreshJob } from "@/lib/jobs";

// Polled by the browser while a job runs; checks fal and saves the result when it's ready.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const { id } = await params;
  const job = await db.job.findFirst({ where: { id, userId: user.id } });
  if (!job) return jsonError(404, "Not found.");
  try {
    return NextResponse.json({ job: publicJob(await refreshJob(job)) });
  } catch (err) {
    console.error("refresh job failed", err);
    return NextResponse.json({ job: publicJob(job) });
  }
}
