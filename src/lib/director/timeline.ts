// Turns a stored Claude conversation into what the chat page shows: the person's messages,
// automatic updates, and the Director's replies with their working steps and generations.

import type Anthropic from "@anthropic-ai/sdk";
import { ATTACHMENTS_MARKER, UPDATE_MARKER, stepLabel, type Attachment } from "./agent";

export type TimelinePart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "step"; label: string; error?: boolean }
  | { type: "job"; jobId: string };

export type TimelineItem =
  | { kind: "user"; id: string; text: string; attachments: Attachment[] }
  | { kind: "update"; id: string; text: string }
  | { kind: "director"; id: string; parts: TimelinePart[] };

function resultText(block: Anthropic.Beta.BetaToolResultBlockParam): string {
  if (typeof block.content === "string") return block.content;
  return (block.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

function parseAttachments(text: string): Attachment[] {
  return text
    .split("\n")
    .slice(1)
    .map((line) => line.match(/^\d+\. (image|video|audio): (\S+) \((.*)\)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ kind: m[1] as Attachment["kind"], url: m[2], name: m[3] }));
}

export function buildTimeline(messages: Anthropic.Beta.BetaMessageParam[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  // Tool results arrive in the user turn after the call; index them first.
  const results = new Map<string, Anthropic.Beta.BetaToolResultBlockParam>();
  for (const m of messages) {
    if (m.role === "user" && Array.isArray(m.content)) {
      for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, b);
    }
  }

  let director: Extract<TimelineItem, { kind: "director" }> | null = null;
  messages.forEach((m, index) => {
    const blocks = (typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content) ?? [];
    if (m.role === "assistant") {
      if (!director) {
        director = { kind: "director", id: `d${index}`, parts: [] };
        items.push(director);
      }
      for (const b of blocks) {
        if (b.type === "text" && b.text.trim()) director.parts.push({ type: "text", text: b.text });
        else if (b.type === "thinking" && b.thinking.trim()) director.parts.push({ type: "thinking", text: b.thinking });
        else if (b.type === "tool_use") {
          const result = results.get(b.id);
          const text = result ? resultText(result) : "";
          const jobId = b.name === "generate" ? text.match(/"job_id":"([^"]+)"/)?.[1] : undefined;
          if (jobId) director.parts.push({ type: "job", jobId });
          else if (!result && b.name === "generate") director.parts.push({ type: "step", label: `Proposed: ${stepLabel(b.name, b.input).replace(/^Generation: /, "")}` });
          else director.parts.push({ type: "step", label: stepLabel(b.name, b.input), error: result?.is_error === true });
        }
      }
      return;
    }

    let typed = "";
    let attachments: Attachment[] = [];
    for (const b of blocks) {
      if (b.type !== "text") continue;
      if (b.text.startsWith(UPDATE_MARKER)) {
        items.push({ kind: "update", id: `u${index}`, text: b.text.slice(UPDATE_MARKER.length).trim() });
        director = null;
      } else if (b.text.startsWith(ATTACHMENTS_MARKER)) attachments = parseAttachments(b.text);
      else typed += (typed ? "\n" : "") + b.text;
    }
    if (typed || attachments.length) {
      items.push({ kind: "user", id: `m${index}`, text: typed, attachments });
      director = null;
    }
  });
  return items;
}

/** Every file the person attached in a chat, newest last. */
export function chatAttachments(items: TimelineItem[]): Attachment[] {
  return items.flatMap((item) => (item.kind === "user" ? item.attachments : []));
}
