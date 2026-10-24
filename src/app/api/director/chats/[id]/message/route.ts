import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { formatUsd } from "@/lib/pricing";
import { EFFORTS, MIN_DIRECTOR_BALANCE_MC, runDirector, type DirectorEvent } from "@/lib/director/agent";

export const maxDuration = 300;

const attachment = z.object({ url: z.string().url().startsWith("https://"), kind: z.enum(["image", "video", "audio"]), name: z.string().max(120) });
const body = z.object({
  effort: z.enum(EFFORTS).default("medium"),
  input: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("message"), text: z.string().max(8000), attachments: z.array(attachment).max(10).default([]) }),
    z.object({ kind: z.literal("approval"), decisions: z.record(z.boolean()) }),
    z.object({ kind: z.literal("update") }),
  ]),
});

// Sends the Director a message (or approvals, or a "your generation finished" nudge) and streams
// its reply as newline-delimited JSON events.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");
  if (!process.env.ANTHROPIC_API_KEY) return jsonError(503, "The AI Director is not configured yet.");
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid message.");
  const chat = await db.directorChat.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!chat) return jsonError(404, "Not found.");
  if (user.balanceMc < MIN_DIRECTOR_BALANCE_MC) {
    return jsonError(402, `You need at least ${formatUsd(MIN_DIRECTOR_BALANCE_MC)} of credit to talk to the Director. Top up in Billing.`);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: DirectorEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The browser went away; the request signal stops the Director too.
        }
      };
      await runDirector({ chatId: id, userId: user.id, input: parsed.data.input, effort: parsed.data.effort, emit, signal: req.signal });
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
