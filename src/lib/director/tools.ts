// The tools the AI Director can call, and what running each one does on our side.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "../db";
import { JobError, createJob, measure, publicJob, quote, refreshJob } from "../jobs";
import { formatUsd } from "../pricing";
import { TIERS, findTool, validateValues, type Values } from "../tools";

type ToolResultContent = Exclude<Anthropic.Beta.BetaToolResultBlockParam["content"], undefined>;

/** Generations above this price always ask, even when the person turned approval off. */
export const AUTO_APPROVE_LIMIT_MC = 300_000; // $3
/** Most generations the Director may start from one message. */
export const MAX_GENERATIONS_PER_MESSAGE = 6;

const toolInput = { tool_id: z.string(), values: z.record(z.unknown()) };
export const INPUTS = {
  get_quote: z.object(toolInput),
  generate: z.object({ ...toolInput, title: z.string().max(120) }),
  check_jobs: z.object({ job_ids: z.array(z.string()).max(20).optional() }),
  inspect_media: z.object({ url: z.string().url(), kind: z.enum(["image", "video", "audio"]).optional() }),
  get_account: z.object({}),
} as const;
export type DirectorToolName = keyof typeof INPUTS;

const valuesSchema = {
  type: "object",
  description: "Inputs for the tool, using the input keys from its catalog entry. Media inputs are lists of URLs.",
  additionalProperties: true,
} as const;

export const DIRECTOR_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "get_quote",
    description:
      "Check inputs for a platform tool and get the exact price the person will pay, without generating anything. Measures uploaded video or audio when its length sets the price. Free.",
    input_schema: {
      type: "object",
      properties: { tool_id: { type: "string", description: "Tool id from the catalog, e.g. heygen-cast" }, values: valuesSchema },
      required: ["tool_id", "values"],
    },
    eager_input_streaming: true,
  },
  {
    name: "generate",
    description:
      "Start a generation with a platform tool. Charges the person's credit (refunded automatically if it fails) and runs in the background. The person approves it in the interface first unless they turned approval off. Returns a job id; you get an automatic update when it finishes.",
    input_schema: {
      type: "object",
      properties: {
        tool_id: { type: "string", description: "Tool id from the catalog" },
        values: valuesSchema,
        title: { type: "string", description: "Short name for this generation shown to the person, e.g. 'Shot 2: the harbor chase'" },
      },
      required: ["tool_id", "values", "title"],
    },
    eager_input_streaming: true,
  },
  {
    name: "check_jobs",
    description: "Get the status and result URLs of generations. Without job_ids, returns every generation from this chat.",
    input_schema: {
      type: "object",
      properties: { job_ids: { type: "array", items: { type: "string" } } },
    },
    eager_input_streaming: true,
  },
  {
    name: "inspect_media",
    description:
      "Look at an image, video or audio file by URL. Images are shown to you. Videos return their length, size, frame rate and whether they have sound, plus the first, middle and last frames as images. Audio returns its length. Use it to check uploads and results before describing them.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "A file URL from the conversation or a tool result" },
        kind: { type: "string", enum: ["image", "video", "audio"] },
      },
      required: ["url"],
    },
    eager_input_streaming: true,
  },
  {
    name: "get_account",
    description: "Get the person's credit balance and their 10 most recent creations from anywhere on the platform.",
    input_schema: { type: "object", properties: {} },
    eager_input_streaming: true,
  },
];

export type Approval = { toolUseId: string; toolId: string; title: string; values: Values; priceMc: number };
export type ToolOutcome =
  | { kind: "result"; content: ToolResultContent; isError?: boolean }
  | { kind: "approval"; approval: Approval };

const json = (value: unknown) => JSON.stringify(value);
const error = (message: string): ToolOutcome => ({ kind: "result", content: message, isError: true });

