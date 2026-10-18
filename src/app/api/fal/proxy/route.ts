import { NextResponse, type NextRequest } from "next/server";
import { handleRequest, resolveProxyConfig } from "@fal-ai/server-proxy";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { chargeSession } from "@/lib/billing";
import { jsonError } from "@/lib/http";
import { MODEL_ID, formatUsd, isResolution, minStartBalanceMc } from "@/lib/pricing";

export const runtime = "nodejs";

// The realtime model negotiates through fal's WMA bridge:
//   POST wma.fal.run/ice               -> TURN credentials (free)
//   POST wma.fal.run/session           -> SDP exchange, starts the GPU session
//   POST wma.fal.run/session/heartbeat -> every 5s; the lease dies when these stop
// Video then flows peer-to-peer, but every heartbeat passes through here. That makes the
// heartbeat our billing tick and our kill switch: when the user runs out of credit we stop
// forwarding heartbeats and answer `{ alive: false }`, which closes the browser session.
const WMA_HOST = "wma.fal.run";

const proxyConfig = resolveProxyConfig({
  // Only the realtime bridge for this one model is reachable through the proxy.
  allowedUrlPatterns: [],
  serviceHosts: [WMA_HOST],
  allowedEndpoints: [MODEL_ID],
  allowUnauthorizedRequests: false,
  // The user is authenticated by our own session cookie before we get here.
  isAuthenticated: async () => true,
  // Always use our key; never forward an Authorization header sent by the browser.
  resolveFalAuth: async () => `Key ${process.env.FAL_KEY}`,
});

async function forward(req: NextRequest, body: string): Promise<Response> {
  const responseHeaders = new Headers();
  const upstream: Response = await handleRequest(
    {
      id: "moviedirector",
      method: req.method,
      getRequestBody: async () => body,
      getHeaders: () => Object.fromEntries(req.headers.entries()),
      getHeader: (name) => req.headers.get(name),
      sendHeader: (name, value) => responseHeaders.set(name, value),
      respondWith: (status, data) => NextResponse.json(data, { status }),
      sendResponse: async (res) => res,
    },
    proxyConfig,
  );
  const responseBody = await upstream.arrayBuffer();
  // fetch() already decoded the body, so don't pass the upstream encoding/length through.
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.set("content-type", upstream.headers.get("content-type") ?? "application/json");
  return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
}

async function handler(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Not signed in.");

  let target: URL;
  try {
    target = new URL(req.headers.get("x-fal-target-url") ?? "");
  } catch {
    return jsonError(400, "Invalid request.");
  }
  if (target.host !== WMA_HOST) return jsonError(400, "Invalid request.");
  const path = target.pathname.replace(/\/+$/, "");

  const renderSessionId = req.nextUrl.searchParams.get("sid");
  const render = renderSessionId
    ? await db.renderSession.findFirst({ where: { id: renderSessionId, userId: user.id } })
    : null;
  if (!render || !isResolution(render.resolution)) return jsonError(400, "Unknown session.");

  const body = await req.text();

  if (path === "/session") {
    if (render.status !== "pending") return jsonError(409, "Session already started.");
    const required = minStartBalanceMc(render.resolution);
    if (user.balanceMc < required) {
      return jsonError(402, `You need at least ${formatUsd(required)} of credit to start.`);
    }
  } else if (path === "/session/heartbeat") {
    let falSessionId: unknown;
    try {
      falSessionId = JSON.parse(body).session_id;
    } catch {
      return jsonError(400, "Invalid request.");
    }
    if (render.status !== "active" || render.falSessionId !== falSessionId) {
      return NextResponse.json({ alive: false });
    }
    const charge = await chargeSession(render.id);
    if (!charge.ok) return NextResponse.json({ alive: false, reason: charge.reason });
  } else if (path !== "/ice") {
    return jsonError(400, "Invalid request.");
  }

  let response: Response;
  try {
    response = await forward(req, body);
  } catch (error) {
    console.error("fal proxy request failed", error);
    response = jsonError(502, "Could not reach fal.");
  }

  if (path === "/session") {
    const answer = response.ok ? await response.clone().json().catch(() => null) : null;
    if (answer?.session_id) {
      const now = new Date();
      await db.renderSession.update({
        where: { id: render.id },
        data: { status: "active", falSessionId: answer.session_id, startedAt: now, lastChargedAt: now },
      });
    } else {
      await db.renderSession.update({
        where: { id: render.id },
        data: { status: "ended", endedAt: new Date(), endReason: "failed_to_start" },
      });
    }
  }
  return response;
}

export { handler as GET, handler as POST, handler as PUT };
