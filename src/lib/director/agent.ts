// The AI Director's agent loop: Claude plans, calls our tools, and pauses for the person's approval
// before spending their credit. Replies stream to the browser as newline-delimited JSON events.
//
// The conversation is stored exactly as sent to Claude and only ever appended to: the model's
// thinking blocks are bound to the conversation that produced them and must be replayed unchanged.

import Anthropic from "@anthropic-ai/sdk";
import { Prisma, type DirectorChat } from "@prisma/client";
import { db } from "../db";
import { MC_PER_USD, markupPercent } from "../pricing";
import { findTool } from "../tools";
import { directorSystemPrompt } from "./prompt";
import {
  DIRECTOR_TOOLS,
  MAX_GENERATIONS_PER_MESSAGE,
  runTool,
  startGeneration,
  type Approval,
  type ToolOutcome,
} from "./tools";

export const DIRECTOR_MODEL = "claude-opus-5-5";
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Smallest balance needed to send the Director a message ($0.05). */
export const MIN_DIRECTOR_BALANCE_MC = 5_000;
const MAX_STEPS = 12;
const LOCK_MS = 6 * 60 * 1000;

// USD per million tokens. Replies the fallback serves on another model are billed at that model's rates;
// an unknown model is billed at the highest tier so a reply never costs us more than we charge.
const TOKEN_PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};
const TOP_TIER = { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 };

// Text markers on user turns the platform writes, so the timeline can tell them from typed messages.
export const ATTACHMENTS_MARKER = "[Attachments]";
export const UPDATE_MARKER = "[Automatic update, not typed by the person]";

export type Attachment = { url: string; kind: "image" | "video" | "audio"; name: string };
export type DirectorInput =
  | { kind: "message"; text: string; attachments: Attachment[] }
  | { kind: "approval"; decisions: Record<string, boolean> }
  | { kind: "update" };

export type DirectorEvent =
  | { t: "thinking"; text: string }
  | { t: "text"; text: string }
  | { t: "step"; label: string }
  | { t: "approval"; approvals: Approval[] }
  | { t: "notice"; text: string }
  | { t: "error"; message: string }
  | { t: "done" };

export type Pending = { results: Anthropic.Beta.BetaToolResultBlockParam[]; approvals: Approval[] };

type Usage = Pick<Anthropic.Beta.BetaUsage, "input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens">;

const client = new Anthropic();

function usageCostMc(model: string, usage: Usage) {
  const price = TOKEN_PRICES[model] ?? TOP_TIER;
  const usd =
    (usage.input_tokens * price.input +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
      usage.output_tokens * price.output) /
    1_000_000;
  return Math.ceil(usd * MC_PER_USD);
}

/** Charges the person for one Claude call. May take the balance a few cents below zero at most. */
async function bill(chat: DirectorChat, model: string, usage: Usage) {
  const costMc = usageCostMc(model, usage);
  if (costMc <= 0) return;
  const chargedMc = Math.ceil(costMc * (1 + markupPercent / 100));
  await db.$transaction([
    db.user.update({ where: { id: chat.userId }, data: { balanceMc: { decrement: chargedMc } } }),
    db.directorChat.update({ where: { id: chat.id }, data: { aiChargedMc: { increment: chargedMc }, aiCostMc: { increment: costMc } } }),
  ]);
}

export function stepLabel(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const tool = typeof i.tool_id === "string" ? findTool(i.tool_id)?.name ?? i.tool_id : "";
  switch (name) {
    case "get_quote":
      return `Checked the price of ${tool}`;
    case "generate":
      return `Generation: ${typeof i.title === "string" ? i.title : tool}`;
    case "check_jobs":
      return "Checked on the generations";
    case "inspect_media":
      return i.kind === "audio" ? "Checked the audio" : i.kind === "image" ? "Looked at the image" : i.kind === "video" ? "Watched the video (first, middle and last frames)" : "Looked at the file";
    case "get_account":
      return "Checked your balance and creations";
    default:
      return name;
  }
}

