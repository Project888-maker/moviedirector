// Runs Create playground jobs on fal's queue: price up front, debit, submit, poll, refund on failure.

import type { Job } from "@prisma/client";
import { db } from "./db";
import { MC_PER_USD, formatUsd, markupPercent } from "./pricing";
import { isFalOutOfCredit, reportOutOfCredit } from "./status";
import { extractOutputs, findTool, measuredFields, userPriceMc, type Durations, type FollowUpSpec, type OutputType, type Tool, type Values } from "./tools";

const QUEUE_HOST = "queue.fal.run";
// After this long without a result we give up, mark the job failed and refund it.
const JOB_TIMEOUT_MS = 45 * 60 * 1000;
// The optional second step (e.g. subtitles after a dub) gets this long before we deliver the first result alone.
const FOLLOW_UP_TIMEOUT_MS = 30 * 60 * 1000;

/** Stored on a job that has a second step. Prices are the part of the job's price that step accounts for. */
type FollowUp = FollowUpSpec & {
  chargedMc: number;
  falCostMc: number;
  firstOutputs?: string[];
  startedAt?: string;
  statusUrl?: string;
  responseUrl?: string;
};

export class JobError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Thrown when the same job (same tool, same inputs) is still running, so a second click doesn't charge twice. */
export class DuplicateJobError extends JobError {
  constructor(public existing: Job) {
    super(409, "This exact job is already generating. It will appear in Your creations.");
  }
}

/** How long an identical, still-running job blocks a repeat. */
const DUPLICATE_WINDOW_MS = 15 * 60_000;

/** JSON with sorted keys, so inputs compare equal however Postgres ordered them. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function falHeaders() {
  return { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" };
}

/** fal's error responses carry the reason in `detail`: a string, an object with `message`, or a list of validation errors. */
function falErrorMessage(body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof (detail as { message?: unknown }).message === "string") return (detail as { message: string }).message;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string; type?: string };
    if (first?.type === "content_policy_violation") return "The AI's safety filter blocked this request. Try different wording or photos.";
    if (first?.msg) return first.msg;
  }
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : "The AI could not make this. Try changing the prompt or files.";
}

/** Asks fal for the length (in seconds) and picture height of an uploaded video or audio file. */
async function mediaInfo(url: string): Promise<{ duration: number; height: number }> {
  const res = await fetch("https://fal.run/fal-ai/ffmpeg-api/metadata", {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({ media_url: url, extract_frames: false }),
  });
  const body = await res.json().catch(() => null);
  const duration = Number(body?.media?.duration);
  if (!res.ok || !Number.isFinite(duration) || duration <= 0) {
    throw new JobError(400, "We couldn't read that file. Upload an MP4, MOV, MP3, WAV or M4A file.");
  }
  return { duration, height: Number(body?.media?.resolution?.height) || 0 };
}

/** Measures the media that sets a tool's price and checks it is within the allowed length. */
export async function measure(tool: Tool, values: Values): Promise<Durations> {
  const durations: Durations = {};
  for (const field of measuredFields(tool)) {
    const url = (values[field.key] as string[])[0];
    if (!url) continue;
    const { duration: seconds, height } = await mediaInfo(url);
    const { min, max } = field.seconds!;
    if (seconds < min || seconds > max) {
      throw new JobError(400, `${field.label} is ${seconds.toFixed(1)} s long. This tool takes ${min}–${max} seconds.`);
    }
    durations[field.key] = seconds;
    // Some tools charge more for 4K; their price function reads this.
    durations[`${field.key}#height`] = height;
  }
  return durations;
}

export function quote(tool: Tool, values: Values, durations: Durations) {
  const falUsd = tool.cost(values, durations);
  return { falCostMc: Math.ceil(falUsd * MC_PER_USD), chargedMc: userPriceMc(falUsd, markupPercent) };
}

