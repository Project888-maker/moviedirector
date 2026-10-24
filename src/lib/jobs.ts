// Runs Create playground jobs on fal's queue: price up front, debit, submit, poll, refund on failure.

import type { Job } from "@prisma/client";
import { db } from "./db";
import { MC_PER_USD, markupPercent } from "./pricing";
import { extractOutputs, measuredFields, userPriceMc, type Durations, type OutputType, type Tool, type Values } from "./tools";

const QUEUE_HOST = "queue.fal.run";
// After this long without a result we give up, mark the job failed and refund it.
const JOB_TIMEOUT_MS = 45 * 60 * 1000;

export class JobError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
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

/** Asks fal for the length of an uploaded video or audio file, in seconds. */
async function mediaDuration(url: string): Promise<number> {
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
  return duration;
}

/** Measures the media that sets a tool's price and checks it is within the allowed length. */
export async function measure(tool: Tool, values: Values): Promise<Durations> {
  const durations: Durations = {};
  for (const field of measuredFields(tool)) {
    const url = (values[field.key] as string[])[0];
    if (!url) continue;
    const seconds = await mediaDuration(url);
    const { min, max } = field.seconds!;
    if (seconds < min || seconds > max) {
      throw new JobError(400, `${field.label} is ${seconds.toFixed(1)} s long. This tool takes ${min}–${max} seconds.`);
    }
    durations[field.key] = seconds;
  }
  return durations;
}

export function quote(tool: Tool, values: Values, durations: Durations) {
  const falUsd = tool.cost(values, durations);
  return { falCostMc: Math.ceil(falUsd * MC_PER_USD), chargedMc: userPriceMc(falUsd, markupPercent) };
}

/** Debits the user, records the job and submits it to fal. Refunds if fal refuses it. */
export async function createJob(userId: string, tool: Tool, values: Values): Promise<Job> {
  const durations = await measure(tool, values);
  const { falCostMc, chargedMc } = quote(tool, values, durations);
  const input = tool.input(values, durations);
  const prompt = typeof values.prompt === "string" ? values.prompt : typeof values.text === "string" ? values.text : null;

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

  await db.job.updateMany({
    where: { id: job.id, status: { in: ["queued", "running"] } },
    data: { status: "done", outputUrls, completedAt: new Date() },
  });
  return db.job.findUniqueOrThrow({ where: { id: job.id } });
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
    chargedMc: job.chargedMc,
    createdAt: job.createdAt.toISOString(),
  };
}

export type PublicJob = ReturnType<typeof publicJob>;
