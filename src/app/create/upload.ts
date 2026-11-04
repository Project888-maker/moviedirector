// Uploads a file from the browser to fal storage and returns its public URL.
// Large files go straight to fal with a one-time link; if that fails, small files fall back to our server.

const SERVER_UPLOAD_LIMIT = 4 * 1024 * 1024;

export type UploadProgress = { loaded: number; total: number };

// Files picked on this device, so previews show instantly instead of re-downloading them from fal.
const localPreviews = new Map<string, string>();

/** The best URL to preview an input: the local copy if it was uploaded from here, else via our domain. */
export function previewUrl(url: string, site: (u: string) => string): string {
  return localPreviews.get(url) ?? site(url);
}

/** PUT with upload progress (fetch can't report it). Resolves true when the server accepted the file. */
function putWithProgress(url: string, file: File, contentType: string, onProgress?: (p: UploadProgress) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => onProgress?.({ loaded: e.loaded, total: e.lengthComputable ? e.total : file.size });
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    xhr.send(file);
  });
}

async function serverUpload(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(data?.error ?? "The upload failed. Try again.");
  return data.url;
}

export async function uploadFile(file: File, onProgress?: (p: UploadProgress) => void): Promise<string> {
  const url = await upload(file, onProgress);
  try {
    localPreviews.set(url, URL.createObjectURL(file));
  } catch {
    // Previews fall back to the uploaded copy.
  }
  return url;
}

async function upload(file: File, onProgress?: (p: UploadProgress) => void): Promise<string> {
  onProgress?.({ loaded: 0, total: file.size });
  const contentType = file.type || "application/octet-stream";
  const res = await fetch("/api/upload/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType, fileName: file.name || "upload", size: file.size }),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 400) throw new Error(data?.error ?? "This file can't be uploaded.");
  if (res.ok && data?.uploadUrl) {
    if (await putWithProgress(data.uploadUrl, file, contentType, onProgress)) return data.fileUrl;
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
