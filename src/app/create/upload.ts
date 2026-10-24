// Uploads a file from the browser to fal storage and returns its public URL.
// Large files go straight to fal with a one-time link; if that fails, small files fall back to our server.

const SERVER_UPLOAD_LIMIT = 4 * 1024 * 1024;

async function serverUpload(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(data?.error ?? "The upload failed. Try again.");
  return data.url;
}

export async function uploadFile(file: File): Promise<string> {
  const contentType = file.type || "application/octet-stream";
  const res = await fetch("/api/upload/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType, fileName: file.name || "upload", size: file.size }),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 400) throw new Error(data?.error ?? "This file can't be uploaded.");
  if (res.ok && data?.uploadUrl) {
    const put = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file }).catch(() => null);
    if (put?.ok) return data.fileUrl;
  }
  if (file.size <= SERVER_UPLOAD_LIMIT) return serverUpload(file);
  throw new Error("The upload failed. Check your connection and try again.");
}

/** Reads the length of a video or audio file (local or remote) in the browser, in seconds. */
export function readDuration(src: string, kind: "video" | "audio"): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    let settled = false;
    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      el.removeAttribute("src");
      el.load();
      resolve(value);
    };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 15000);
    el.src = src;
  });
}