function falHeaders() {
  return { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" };
}

async function falRun(endpoint: string, body: unknown) {
  const res = await fetch(`https://fal.run/${endpoint}`, { method: "POST", headers: falHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `fal returned ${res.status}`);
  return data;
}

/** Validates a tool + values pair and prices it, measuring media when needed. */
async function priced(userId: string, toolId: string, raw: Record<string, unknown>) {
  const tool = findTool(toolId);
  if (!tool) throw new JobError(400, `Unknown tool_id "${toolId}". Use an id from the catalog.`);
  const checked = validateValues(tool, raw);
  if ("error" in checked) throw new JobError(400, checked.error);
  const durations = await measure(tool, checked.values);
  const { chargedMc } = quote(tool, checked.values, durations);
  const balance = await db.user.findUnique({ where: { id: userId }, select: { balanceMc: true } });
  return { tool, values: checked.values, durations, chargedMc, balanceMc: balance?.balanceMc ?? 0 };
}

async function inspect(url: string, kind?: "image" | "video" | "audio"): Promise<ToolOutcome> {
  if (kind === "image" || (!kind && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url))) {
    return { kind: "result", content: [{ type: "text", text: `Image: ${url}` }, { type: "image", source: { type: "url", url } }] };
  }
  const meta = (await falRun("fal-ai/ffmpeg-api/metadata", { media_url: url, extract_frames: false }))?.media;
  if (!meta) return error("Couldn't read that file.");
  if (meta.media_type === "image") {
    return { kind: "result", content: [{ type: "text", text: `Image: ${url}` }, { type: "image", source: { type: "url", url } }] };
  }
  const facts = {
    type: meta.media_type,
    duration_seconds: meta.duration,
    width: meta.resolution?.width,
    height: meta.resolution?.height,
    fps: meta.fps,
    has_audio: Boolean(meta.audio),
    size_mb: meta.file_size ? Math.round((meta.file_size / 1048576) * 10) / 10 : undefined,
  };
  if (meta.media_type !== "video") return { kind: "result", content: json(facts) };

  const positions = ["first", "middle", "last"] as const;
  const frames = await Promise.all(
    positions.map((frame_type) =>
      falRun("fal-ai/ffmpeg-api/extract-frame", { video_url: url, frame_type })
        .then((d) => d?.images?.[0]?.url as string | undefined)
        .catch(() => undefined),
    ),
  );
  const content: Anthropic.Beta.BetaToolResultBlockParam["content"] = [{ type: "text", text: json(facts) }];
  frames.forEach((frame, i) => {
    if (!frame) return;
    content.push({ type: "text", text: `${positions[i]} frame:` }, { type: "image", source: { type: "url", url: frame } });
  });
  return { kind: "result", content };
}

/**
 * Runs one tool call. `generate` returns an approval request instead of running when the person
 * wants to approve generations (or it is expensive); the caller runs it with `startGeneration`.
 */
export async function runTool(
  name: string,
  input: unknown,
  ctx: { userId: string; chatId: string; askApproval: boolean; toolUseId: string },
): Promise<ToolOutcome> {
  if (!(name in INPUTS)) return error(`Unknown tool ${name}.`);
  const parsed = INPUTS[name as DirectorToolName].safeParse(input);
  if (!parsed.success) return error(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);

  try {
    switch (name as DirectorToolName) {
      case "get_quote": {
        const { tool_id, values } = parsed.data as z.infer<typeof INPUTS.get_quote>;
        const p = await priced(ctx.userId, tool_id, values);
        return {
          kind: "result",
          content: json({
            tool: `${p.tool.name} (${TIERS[p.tool.tier].label})`,
            price: formatUsd(p.chargedMc),
            measured_seconds: Object.keys(p.durations).length ? p.durations : undefined,
            balance: formatUsd(p.balanceMc),
            enough_credit: p.balanceMc >= p.chargedMc,
            values: p.values,
          }),
        };
      }
      case "generate": {
        const { tool_id, values, title } = parsed.data as z.infer<typeof INPUTS.generate>;
        const p = await priced(ctx.userId, tool_id, values);
        if (p.balanceMc < p.chargedMc) {
          return error(`Not enough credit: this costs ${formatUsd(p.chargedMc)} and the balance is ${formatUsd(p.balanceMc)}. Ask the person to top up at /billing.`);
        }
        const approval: Approval = { toolUseId: ctx.toolUseId, toolId: p.tool.id, title, values: p.values, priceMc: p.chargedMc };
        if (ctx.askApproval || p.chargedMc > AUTO_APPROVE_LIMIT_MC) return { kind: "approval", approval };
        return startGeneration(ctx.userId, ctx.chatId, approval);
      }
      case "check_jobs": {
        const { job_ids } = parsed.data as z.infer<typeof INPUTS.check_jobs>;
        const jobs = await db.job.findMany({
          where: { userId: ctx.userId, ...(job_ids?.length ? { id: { in: job_ids } } : { chatId: ctx.chatId }) },
          orderBy: { createdAt: "asc" },
          take: 30,
        });
        const fresh = await Promise.all(jobs.map((job) => refreshJob(job).catch(() => job)));
        return {
          kind: "result",
          content: json(
            fresh.map((job) => ({
              job_id: job.id,
              tool: findTool(job.toolId)?.name ?? job.toolId,
              status: job.status,
              outputs: job.outputUrls,
              error: job.error ?? undefined,
              price: formatUsd(job.chargedMc),
            })),
          ),
        };
      }
      case "inspect_media": {
        const { url, kind } = parsed.data as z.infer<typeof INPUTS.inspect_media>;
        return await inspect(url, kind);
      }
      case "get_account": {
        const [user, jobs] = await Promise.all([
          db.user.findUnique({ where: { id: ctx.userId }, select: { balanceMc: true } }),
          db.job.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 10 }),
        ]);
        return {
          kind: "result",
          content: json({
            balance: formatUsd(user?.balanceMc ?? 0),
            recent_creations: jobs.map((job) => ({
              job_id: job.id,
              tool: findTool(job.toolId)?.name ?? job.toolId,
              status: job.status,
              prompt: job.prompt?.slice(0, 200),
              outputs: job.outputUrls,
            })),
          }),
        };
      }
    }
  } catch (err) {
    if (err instanceof JobError) return error(err.message);
    console.error("director tool failed", name, err);
    return error(err instanceof Error ? err.message : "The tool failed.");
  }
}

/** Charges and submits an approved generation. */
export async function startGeneration(userId: string, chatId: string, approval: Approval): Promise<ToolOutcome> {
  const tool = findTool(approval.toolId);
  if (!tool) return error("Unknown tool.");
  try {
    const job = await createJob(userId, tool, approval.values, chatId);
    if (job.status === "failed") return error(`${job.error ?? "The generation could not start."} The person was not charged.`);
    return {
      kind: "result",
      content: json({
        job_id: job.id,
        status: "started",
        tool: tool.name,
        charged: formatUsd(job.chargedMc),
        usually_takes: tool.time,
        note: "You will receive an automatic update when it finishes.",
      }),
    };
  } catch (err) {
    if (err instanceof JobError) return error(err.message);
    console.error("director generate failed", err);
    return error("The generation could not start. The person was not charged.");
  }
}

export { publicJob };