function toolResult(id: string, outcome: Extract<ToolOutcome, { kind: "result" }>): Anthropic.Beta.BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) };
}

/** Tells the Director about its generations that finished since it last heard, exactly once each. */
async function jobUpdates(chatId: string): Promise<string[]> {
  const finished = await db.job.findMany({ where: { chatId, notified: false, status: { in: ["done", "failed"] } }, orderBy: { createdAt: "asc" } });
  if (!finished.length) return [];
  const claimed = await db.job.updateMany({ where: { id: { in: finished.map((j) => j.id) }, notified: false }, data: { notified: true } });
  if (claimed.count !== finished.length) return [];
  return finished.map((job) => {
    const name = findTool(job.toolId)?.name ?? job.toolId;
    return job.status === "done"
      ? `Generation ${job.id} (${name}) finished. Output: ${job.outputUrls.join(", ")}`
      : `Generation ${job.id} (${name}) failed and was refunded: ${job.error ?? "unknown error"}`;
  });
}

async function claimLock(chatId: string) {
  const now = new Date();
  const claimed = await db.directorChat.updateMany({
    where: { id: chatId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  return claimed.count === 1;
}

async function save(chatId: string, messages: Anthropic.Beta.BetaMessageParam[], pending: Pending | null) {
  await db.directorChat.update({
    where: { id: chatId },
    data: {
      messages: messages as unknown as Prisma.InputJsonValue,
      pending: pending ? (pending as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
}

export async function runDirector(params: {
  chatId: string;
  userId: string;
  input: DirectorInput;
  effort: Effort;
  emit: (event: DirectorEvent) => void;
  signal: AbortSignal;
}) {
  const { chatId, userId, input, effort, emit, signal } = params;
  if (!(await claimLock(chatId))) {
    emit({ t: "error", message: "The Director is still working on your last message." });
    return;
  }

  try {
    const chat = await db.directorChat.findFirstOrThrow({ where: { id: chatId, userId } });
    const messages = (chat.messages as unknown as Anthropic.Beta.BetaMessageParam[]) ?? [];
    const pending = chat.pending as unknown as Pending | null;
    if (input.kind === "update" && pending) return;
    let generations = 0;

    // ---- the person's turn: answers to the last tool calls, job updates, then what they typed
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (pending) {
      content.push(...pending.results);
      for (const approval of pending.approvals) {
        const approved = input.kind === "approval" && input.decisions[approval.toolUseId] === true;
        if (approved && generations < MAX_GENERATIONS_PER_MESSAGE) {
          generations++;
          emit({ t: "step", label: `Started ${approval.title}` });
          const outcome = await startGeneration(userId, chatId, approval);
          content.push(toolResult(approval.toolUseId, outcome as Extract<ToolOutcome, { kind: "result" }>));
        } else {
          const why = input.kind === "approval" ? "The person declined this generation." : "The person sent a new message instead of approving this generation.";
          content.push({ type: "tool_result", tool_use_id: approval.toolUseId, content: why });
        }
      }
    }
    const updates = await jobUpdates(chatId);
    if (updates.length) content.push({ type: "text", text: `${UPDATE_MARKER}\n${updates.join("\n")}` });
    if (input.kind === "message") {
      if (input.attachments.length) {
        content.push({
          type: "text",
          text: `${ATTACHMENTS_MARKER}\n${input.attachments.map((a, i) => `${i + 1}. ${a.kind}: ${a.url} (${a.name})`).join("\n")}`,
        });
        for (const a of input.attachments) if (a.kind === "image") content.push({ type: "image", source: { type: "url", url: a.url } });
      }
      if (input.text.trim()) content.push({ type: "text", text: input.text.trim() });
    }
    if (!content.length) return;

    messages.push({ role: "user", content });
    const title = chat.title === "New chat" && input.kind === "message" && input.text.trim() ? input.text.trim().slice(0, 60) : chat.title;
    await db.directorChat.update({ where: { id: chatId }, data: { title, effort } });
    await save(chatId, messages, null);

    // ---- the Director's turn
    for (let step = 0; step < MAX_STEPS; step++) {
      const user = await db.user.findUnique({ where: { id: userId }, select: { balanceMc: true } });
      if ((user?.balanceMc ?? 0) < MIN_DIRECTOR_BALANCE_MC) {
        emit({ t: "error", message: "Your credit is too low for the Director to keep working. Top up in Billing to continue." });
        return;
      }

      const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
      let model = DIRECTOR_MODEL;
      const stream = client.beta.messages.stream(
        {
          model: DIRECTOR_MODEL,
          max_tokens: 32000,
          system: [{ type: "text", text: directorSystemPrompt(), cache_control: { type: "ephemeral" } }],
          tools: DIRECTOR_TOOLS,
          messages,
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort },
          cache_control: { type: "ephemeral" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );

      let message: Anthropic.Beta.BetaMessage;
      try {
        for await (const event of stream) {
          if (event.type === "message_start") {
            model = event.message.model;
            Object.assign(usage, event.message.usage);
          } else if (event.type === "message_delta") {
            usage.output_tokens = event.usage.output_tokens;
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") emit({ t: "text", text: event.delta.text });
            else if (event.delta.type === "thinking_delta") emit({ t: "thinking", text: event.delta.thinking });
          }
        }
        message = await stream.finalMessage();
      } catch (err) {
        await bill(chat, model, usage).catch(() => {});
        if (signal.aborted) return;
        console.error("director stream failed", err);
        const busy = err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500);
        emit({ t: "error", message: busy ? "The AI is busy right now. Try again in a minute." : "Something went wrong. Try sending your message again." });
        return;
      }

      await bill(chat, message.model, message.usage);
      messages.push({ role: "assistant", content: message.content });
      await save(chatId, messages, null);

      if (message.stop_reason === "pause_turn") continue;
      const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      // A refusal or the token limit can cut a tool call off mid-input: never run it, but answer it so
      // the conversation stays valid for the next message.
      if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") {
        if (calls.length) {
          messages.push({
            role: "user",
            content: calls.map((c) => ({ type: "tool_result" as const, tool_use_id: c.id, content: "Not run: the reply was cut off.", is_error: true })),
          });
          await save(chatId, messages, null);
        }
        if (message.stop_reason === "refusal") emit({ t: "notice", text: "The Director can't help with that request." });
        else emit({ t: "error", message: "The reply was cut off. Try asking for less at once." });
        return;
      }
      if (!calls.length) return;

      // Run this turn's tool calls together; generations wait for approval or run within the cap.
      const outcomes = await Promise.all(
        calls.map(async (call): Promise<[Anthropic.Beta.BetaToolUseBlock, ToolOutcome]> => {
          if (call.name === "generate" && generations >= MAX_GENERATIONS_PER_MESSAGE) {
            return [call, { kind: "result", content: "Limit reached for this message. Ask the person before starting more generations.", isError: true }];
          }
          if (call.name === "generate") generations++;
          return [call, await runTool(call.name, call.input, { userId, chatId, askApproval: chat.askApproval, toolUseId: call.id })];
        }),
      );
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      const approvals: Approval[] = [];
      for (const [call, outcome] of outcomes) {
        if (outcome.kind === "approval") approvals.push(outcome.approval);
        else {
          results.push(toolResult(call.id, outcome));
          emit({ t: "step", label: stepLabel(call.name, call.input) });
        }
      }

      if (approvals.length) {
        await save(chatId, messages, { results, approvals });
        emit({ t: "approval", approvals });
        return;
      }
      messages.push({ role: "user", content: results });
      await save(chatId, messages, null);
    }
    emit({ t: "notice", text: "The Director paused after many steps. Send a message to continue." });
  } finally {
    await db.directorChat.update({ where: { id: chatId }, data: { lockedUntil: null } }).catch(() => {});
    emit({ t: "done" });
  }
}
