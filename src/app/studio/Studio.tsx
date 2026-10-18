"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";

const RESOLUTIONS = ["480p", "544p", "640p", "704p", "768p", "1080p", "1440p"] as const;
const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
const MAX_REFERENCES = 9;
const MC_PER_USD = 100_000;

type Resolution = (typeof RESOLUTIONS)[number];
type Reference = { key: string; name: string; url: string | null; preview: string };
type Status = "idle" | "connecting" | "live" | "ended";
type Session = { send(message: object): void; close(): void };

const usd = (mc: number) => `$${(mc / MC_PER_USD).toFixed(2)}`;

export default function Studio({
  modelId,
  initialBalanceMc,
  prices,
}: {
  modelId: string;
  initialBalanceMc: number;
  prices: Record<string, { perSecondMc: number; minStartMc: number }>;
}) {
  const [prompt, setPrompt] = useState("");
  const [direction, setDirection] = useState("");
  const [references, setReferences] = useState<Reference[]>([]);
  const [resolution, setResolution] = useState<Resolution>("480p");
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number]>("16:9");
  const [status, setStatus] = useState<Status>("idle");
  const [balanceMc, setBalanceMc] = useState(initialBalanceMc);
  const [spentMc, setSpentMc] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [recording, setRecording] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const promptVersionRef = useRef(1);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const price = prices[resolution];
  const uploading = references.some((r) => !r.url);

  const addLog = (line: string) =>
    setLog((lines) => [...lines.slice(-50), `${new Date().toLocaleTimeString()}  ${line}`]);

  async function addReferences(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files).slice(0, MAX_REFERENCES - references.length)) {
      const key = crypto.randomUUID();
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 64);
      setReferences((refs) => [...refs, { key, name, url: null, preview: URL.createObjectURL(file) }]);
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        setError(data?.error ?? "Upload failed.");
        setReferences((refs) => refs.filter((r) => r.key !== key));
        continue;
      }
      setReferences((refs) => refs.map((r) => (r.key === key ? { ...r, url: data.url } : r)));
    }
  }

  function startRecording(stream: MediaStream) {
    if (typeof MediaRecorder === "undefined" || recorderRef.current) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      setRecording(URL.createObjectURL(blob));
    };
    recorder.start(1000);
    recorderRef.current = recorder;
  }

  function finish(message?: string) {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      try {
        session.send({ type: "stop" });
      } catch {}
      session.close();
    }
    if (sessionIdRef.current) {
      navigator.sendBeacon(`/api/sessions/${sessionIdRef.current}/end`);
    }
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
    recorderRef.current = null;
    setStatus((s) => (s === "idle" ? s : "ended"));
    if (message) addLog(message);
  }

  async function start() {
    setError(null);
    setRecording(null);
    setSeconds(0);
    setSpentMc(0);
    setLog([]);

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Could not start a session.");
      return;
    }
    sessionIdRef.current = data.id;
    promptVersionRef.current = 1;
    setStatus("connecting");
    addLog("Waiting for a GPU…");

    // Every request the realtime client makes goes through our proxy, tagged with the
    // billing session id. The proxy adds the fal key and meters the heartbeats.
    const fal = createFalClient({ proxyUrl: `/api/fal/proxy?sid=${data.id}` });
    const session = fal.realtime.open(wma(modelId), {
      receive: ["video", "audio"],
      onMedia: (stream) => {
        if (videoRef.current) videoRef.current.srcObject = stream;
        startRecording(stream);
      },
      onData: (raw) => handleMessage(raw),
      onState: (state) => {
        if (state === "live") setStatus("live");
        if (state === "closed" || state === "failed") finish(`Session ${state}.`);
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : String(err));
        finish();
      },
    });
    sessionRef.current = session;

    session.send({
      type: "configure",
      protocol_version: 1,
      prompt_version: promptVersionRef.current,
      prompt,
      resolution,
      aspect_ratio: aspectRatio,
      reference_images: references
        .filter((r) => r.url)
        .map((r) => ({ url: r.url, name: r.name || null })),
    });
  }

  function handleMessage(raw: string) {
    let message: { type?: string; [key: string]: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    switch (message.type) {
      case "configured":
        setStatus("live");
        addLog(`Configured at ${message.resolution ?? resolution}.`);
        break;
      case "chunk":
        setSeconds((s) => s + Number(message.playback_seconds ?? 0));
        break;
      case "prompt_applied":
        addLog(`Direction #${message.prompt_version} applied.`);
        break;
      case "prompt_rejected":
        addLog(`Direction #${message.prompt_version} rejected: ${message.reason}`);
        break;
      case "error":
        setError(String(message.error ?? message.code));
        break;
      case "stream_exhausted":
        finish(message.reason === "session_limit" ? "Reached the session length limit." : "Stream ended.");
        break;
    }
  }

  function sendDirection() {
    const text = direction.trim();
    if (!text || !sessionRef.current) return;
    promptVersionRef.current += 1;
    sessionRef.current.send({ type: "prompt", prompt_version: promptVersionRef.current, prompt: text });
    addLog(`Sent direction #${promptVersionRef.current}.`);
    setDirection("");
  }

  // While live, poll the server for what's been charged; the server ends the session when credit runs out.
  useEffect(() => {
    if (status !== "live" && status !== "connecting") return;
    const timer = setInterval(async () => {
      const id = sessionIdRef.current;
      if (!id) return;
      const res = await fetch(`/api/sessions/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setBalanceMc(data.balanceMc);
      setSpentMc(data.chargedMc);
      if (data.status === "ended" && data.endReason === "insufficient_balance") {
        setError("You ran out of credit. Top up to keep directing.");
        finish();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    const onLeave = () => finish();
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, []);

  const busy = status === "connecting" || status === "live";

  return (
    <div className="grid studio">
      <section className="grid" style={{ alignContent: "start" }}>
        <video ref={videoRef} className="video" autoPlay playsInline controls={false} />
        <div className="panel">
          <div className="stats">
            <div><span className="muted">Status</span><b>{status}</b></div>
            <div><span className="muted">Footage</span><b>{seconds.toFixed(0)}s</b></div>
            <div><span className="muted">This session</span><b>{usd(spentMc)}</b></div>
            <div><span className="muted">Balance</span><b>{usd(balanceMc)}</b></div>
          </div>
          {busy && (
            <>
              <label htmlFor="direction">Direct the next shot</label>
              <div className="row">
                <input
                  id="direction"
                  value={direction}
                  placeholder="Milo trips on the gangway; Nora catches the bag."
                  onChange={(e) => setDirection(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendDirection()}
                  style={{ flex: 4 }}
                />
                <button onClick={sendDirection} disabled={status !== "live"}>Send</button>
              </div>
            </>
          )}
          {recording && (
            <p><a className="button secondary" href={recording} download="my-movie.webm">Download recording</a></p>
          )}
          {log.length > 0 && <div className="log">{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
        </div>
      </section>

      <aside className="panel">
        <h2>Scene setup</h2>
        <label htmlFor="prompt">Story &amp; style</label>
        <textarea
          id="prompt"
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Photorealistic live-action cinema. Nora: adult woman, long dark braid, burgundy bomber jacket… Nora and Milo jog along a harbor toward a departing ferry."
        />

        <label>Characters &amp; references ({references.length}/{MAX_REFERENCES})</label>
        <div className="refs">
          {references.map((ref) => (
            <div className="ref" key={ref.key}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ref.preview} alt={ref.name} style={{ opacity: ref.url ? 1 : 0.4 }} />
              <input
                value={ref.name}
                disabled={busy}
                maxLength={64}
                onChange={(e) =>
                  setReferences((refs) => refs.map((r) => (r.key === ref.key ? { ...r, name: e.target.value } : r)))
                }
              />
              {!busy && (
                <button onClick={() => setReferences((refs) => refs.filter((r) => r.key !== ref.key))}>×</button>
              )}
            </div>
          ))}
        </div>
        {references.length < MAX_REFERENCES && !busy && (
          <input type="file" accept="image/*" multiple onChange={(e) => addReferences(e.target.files)} />
        )}

        <div className="row">
          <div>
            <label htmlFor="resolution">Resolution</label>
            <select id="resolution" value={resolution} disabled={busy}
              onChange={(e) => setResolution(e.target.value as Resolution)}>
              {RESOLUTIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="aspect">Aspect ratio</label>
            <select id="aspect" value={aspectRatio} disabled={busy}
              onChange={(e) => setAspectRatio(e.target.value as (typeof ASPECT_RATIOS)[number])}>
              {ASPECT_RATIOS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <p className="muted">
          {usd(price.perSecondMc * 60)} per minute at {resolution}. Minimum balance to start: {usd(price.minStartMc)}.
        </p>
        {error && <p className="error">{error}</p>}
        {balanceMc < price.minStartMc && !busy && (
          <p><Link href="/billing">Top up your credit →</Link></p>
        )}

        {busy ? (
          <button className="secondary" style={{ width: "100%" }} onClick={() => finish("Stopped.")}>Stop</button>
        ) : (
          <button style={{ width: "100%" }} onClick={start}
            disabled={!prompt.trim() || uploading || balanceMc < price.minStartMc}>
            {status === "ended" ? "Start a new take" : "Action!"}
          </button>
        )}
      </aside>
    </div>
  );
}