/** Debits the user, records the job and submits it to fal. Refunds if fal refuses it. */
export async function createJob(
  userId: string,
  tool: Tool,
  values: Values,
  chatId?: string,
  opts: { allowDuplicate?: boolean } = {},
): Promise<Job> {
  const durations = await measure(tool, values);
  const { falCostMc, chargedMc } = quote(tool, values, durations);
  const input = tool.input(values, durations);

  if (!opts.allowDuplicate) {
    const running = await db.job.findMany({
      where: { userId, toolId: tool.id, status: { in: ["queued", "running"] }, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const thenSpec = tool.then?.(values) ?? null;
    const key = stableJson({ input, then: thenSpec && { toolId: thenSpec.toolId, values: thenSpec.values } });
    const same = running.find((j) => {
      const f = j.followUp as FollowUp | null;
      return stableJson({ input: j.input, then: f && { toolId: f.toolId, values: f.values } }) === key;
    });
    if (same) throw new DuplicateJobError(same);
  }
  const prompt = typeof values.prompt === "string" ? values.prompt : typeof values.text === "string" ? values.text : null;

  const spec = tool.then?.(values) ?? null;
  let followUp: FollowUp | null = null;
  if (spec) {
    const usd = tool.thenCost?.(values, durations) ?? 0;
    followUp = { ...spec, chargedMc: Math.min(chargedMc, userPriceMc(usd, markupPercent)), falCostMc: Math.ceil(usd * MC_PER_USD) };
  }

  const job = await db.$transaction(async (tx) => {
    const debit = await tx.user.updateMany({
      where: { id: userId, balanceMc: { gte: chargedMc } },
      data: { balanceMc: { decrement: chargedMc } },
    });
    if (debit.count === 0) throw new JobError(402, "Not enough credit for this. Top up to continue.");
    return tx.job.create({
      data: {
        userId,
        toolId: tool.id,
        endpoint: tool.endpoint,
        prompt: prompt?.slice(0, 2500) || null,
        input: input as object,
        outputType: tool.output,
        chargedMc,
        falCostMc,
        chatId,
        followUp: followUp ?? undefined,
      },
    });
  });

  try {
    const res = await fetch(`https://${QUEUE_HOST}/${tool.endpoint}`, {
      method: "POST",
      headers: falHeaders(),
      body: JSON.stringify(input),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.request_id) {
      console.error("fal submit failed", tool.endpoint, res.status, JSON.stringify(body)?.slice(0, 500));
      if (isFalOutOfCredit(res.status, body)) await reportOutOfCredit("fal", JSON.stringify(body)?.slice(0, 300) ?? `HTTP ${res.status}`);
      const message = res.status === 403 || res.status === 402
        ? "The AI service is temporarily unavailable. You have not been charged."
        : falErrorMessage(body);
      return failJob(job, message);
    }
    return db.job.update({
      where: { id: job.id },
      data: { falRequestId: body.request_id, statusUrl: body.status_url, responseUrl: body.response_url },
    });
  } catch (err) {
    console.error("fal submit error", tool.endpoint, err);
    return failJob(job, "Couldn't reach the AI service. You have not been charged.");
  }
}

/** Marks a job failed and refunds it, exactly once. */
async function failJob(job: Job, error: string): Promise<Job> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.job.updateMany({
      where: { id: job.id, refunded: false, status: { in: ["queued", "running"] } },
      data: { status: "failed", error, refunded: true, completedAt: new Date() },
    });
    if (claimed.count === 1) {
      await tx.user.update({ where: { id: job.userId }, data: { balanceMc: { increment: job.chargedMc } } });
    }
    return tx.job.findUniqueOrThrow({ where: { id: job.id } });
  });
}

function queueUrl(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).host === QUEUE_HOST ? url : null;
  } catch {
    return null;
  }
}

