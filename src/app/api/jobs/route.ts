import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { JobError, createJob, publicJob } from "@/lib/jobs";
import { findTool, validateValues } from "@/lib/tools";

export const maxDuration = 60;

const schema = z.object({ toolId: z.string(), values: z.record(z.unknown()) });

// Starts a generation from the Create playground. The price is charged up front and refunded if it fails.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid request.");
  const tool = findTool(parsed.data.toolId);
  if (!tool) return jsonError(400, "Unknown tool.");
  const checked = validateValues(tool, parsed.data.values);
  if ("error" in checked) return jsonError(400, checked.error);

  try {
    const job = await createJob(user.id, tool, checked.values);
    const balance = await db.user.findUnique({ where: { id: user.id }, select: { balanceMc: true } });
    return NextResponse.json({ job: publicJob(job), balanceMc: balance?.balanceMc });
  } catch (err) {
    if (err instanceof JobError) return jsonError(err.status, err.message);
    console.error("create job failed", err);
    return jsonError(500, "Something went wrong. You have not been charged.");
  }
}

// The signed-in user's creations, newest first.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const jobs = await db.job.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 60 });
  return NextResponse.json({ jobs: jobs.map(publicJob) });
}
