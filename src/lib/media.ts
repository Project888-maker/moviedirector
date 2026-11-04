/**
 * fal's CDN hosts and the key our media route uses for each one.
 * Some networks, notably in Russia, throttle or block fal's CDN while our Vercel domain loads fine,
 * so results are always shown and downloaded through the site. The original fal URL is still what
 * we store and what we pass back to fal as input for the next tool.
 * Served by src/app/api/media/[...path]/route.ts.
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
    return key ? `/api/media/${key}${u.pathname}` : url;
  } catch {
    return url;
  }
}

/** A friendly file name for downloads, keeping the original extension. */
export function downloadName(url: string, base = "ai-movie-director"): string {
  const ext = /\.([a-z0-9]{2,4})(?:$|\?)/i.exec(url)?.[1] ?? "mp4";
  return `${base}.${ext}`;
}

/**
 * Downloads a file through our domain in ranges (each function response is capped), then saves it.
 * Falls back to opening the file if anything goes wrong. Browser only.
 */
export async function downloadMedia(url: string, onProgress?: (fraction: number) => void): Promise<void> {
  const src = siteUrl(url);
  const name = downloadName(url);
  try {
    const parts: BlobPart[] = [];
    let start = 0;
    let total = Infinity;
    let type = "";
    while (start < total) {
      const res = await fetch(src, { headers: { Range: `bytes=${start}-` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      type ||= res.headers.get("content-type") ?? "";
      const buf = await res.arrayBuffer();
      parts.push(buf);
      if (res.status === 200) break; // whole file in one go
      const m = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
      total = m ? Number(m[1]) : start + buf.byteLength;
      if (!buf.byteLength) break;
      start += buf.byteLength;
      onProgress?.(Math.min(1, start / total));
    }
    const href = URL.createObjectURL(new Blob(parts, { type: type || "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch {
    window.open(src, "_blank", "noopener");
  }
}
