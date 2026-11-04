import { NextResponse } from "next/server";

// TEMPORARY diagnostics: reads an MP4's headers from fal's CDN and reports codec, profile and layout.
// Only fal.media URLs are accepted and only metadata is returned. Remove once the playback issue is fixed.

type Box = { type: string; start: number; size: number; header: number };

function boxes(buf: Buffer, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    let header = 8;
    if (size === 1 && p + 16 <= end) { size = Number(buf.readBigUInt64BE(p + 8)); header = 16; }
    if (size === 0) size = end - p;
    if (size < header) break;
    out.push({ type, start: p, size, header });
    p += size;
  }
  return out;
}

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta"]);

function describeMoov(buf: Buffer, moov: Box) {
  const tracks: Record<string, unknown>[] = [];
  const walk = (b: Box, track: Record<string, unknown>) => {
    for (const c of boxes(buf, b.start + b.header, b.start + Math.min(b.size, buf.length - b.start))) {
      if (c.type === "trak") { const t: Record<string, unknown> = {}; tracks.push(t); walk(c, t); continue; }
      if (CONTAINERS.has(c.type)) { walk(c, track); continue; }
      const d = c.start + c.header;
      if (c.type === "mdhd") {
        const v = buf[d];
        const ts = v === 1 ? buf.readUInt32BE(d + 20) : buf.readUInt32BE(d + 12);
        const dur = v === 1 ? Number(buf.readBigUInt64BE(d + 24)) : buf.readUInt32BE(d + 16);
        track.timescale = ts; track.seconds = +(dur / ts).toFixed(2);
      }
      if (c.type === "hdlr") track.handler = buf.toString("latin1", d + 8, d + 12);
      if (c.type === "stsd") {
        const entry = boxes(buf, d + 8, c.start + c.size)[0];
        if (!entry) continue;
        track.codec = entry.type;
        const e = entry.start + entry.header;
        if (["avc1", "avc3", "hvc1", "hev1", "av01", "vp09", "mp4v"].includes(entry.type)) {
          track.width = buf.readUInt16BE(e + 24); track.height = buf.readUInt16BE(e + 26);
          for (const sub of boxes(buf, e + 78, entry.start + entry.size)) {
            const s = sub.start + sub.header;
            if (sub.type === "avcC") { track.avcProfile = buf[s + 1]; track.avcLevel = buf[s + 3]; }
            if (sub.type === "hvcC") { track.hevcProfile = buf[s + 1] & 0x1f; track.hevcLevel = buf[s + 12]; track.chromaFormat = buf[s + 16] & 3; track.bitDepth = (buf[s + 17] & 7) + 8; }
            if (sub.type === "colr") track.colr = buf.toString("latin1", s, s + 4) === "nclx" ? { primaries: buf.readUInt16BE(s + 4), transfer: buf.readUInt16BE(s + 6), matrix: buf.readUInt16BE(s + 8) } : "icc";
            if (!track.extra) track.extra = [];
            (track.extra as string[]).push(sub.type);
          }
        }
        if (entry.type === "mp4a") { track.channels = buf.readUInt16BE(e + 16); track.sampleRate = buf.readUInt16BE(e + 24); }
      }
      if (c.type === "stts") {
        const n = buf.readUInt32BE(d + 4);
        track.sttsEntries = n;
        if (n > 0) track.firstDelta = buf.readUInt32BE(d + 12);
      }
      if (c.type === "stss") track.keyframes = buf.readUInt32BE(d + 4);
      if (c.type === "stsz") track.samples = buf.readUInt32BE(d + 8);
    }
  };
  walk(moov, {});
  return tracks;
}

async function range(url: string, from: number, to: number) {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, cache: "no-store" });
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
}

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  let host = "";
  try { host = new URL(url).host; } catch {}
  if (!/(^|\.)fal\.media$/.test(host)) return NextResponse.json({ error: "fal.media URLs only" }, { status: 400 });

  const head = await range(url, 0, 1024 * 1024 - 1);
  const total = Number(head.res.headers.get("content-range")?.split("/")[1] ?? head.res.headers.get("content-length") ?? 0);
  const info: Record<string, unknown> = {
    rangeStatus: head.res.status,
    contentType: head.res.headers.get("content-type"),
    acceptRanges: head.res.headers.get("accept-ranges"),
    cacheControl: head.res.headers.get("cache-control"),
    totalBytes: total,
  };
  const top = boxes(head.buf, 0, head.buf.length).map((b) => ({ type: b.type, at: b.start, size: b.size }));
  info.topBoxes = top;
  let moovBuf = head.buf;
  let moov = boxes(head.buf, 0, head.buf.length).find((b) => b.type === "moov" && b.start + b.size <= head.buf.length);
  if (!moov && total) {
    const tailStart = Math.max(0, total - 4 * 1024 * 1024);
    const tail = await range(url, tailStart, total - 1);
    // Find the moov box in the tail by scanning for its type tag.
    const idx = tail.buf.indexOf(Buffer.from("moov"));
    if (idx >= 4) {
      moovBuf = tail.buf.subarray(idx - 4);
      moov = boxes(moovBuf, 0, moovBuf.length).find((b) => b.type === "moov");
      info.moovAt = tailStart + idx - 4;
    }
  } else if (moov) info.moovAt = moov.start;
  info.faststart = typeof info.moovAt === "number" && (info.moovAt as number) < 1024 * 1024;
  info.tracks = moov ? describeMoov(moovBuf, moov) : "moov not found";
  return NextResponse.json(info, { headers: { "cache-control": "no-store" } });
}
