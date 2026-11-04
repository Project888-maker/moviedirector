/**
 * fal's CDN hosts and the path on our own domain that proxies each one (see next.config.ts).
 * Some networks, notably in Russia, throttle or block fal's CDN while our Vercel domain loads fine,
 * so results are always shown and downloaded through the site. The original fal URL is still what
 * we store and what we pass back to fal as input for the next tool.
 */
export const FAL_MEDIA_HOSTS: Record<string, string> = {
  "fal.media": "f",
  "v2.fal.media": "v2",
  "v3.fal.media": "v3",
  "v3b.fal.media": "v3b",
};

/** The same file, served from our domain when it lives on fal's CDN. */
export function siteUrl(url: string): string {
  try {
    const u = new URL(url);
    const key = FAL_MEDIA_HOSTS[u.host];
    return key ? `/fm/${key}${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
}

/** A friendly file name for downloads, keeping the original extension. */
export function downloadName(url: string, base = "ai-movie-director"): string {
  const ext = /\.([a-z0-9]{2,4})(?:$|\?)/i.exec(url)?.[1] ?? "mp4";
  return `${base}.${ext}`;
}
