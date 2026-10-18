import { db } from "./db";
import {
  HEARTBEAT_SECONDS,
  falCostPerSecondMc,
  isResolution,
  pricePerSecondMc,
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
    const priceMc = Math.min(user.balanceMc, Math.ceil(seconds * pricePerSecondMc(resolution)));
    const falCostMc = Math.ceil(seconds * falCostPerSecondMc(resolution));

    const updated = await tx.user.update({
      where: { id: user.id },
      data: { balanceMc: { decrement: priceMc } },
    });

    const nextTickMc = pricePerSecondMc(resolution) * HEARTBEAT_SECONDS;
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
  await db.renderSession.updateMany({
    where: { id: renderSessionId, status: { in: ["pending", "active"] } },
    data: { status: "ended", endedAt: new Date(), endReason: reason },
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
