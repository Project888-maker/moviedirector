// Service status: the maintenance switch, AI-provider balance alerts, and fal's live balance.
//
// fal and Anthropic are prepaid. When either runs dry, generations fail; this lets the admin pause
// the site with a friendly banner instead, and warns them before (fal) or as soon as (both) it happens.

import type { Prisma } from "@prisma/client";
import { db } from "./db";

export type Provider = "fal" | "anthropic";
export type Maintenance = { on: boolean; message: string; reason: "manual" | "auto" | null; since: string | null };
export type ProviderAlert = { provider: Provider; message: string; at: string };

const MAINTENANCE = "maintenance";
const AUTO_PAUSE = "auto_pause";
const alertKey = (provider: Provider) => `alert:${provider}`;

export const DEFAULT_MAINTENANCE_MESSAGE =
  "We're doing a short maintenance break, so new generations are paused for a few minutes. Your credit is safe.";
/** fal balance below this (USD) shows a warning to admins. */
export const LOW_BALANCE_USD = Number(process.env.LOW_BALANCE_USD ?? "25");

async function read<T>(key: string): Promise<T | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return (row?.value as T) ?? null;
}

async function write(key: string, value: unknown) {
  const json = value as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

export async function getMaintenance(): Promise<Maintenance> {
  return (await read<Maintenance>(MAINTENANCE)) ?? { on: false, message: DEFAULT_MAINTENANCE_MESSAGE, reason: null, since: null };
}

export async function setMaintenance(on: boolean, message?: string, reason: Maintenance["reason"] = "manual") {
  const current = await getMaintenance();
  await write(MAINTENANCE, {
    on,
    message: message?.trim() || current.message || DEFAULT_MAINTENANCE_MESSAGE,
    reason: on ? reason : null,
    since: on ? (current.on ? current.since : new Date().toISOString()) : null,
  } satisfies Maintenance);
}

/** Whether a provider running out of credit should pause the site automatically (on by default). */
export async function getAutoPause(): Promise<boolean> {
  return (await read<boolean>(AUTO_PAUSE)) ?? true;
}

export async function setAutoPause(on: boolean) {
  await write(AUTO_PAUSE, on);
}

export async function getAlerts(): Promise<ProviderAlert[]> {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: "alert:" } } });
  return rows.map((r) => r.value as ProviderAlert);
}

export async function clearAlerts() {
  await db.appSetting.deleteMany({ where: { key: { startsWith: "alert:" } } });
}

/**
 * Records that a provider refused work for lack of credit, and pauses the site if auto-pause is on,
 * so customers see a maintenance banner instead of failed generations.
 */
export async function reportOutOfCredit(provider: Provider, message: string) {
  try {
    await write(alertKey(provider), { provider, message: message.slice(0, 300), at: new Date().toISOString() } satisfies ProviderAlert);
    if ((await getAutoPause()) && !(await getMaintenance()).on) await setMaintenance(true, undefined, "auto");
  } catch (err) {
    console.error("could not record provider alert", err);
  }
}

/** True when a fal error response means the account has no credit left. */
export function isFalOutOfCredit(status: number, body: unknown): boolean {
  const text = JSON.stringify(body ?? "").toLowerCase();
  return status === 402 || (status === 403 && /balance|locked|credit|billing/.test(text));
}

let falBalanceCache: { at: number; value: FalBalance } | null = null;
export type FalBalance = { usd: number } | { error: string };

/** fal's live credit balance, cached for 5 minutes. Needs a key with billing read permission. */
export async function getFalBalance(): Promise<FalBalance> {
  if (falBalanceCache && Date.now() - falBalanceCache.at < 5 * 60_000) return falBalanceCache.value;
  let value: FalBalance;
  try {
    const key = process.env.FAL_BILLING_KEY || process.env.FAL_KEY;
    const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
      headers: { Authorization: `Key ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json().catch(() => null);
    const usd = Number(body?.credits?.current_balance);
    value = res.ok && Number.isFinite(usd)
      ? { usd }
      : { error: res.status === 401 || res.status === 403 ? "Your fal key can't read billing. Add a FAL_BILLING_KEY with billing permission." : `fal returned ${res.status}` };
  } catch {
    value = { error: "Couldn't reach fal's billing API." };
  }
  falBalanceCache = { at: Date.now(), value };
  return value;
}

/** The message customers get when they try to generate during maintenance. */
export async function maintenanceBlock(isAdminUser: boolean): Promise<string | null> {
  if (isAdminUser) return null;
  const m = await getMaintenance();
  return m.on ? m.message : null;
}
