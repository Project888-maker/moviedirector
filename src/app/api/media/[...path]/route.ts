import { FAL_MEDIA_HOSTS } from "@/lib/media";
import { proxyMedia } from "@/lib/mediaProxy";

export const maxDuration = 60;

const HOST_BY_KEY = Object.fromEntries(Object.entries(FAL_MEDIA_HOSTS).map(([host, key]) => [key, host]));

// Serves fal results from our own domain: /api/media/<host key>/<path on fal's CDN>
async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [key, ...rest] = (await params).path;
  const host = HOST_BY_KEY[key];
  if (!host || !rest.length) return new Response("Not found", { status: 404 });
  const upstream = `https://${host}/${rest.map(encodeURIComponent).join("/")}`;
  return proxyMedia(upstream, req);
}

export const GET = handle;
export const HEAD = handle;
