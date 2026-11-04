/**
 * Streams a file from fal's CDN through our own domain with correct byte-range handling.
 *
 * Why not a plain rewrite: Vercel caches external rewrites by default and fal marks files
 * immutable, so a cached partial (206) response could be served for a different range and
 * browsers rejected the video (MEDIA_ERR_SRC_NOT_SUPPORTED). Here every range is fetched
 * explicitly, responses are never cached on the CDN, and each range is capped so a single
 * function response stays small; players simply ask for the next range.
 */
export const MAX_RANGE_BYTES = 4 * 1024 * 1024 - 64 * 1024; // stays under Vercel's 4.5 MB response cap

const PASS_HEADERS = ["content-type", "content-length", "content-range", "etag", "last-modified"];

/** Turns a browser Range header into one we forward, capping open or very large ranges. */
export function clampRange(range: string | null): string | null {
  if (!range) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return null; // multi-range or malformed: fetch from the start instead
  const [, a, b] = m;
  if (a === "") return b ? `bytes=-${Math.min(Number(b), MAX_RANGE_BYTES)}` : null; // suffix range
  const start = Number(a);
  const end = b === "" ? start + MAX_RANGE_BYTES - 1 : Math.min(Number(b), start + MAX_RANGE_BYTES - 1);
  return `bytes=${start}-${end}`;
}

export async function proxyMedia(upstream: string, req: Request): Promise<Response> {
  // Without a Range header (images) we fetch the first range; for files that fit, that is the whole
  // file and we answer 200. Large files are only ever read by players and downloadMedia(), which send ranges.
  const asked = req.headers.get("range");
  const range = clampRange(asked) ?? `bytes=0-${MAX_RANGE_BYTES - 1}`;

  let res: Response;
  try {
    res = await fetch(upstream, { method: req.method === "HEAD" ? "HEAD" : "GET", headers: range ? { Range: range } : {}, cache: "no-store" });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }

  // If the browser didn't ask for a range but the file fits in the first one, answer 200 like a normal file.
  let status = res.status;
  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!asked && status === 206) {
    const total = Number(res.headers.get("content-range")?.split("/")[1]);
    const length = Number(res.headers.get("content-length"));
    if (Number.isFinite(total) && total === length) {
      status = 200;
      headers.delete("content-range");
    }
  }
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=86400");
  headers.set("cdn-cache-control", "no-store");
  headers.set("vercel-cdn-cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(req.method === "HEAD" ? null : res.body, { status, headers });
}
