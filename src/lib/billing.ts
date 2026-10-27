import { db } from "./db";
import {
  HEARTBEAT_SECONDS,
  MIRROR_MIN_BILLED_SECONDS,
  MIRROR_MODEL_ID,
  isResolution,
  sessionFalCostPerSecondMc,
  sessionPricePerSecondMc,
} from "./pricing";

// A session with no heartbeat for this long is treated as gone (tab closed, network lost).
const STALE_AFTER_MS = 30_000;

export type ChargeResult =
  | { ok: true; balanceMc: number }
  | { ok: false; reason: "inactive" | "insufficient_balance"; balanceMc?: number };

/**
 * Bills a live session for the wall-clock time since it was last charged.
 *
 * The model streams in real time, so wall-clock time tracks the seconds fal bills you for.
 * The session is ended once the user can no longer afford the next heartbeat interval, so an
 * honest client is stopped before the balance would go negative.
 */
export async function chargeSession(
  renderSessionId: string,
  now = new Date(),
  maxSeconds = Infinity,
): Promise<ChargeResult> {
  return db.$transaction(async (tx) => {
    const session = await tx.renderSession.findUnique({ where: { id: renderSessionId } });
    if (!session || session.status !== "active" || !session.lastChargedAt) {
      return { ok: false, reason: "inactive" } as const;
    }
    const resolution = isResolution(session.resolution) ? session.resolution : "1440p";
    const pricePerSecondMc = sessionPricePerSecondMc(session.model, resolution);
    const falPerSecondMc = sessionFalCostPerSecondMc(session.model, resolution);

    // Claim the billing window first so concurrent heartbeats can't bill the same seconds twice.
    const claimed = await tx.renderSession.updateMany({
      where: { id: session.id, lastChargedAt: session.lastChargedAt },
      data: { lastChargedAt: now },
    });
    const user = await tx.user.findUniqueOrThrow({ where: { id: session.userId } });
    if (claimed.count === 0) return { ok: true, balanceMc: user.balanceMc } as const;

    const seconds = Math.min(
      maxSeconds,
      Math.max(0, (now.getTime() - session.lastChargedAt.getTime()) / 1000),
    );
    const priceMc = Math.min(user.balanceMc, Math.ceil(seconds * pricePerSecondMc));
    const falCostMc = Math.ceil(seconds * falPerSecondMc);

    const updated = await tx.user.update({
      where: { id: user.id },
      data: { balanceMc: { decrement: priceMc } },
    });

    const nextTickMc = pricePerSecondMc * HEARTBEAT_SECONDS;
    const exhausted = updated.balanceMc < nextTickMc;

    await tx.renderSession.update({
      where: { id: session.id },
      data: {
        billedSeconds: { increment: seconds },
        chargedMc: { increment: priceMc },
        falCostMc: { increment: falCostMc },
        ...(exhausted
          ? { status: "ended", endedAt: now, endReason: "insufficient_balance" }
          : {}),
      },
    });

    if (exhausted) {
      return { ok: false, reason: "insufficient_balance", balanceMc: updated.balanceMc } as const;
    }
    return { ok: true, balanceMc: updated.balanceMc } as const;
  });
}

/** Charges the final few seconds and closes the session. */
export async function finishSession(renderSessionId: string, reason: string) {
  await chargeSession(renderSessionId, new Date(), HEARTBEAT_SECONDS + 1);
  await chargeMirrorMinimum(renderSessionId);
  await db.renderSession.updateMany({
    where: { id: renderSessionId, status: { in: ["pending", "active"] } },
    data: { status: "ended", endedAt: new Date(), endReason: reason },
  });
  await refundIfNeverLive(renderSessionId);
}

// A session that never showed a frame (for example a network that blocks video calls) is refunded,
// within limits so the refund can't be used to watch for free.
const NO_SHOW_MAX_SECONDS = 90;
const NO_SHOW_REFUNDS_PER_DAY = 3;
export const NO_SHOW_REASON = "never_live_refunded";

async function refundIfNeverLive(renderSessionId: string) {
  await db.$transaction(async (tx) => {
    const session = await tx.renderSession.findUnique({ where: { id: renderSessionId } });
    if (!session || session.liveAt || !session.startedAt || session.chargedMc <= 0) return;
    if (session.billedSeconds > NO_SHOW_MAX_SECONDS || session.endReason === NO_SHOW_REASON) return;
    const recent = await tx.renderSession.count({
      where: { userId: session.userId, endReason: NO_SHOW_REASON, endedAt: { gt: new Date(Date.now() - 86_400_000) } },
    });
    if (recent >= NO_SHOW_REFUNDS_PER_DAY) return;
    const claimed = await tx.renderSession.updateMany({
      where: { id: session.id, liveAt: null, endReason: { not: NO_SHOW_REASON } },
      data: { endReason: NO_SHOW_REASON, chargedMc: 0 },
    });
    if (claimed.count === 1) {
      await tx.user.update({ where: { id: session.userId }, data: { balanceMc: { increment: session.chargedMc } } });
    }
  });
}

/** Ends sessions whose heartbeats stopped without a clean shutdown. */
export async function reapStaleSessions(userId: string) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  await db.renderSession.updateMany({
    where: {
      userId,
      OR: [
        { status: "active", lastChargedAt: { lt: cutoff } },
        { status: "pending", createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      ],
    },
    data: { status: "ended", endedAt: new Date(), endReason: "lost" },
  });
}

/**
 * fal bills each Live Mirror session for at least 10 seconds, so a shorter session is topped up
 * to that minimum (at most the user's balance) when it closes.
 */
async function chargeMirrorMinimum(renderSessionId: string) {
  await db.$transaction(async (tx) => {
    const session = await tx.renderSession.findUnique({ where: { id: renderSessionId } });
    if (!session || session.model !== MIRROR_MODEL_ID || !session.startedAt || session.status === "ended") return;
    const missing = MIRROR_MIN_BILLED_SECONDS - session.billedSeconds;
    if (missing <= 0) return;
    const resolution = isResolution(session.resolution) ? session.resolution : "1440p";
    const user = await tx.user.findUniqueOrThrow({ where: { id: session.userId } });
    const priceMc = Math.min(user.balanceMc, Math.ceil(missing * sessionPricePerSecondMc(session.model, resolution)));
    await tx.user.update({ where: { id: user.id }, data: { balanceMc: { decrement: priceMc } } });
    await tx.renderSession.update({
      where: { id: session.id },
      data: {
        billedSeconds: { increment: missing },
        chargedMc: { increment: priceMc },
        falCostMc: { increment: Math.ceil(missing * sessionFalCostPerSecondMc(session.model, resolution)) },
      },
    });
  });
}