/** Checks fal for progress on an unfinished job and saves the result when it's ready. */
export async function refreshJob(job: Job): Promise<Job> {
  if (job.status === "done" || job.status === "failed") return job;
  if (job.stage === 2) return refreshFollowUp(job);
  const statusUrl = queueUrl(job.statusUrl);
  const responseUrl = queueUrl(job.responseUrl);
  if (!statusUrl || !responseUrl) {
    return Date.now() - job.createdAt.getTime() > 60_000 ? failJob(job, "The job never started. You have been refunded.") : job;
  }

  const statusRes = await fetch(statusUrl, { headers: falHeaders(), cache: "no-store" });
  const status = await statusRes.json().catch(() => null);
  if (!statusRes.ok || !status?.status) return job;

  if (status.status !== "COMPLETED") {
    if (Date.now() - job.createdAt.getTime() > JOB_TIMEOUT_MS) return failJob(job, "This took too long and was cancelled. You have been refunded.");
    if (status.status === "IN_PROGRESS" && job.status === "queued") {
      return db.job.update({ where: { id: job.id }, data: { status: "running" } });
    }
    return job;
  }

  const res = await fetch(responseUrl, { headers: falHeaders(), cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || status.error) {
    console.error("fal job failed", job.endpoint, res.status, JSON.stringify(body)?.slice(0, 500));
    return failJob(job, `${falErrorMessage(body ?? { error: status.error })} You have been refunded.`);
  }
  const outputUrls = extractOutputs(job.outputType as OutputType, body);
  if (!outputUrls.length) return failJob(job, "The AI returned no result. You have been refunded.");
  if (job.followUp) return startFollowUp(job, outputUrls);

  await db.job.updateMany({
    where: { id: job.id, status: { in: ["queued", "running"] } },
    data: { status: "done", outputUrls, completedAt: new Date() },
  });
  return db.job.findUniqueOrThrow({ where: { id: job.id } });
}

// ------------------------------------------------------------------ second step

/** Submits a request to fal's queue. Returns its polling URLs, or null if fal refused it. */
async function submitToFal(endpoint: string, input: unknown) {
  const res = await fetch(`https://${QUEUE_HOST}/${endpoint}`, { method: "POST", headers: falHeaders(), body: JSON.stringify(input) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.request_id) {
    console.error("fal submit failed", endpoint, res.status, JSON.stringify(body)?.slice(0, 500));
    if (isFalOutOfCredit(res.status, body)) await reportOutOfCredit("fal", JSON.stringify(body)?.slice(0, 300) ?? `HTTP ${res.status}`);
    return null;
  }
  return { statusUrl: body.status_url as string, responseUrl: body.response_url as string };
}

/** The first step finished: claim stage 2 (once, even with several tabs polling) and submit the second tool. */
async function startFollowUp(job: Job, firstOutputs: string[]): Promise<Job> {
  const follow = job.followUp as FollowUp;
  const claimed = await db.job.updateMany({
    where: { id: job.id, stage: 1, status: { in: ["queued", "running"] } },
    data: { stage: 2, status: "running", followUp: { ...follow, firstOutputs, startedAt: new Date().toISOString() } },
  });
  const current = await db.job.findUniqueOrThrow({ where: { id: job.id } });
  if (claimed.count === 0) return current;

  const tool = findTool(follow.toolId);
  if (!tool) return finishWithoutFollowUp(current, "The extra step isn't available.");
  try {
    const values: Values = { ...follow.values, [follow.field]: [firstOutputs[0]] };
    const submitted = await submitToFal(tool.endpoint, tool.input(values, {}));
    if (!submitted) return finishWithoutFollowUp(current, `${tool.name} couldn't start.`);
    return db.job.update({
      where: { id: job.id },
      data: { followUp: { ...(current.followUp as FollowUp), statusUrl: submitted.statusUrl, responseUrl: submitted.responseUrl } },
    });
  } catch (err) {
    console.error("follow-up submit error", follow.toolId, err);
    return finishWithoutFollowUp(current, `${tool.name} couldn't start.`);
  }
}

/** Polls the second step and finishes the job with its result. */
async function refreshFollowUp(job: Job): Promise<Job> {
  const follow = job.followUp as FollowUp;
  const tool = findTool(follow.toolId);
  const statusUrl = queueUrl(follow.statusUrl ?? null);
  const responseUrl = queueUrl(follow.responseUrl ?? null);
  const startedAt = follow.startedAt ? new Date(follow.startedAt).getTime() : job.createdAt.getTime();
  if (!tool || !statusUrl || !responseUrl) {
    // Submission may still be in flight in another request; give it a minute before giving up.
    return Date.now() - startedAt > 60_000 ? finishWithoutFollowUp(job, "The extra step never started.") : job;
  }
  const statusRes = await fetch(statusUrl, { headers: falHeaders(), cache: "no-store" });
  const status = await statusRes.json().catch(() => null);
  if (!statusRes.ok || !status?.status) return job;
  if (status.status !== "COMPLETED") {
    return Date.now() - startedAt > FOLLOW_UP_TIMEOUT_MS ? finishWithoutFollowUp(job, `${tool.name} took too long.`) : job;
  }
  const res = await fetch(responseUrl, { headers: falHeaders(), cache: "no-store" });
  const body = await res.json().catch(() => null);
  const outputs = res.ok && !status.error ? extractOutputs(tool.output, body) : [];
  if (!outputs.length) {
    console.error("follow-up failed", follow.toolId, res.status, JSON.stringify(body)?.slice(0, 500));
    return finishWithoutFollowUp(job, `${tool.name} failed: ${falErrorMessage(body ?? { error: status.error })}`);
  }
  await db.job.updateMany({
    where: { id: job.id, stage: 2, status: "running" },
    data: { status: "done", outputUrls: [outputs[0], ...(follow.firstOutputs ?? [])], completedAt: new Date() },
  });
  return db.job.findUniqueOrThrow({ where: { id: job.id } });
}

/** Delivers the first result on its own and refunds the second step's share, exactly once. */
async function finishWithoutFollowUp(job: Job, reason: string): Promise<Job> {
  const follow = job.followUp as FollowUp;
  return db.$transaction(async (tx) => {
    const done = await tx.job.updateMany({
      where: { id: job.id, stage: 2, status: "running" },
      data: {
        status: "done",
        outputUrls: follow.firstOutputs ?? [],
        error: `${reason.trim().replace(/[.!]?$/, ".")} Here is the result without it; ${formatUsd(follow.chargedMc)} for that step is back in your balance.`,
        chargedMc: { decrement: follow.chargedMc },
        falCostMc: { decrement: follow.falCostMc },
        completedAt: new Date(),
      },
    });
    if (done.count === 1) await tx.user.update({ where: { id: job.userId }, data: { balanceMc: { increment: follow.chargedMc } } });
    return tx.job.findUniqueOrThrow({ where: { id: job.id } });
  });
}

/** The fields the browser needs, without fal's internal URLs. */
export function publicJob(job: Job) {
  return {
    id: job.id,
    toolId: job.toolId,
    status: job.status,
    prompt: job.prompt,
    outputType: job.outputType,
    outputUrls: job.outputUrls,
    error: job.error,
    // Set while the second step (e.g. subtitles) runs, and to name what the first result lacks.
    stage: job.stage,
    followUpToolId: (job.followUp as FollowUp | null)?.toolId ?? null,
    chargedMc: job.chargedMc,
    createdAt: job.createdAt.toISOString(),
  };
}

export type PublicJob = ReturnType<typeof publicJob>;
