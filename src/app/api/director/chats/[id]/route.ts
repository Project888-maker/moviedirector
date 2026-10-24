import { NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { publicJob } from "@/lib/jobs";
import { EFFORTS, type Pending } from "@/lib/director/agent";
import { buildTimeline } from "@/lib/director/timeline";

// Everything the chat page shows: the timeline, its generations, pending approvals and settings.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const { id } = await params;
  const chat = await db.directorChat.findFirst({ where: { id, userId: user.id } });
  if (!chat) return jsonError(404, "Not found.");
  const jobs = await db.job.findMany({ where: { chatId: chat.id }, orderBy: { createdAt: "asc" } });
  const pending = chat.pending as unknown as Pending | null;
  return NextResponse.json({
    chat: {
      id: chat.id,
      title: chat.title,
      effort: chat.effort,
      askApproval: chat.askApproval,
      aiChargedMc: chat.aiChargedMc,
      busy: !!chat.lockedUntil && chat.lockedUntil > new Date(),
      unreported: jobs.filter((j) => !j.notified && (j.status === "done" || j.status === "failed")).length,
    },
    timeline: buildTimeline(chat.messages as unknown as Anthropic.Beta.BetaMessageParam[]),
    approvals: pending?.approvals ?? [],
    jobs: jobs.map(publicJob),
    balanceMc: user.balanceMc,
  });
}

const patch = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  effort: z.enum(EFFORTS).optional(),
  askApproval: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const { id } = await params;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid settings.");
  const updated = await db.directorChat.updateMany({ where: { id, userId: user.id }, data: parsed.data });
  if (!updated.count) return jsonError(404, "Not found.");
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  const { id } = await params;
  // Generations stay in My creations; they just lose their link to the chat.
  await db.job.updateMany({ where: { chatId: id, userId: user.id }, data: { chatId: null } });
  await db.directorChat.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
