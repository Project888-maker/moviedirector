"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";
import { EXAMPLES, type Example } from "./examples";

const RESOLUTIONS = ["480p", "544p", "640p", "704p", "768p", "1080p", "1440p"] as const;
const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
const FIDELITIES = ["high", "medium", "low"] as const;
const MAX_REFERENCES = 9;
const MC_PER_USD = 100_000;
const MAX_AUDIO = 3;
const MAX_BEATS = 64;
const ACCEPTED = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif";
const SPEECH_LANGUAGES = [
  ["en-US", "English"],
  ["ru-RU", "Русский"],
  ["az-AZ", "Azərbaycanca"],
  ["tr-TR", "Türkçe"],
  ["es-ES", "Español"],
  ["de-DE", "Deutsch"],
  ["fr-FR", "Français"],
] as const;

type Resolution = (typeof RESOLUTIONS)[number];
type AspectRatio = (typeof ASPECT_RATIOS)[number];
type Fidelity = (typeof FIDELITIES)[number];
type Reference = {
  key: string;
  name: string;
  url: string;
  preview: string;
  uploading: boolean;
  error: string | null;
  fidelity: Fidelity;
  showAdvanced: boolean;
};
type AudioReference = { key: string; name: string; url: string; uploading: boolean; error: string | null };
type Beat = { key: string; offset: string; prompt: string };
type Direction = { version: number; atMs: number; text: string; state: "sent" | "applied" | "rejected"; via: "typed" | "voice" };
type Status = "idle" | "connecting" | "live" | "ended";

// The Web Speech API isn't in TypeScript's DOM types yet.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};
function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
type Session = { send(message: object): void; close(): void };

const usd = (mc: number, digits = 2) => `$${(mc / MC_PER_USD).toFixed(digits)}`;
const newReference = (): Reference => ({
  key: crypto.randomUUID(),
  name: "",
  url: "",
  preview: "",
  uploading: false,
  error: null,
  fidelity: "high",
  showAdvanced: false,
});

function formatClock(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatElapsed(ms: number) {
  const total = ms / 1000;
  const minutes = Math.floor(total / 60);
  return `${minutes}m ${(total - minutes * 60).toFixed(1)}s`;
}

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
  const [audioRefs, setAudioRefs] = useState<AudioReference[]>([]);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [listening, setListening] = useState(false);
  const [speechLang, setSpeechLang] = useState("en-US");
  const [speechSupported, setSpeechSupported] = useState(true);
  const [resolution, setResolution] = useState<Resolution>("768p");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [seed, setSeed] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [balanceMc, setBalanceMc] = useState(initialBalanceMc);
  const [spentMc, setSpentMc] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);

  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const promptVersionRef = useRef(1);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const wantListeningRef = useRef(false);
  const directionsRef = useRef<HTMLDivElement>(null);

  const price = prices[resolution];
  const busy = status === "connecting" || status === "live";
  const uploading = references.some((r) => r.uploading) || audioRefs.some((a) => a.uploading);
  const canConnect =
    !busy && prompt.trim().length > 0 && !uploading && balanceMc >= price.minStartMc;

  // ---- references -------------------------------------------------------------------------

  const updateReference = (key: string, patch: Partial<Reference>) =>
    setReferences((refs) => refs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function uploadInto(key: string, file: File) {
    if (!file.type.startsWith("image/")) {
      updateReference(key, { error: "That file isn't an image." });
      return;
    }
    updateReference(key, { uploading: true, error: null, preview: URL.createObjectURL(file) });
    setReferences((refs) =>
      refs.map((r) => (r.key === key && !r.name ? { ...r, name: file.name.replace(/\.[^.]+$/, "").slice(0, 64) } : r)),
    );
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok || !data?.url) {
      updateReference(key, { uploading: false, error: data?.error ?? "The upload failed. Try again, or paste a URL instead." });
      return;
    }
    updateReference(key, { uploading: false, url: data.url, preview: data.url });
  }

  function setReferenceUrl(key: string, value: string) {
    const url = value.trim();
    const valid = /^https?:\/\/\S+$/i.test(url);
    updateReference(key, {
      url,
      preview: valid ? url : "",
      error: url && !valid ? "Enter a link that starts with http:// or https://" : null,
    });
  }

  function handleDrop(key: string, event: React.DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) return uploadInto(key, file);
    const url = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (url) setReferenceUrl(key, url);
  }

  function handlePaste(key: string, event: React.ClipboardEvent) {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      uploadInto(key, file);
    }
  }

  // ---- examples & reset -------------------------------------------------------------------

  function loadExample(example: Example) {
    setPrompt(example.prompt);
    setReferences(
      (example.references ?? []).map((r) => ({ ...newReference(), name: r.name, url: r.url, preview: r.url })),
    );
    setAudioRefs([]);
    setBeats([]);
    setError(null);
  }

  function reset() {
    setPrompt("");
    setReferences([]);
    setAudioRefs([]);
    setBeats([]);
    setResolution("768p");
    setAspectRatio("16:9");
    setSeed("");
    setError(null);
  }

  // ---- reference audio --------------------------------------------------------------------

  const updateAudio = (key: string, patch: Partial<AudioReference>) =>
    setAudioRefs((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  async function uploadAudio(key: string, file: File) {
    if (!file.type.startsWith("audio/")) {
      updateAudio(key, { error: "That file isn't an audio file." });
      return;
    }
    updateAudio(key, { uploading: true, error: null });
    setAudioRefs((list) =>
      list.map((a) => (a.key === key && !a.name ? { ...a, name: file.name.replace(/\.[^.]+$/, "").slice(0, 64) } : a)),
    );
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok || !data?.url) {
      updateAudio(key, { uploading: false, error: data?.error ?? "The upload failed. Try again, or paste a URL instead." });
      return;
    }
    updateAudio(key, { uploading: false, url: data.url });
  }

  // ---- realtime session -------------------------------------------------------------------

  function markStarted() {
    if (startedAtRef.current) return;
    startedAtRef.current = Date.now();
    setStartedAt(startedAtRef.current);
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

  const finish = useCallback((message?: string) => {
    wantListeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      try {
        session.send({ type: "stop" });
      } catch {}
      session.close();
    }
    if (sessionIdRef.current) navigator.sendBeacon(`/api/sessions/${sessionIdRef.current}/end`);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    setStatus((s) => (s === "idle" ? s : "ended"));
    if (message) setNotice(message);
  }, []);

  async function connect() {
    if (!canConnect) return;
    setError(null);
    setNotice(null);
    setRecording(null);
    setSpentMc(0);
    setElapsedMs(0);
    setStartedAt(null);
    startedAtRef.current = null;
    setDirections([]);

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
        if (state === "live") {
          setStatus("live");
          markStarted();
        }
        if (state === "closed" || state === "failed") finish();
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : String(err));
        finish();
      },
    });
    sessionRef.current = session;

    const parsedSeed = Number.parseInt(seed, 10);
    const script = beats
      .filter((b) => b.prompt.trim())
      .map((b) => ({ offset: Math.max(0, Number(b.offset) || 0), prompt: b.prompt.trim() }))
      .sort((a, b) => a.offset - b.offset);
    session.send({
      type: "configure",
      protocol_version: 1,
      prompt_version: promptVersionRef.current,
      prompt,
      resolution,
      aspect_ratio: aspectRatio,
      ...(Number.isFinite(parsedSeed) ? { seed: parsedSeed } : {}),
      reference_images: references
        .filter((r) => r.url && !r.error)
        .map((r) => ({ url: r.url, name: r.name || null, fidelity: r.fidelity })),
      reference_audio: audioRefs
        .filter((a) => a.url && !a.error)
        .map((a) => ({ url: a.url, name: a.name || null })),
      ...(script.length > 0 ? { script } : {}),
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
        markStarted();
        break;
      case "prompt_applied":
        setDirections((list) =>
          list.map((d) => (d.version === Number(message.prompt_version) ? { ...d, state: "applied" } : d)),
        );
        break;
      case "prompt_rejected":
        setDirections((list) =>
          list.map((d) => (d.version === Number(message.prompt_version) ? { ...d, state: "rejected" } : d)),
        );
        setNotice(
          message.reason === "content_policy"
            ? "That direction was blocked by the content filter."
            : `That direction couldn't be used (${message.reason}).`,
        );
        break;
      case "error":
        setError(String(message.error ?? message.code));
        break;
      case "stream_exhausted":
        finish(message.reason === "session_limit" ? "You reached the maximum session length." : undefined);
        break;
    }
  }

  function sendDirection(raw: string, via: Direction["via"]) {
    const text = raw.trim();
    if (!text || !sessionRef.current) return;
    promptVersionRef.current += 1;
    const version = promptVersionRef.current;
    sessionRef.current.send({ type: "prompt", prompt_version: version, prompt: text });
    const atMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
    setDirections((list) => [...list, { version, atMs, text, state: "sent", via }]);
    setDirection("");
  }

  // ---- voice directions -------------------------------------------------------------------

  function stopListening() {
    wantListeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  function startListening() {
    const SpeechRecognition = speechRecognition();
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = speechLang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) sendDirection(result[0].transcript, "voice");
        else interim += result[0].transcript;
      }
      setDirection(interim);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setNotice("Microphone access was blocked. Allow it in your browser's address bar to speak directions.");
        stopListening();
      }
    };
    // Browsers stop listening after a pause; keep going until the user turns the mic off.
    recognition.onend = () => {
      if (wantListeningRef.current && sessionRef.current) recognition.start();
      else setListening(false);
    };
    wantListeningRef.current = true;
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  // Ctrl/Cmd + Enter connects, like on fal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        document.getElementById("connect")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Bring the directions box into view once the movie starts.
  useEffect(() => {
    if (status === "live") directionsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [status]);

  // Session timer.
  useEffect(() => {
    if (status !== "live" || !startedAt) return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => clearInterval(timer);
  }, [status, startedAt]);

  // While live, poll the server for what's been charged; the server ends the session when credit runs out.
  useEffect(() => {
    if (!busy) return;
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
  }, [busy, finish]);

  // Refresh the final charge once a session ends.
  useEffect(() => {
    if (status !== "ended" || !sessionIdRef.current) return;
    const id = sessionIdRef.current;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/sessions/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setBalanceMc(data.balanceMc);
      setSpentMc(data.chargedMc);
    }, 1500);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    const onLeave = () => finish();
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [finish]);

  const statusLabel = { idle: "Ready", connecting: "Connecting…", live: "Live", ended: "Ended" }[status];
  const estimatedCostMc = (elapsedMs / 1000) * price.perSecondMc;

  return (
    <div className="studio">
      {/* ------------------------------------------------------------------ Input */}
      <section className="card input-card">
        <div className="card-body">
          <h2 className="card-title">Input</h2>

          <div className="section-head">
            <h3>Start with an example</h3>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => loadExample(EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)])}
            >
              🔀 Surprise me
            </button>
          </div>
          <div className="examples">
            {EXAMPLES.map((example) => (
              <button
                type="button"
                key={example.title}
                className={`example ${prompt === example.prompt ? "selected" : ""}`}
                disabled={busy}
                onClick={() => loadExample(example)}
              >
                <span className="example-cover" style={{ background: example.cover }}>{example.emoji}</span>
                <span className="example-title">{example.title}</span>
                <span className="example-meta">
                  {example.collection}
                  {example.references ? ` · ${example.references.length} characters` : ""}
                </span>
              </button>
            ))}
          </div>

          <label className="field-label" htmlFor="prompt">Prompt<span className="req">*</span></label>
          <textarea
            id="prompt"
            value={prompt}
            disabled={busy}
            rows={6}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the style, the characters (looks, clothes, personality) and what happens. Example: Photorealistic cinema. Nora, a woman with a long dark braid and a burgundy jacket, runs for a departing ferry…"
          />
          <p className="hint">Tip: describe each character's face, hair and clothes so they stay consistent across shots.</p>

          <label className="field-label" htmlFor="resolution">Resolution</label>
          <select id="resolution" value={resolution} disabled={busy}
            onChange={(e) => setResolution(e.target.value as Resolution)}>
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>{r} — {usd(prices[r].perSecondMc * 60)}/min</option>
            ))}
          </select>

          <label className="field-label" htmlFor="aspect">Aspect Ratio</label>
          <select id="aspect" value={aspectRatio} disabled={busy}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}>
            <option value="16:9">16:9 — widescreen</option>
            <option value="9:16">9:16 — vertical (phones, Reels, TikTok)</option>
            <option value="1:1">1:1 — square</option>
          </select>

          <div className="section-head">
            <span className="field-label" style={{ margin: 0 }}>Reference images</span>
            {references.length > 0 && !busy && (
              <button type="button" className="link-btn" onClick={() => setReferences([])}>Clear reference images</button>
            )}
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            Add photos of your characters, places or objects (up to {MAX_REFERENCES}). Use the same name in your prompt.
          </p>

          {references.map((ref, index) => (
            <div className="ref-card" key={ref.key}>
              <div className="section-head">
                <strong>Reference image {index + 1}</strong>
                {!busy && (
                  <button type="button" className="link-btn"
                    onClick={() => setReferences((refs) => refs.filter((r) => r.key !== ref.key))}>
                    Remove
                  </button>
                )}
              </div>

              <label className="field-label" htmlFor={`name-${ref.key}`}>Name</label>
              <input
                id={`name-${ref.key}`}
                value={ref.name}
                disabled={busy}
                maxLength={64}
                placeholder="e.g. Nora"
                onChange={(e) => updateReference(ref.key, { name: e.target.value })}
              />

              <label className="field-label">Source URL<span className="req">*</span></label>
              <div
                className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => !busy && handleDrop(ref.key, e)}
                onPaste={(e) => !busy && handlePaste(ref.key, e)}
              >
                <div className="row">
                  <input
                    value={ref.uploading ? "Uploading…" : ref.url}
                    disabled={busy || ref.uploading}
                    placeholder="Paste an image URL, or add a file →"
                    onChange={(e) => setReferenceUrl(ref.key, e.target.value)}
                  />
                  <label className={`btn ${busy ? "disabled" : ""}`}>
                    Add image
                    <input
                      type="file"
                      accept={ACCEPTED}
                      hidden
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadInto(ref.key, file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {ref.error && <p className="error">{ref.error}</p>}
                <p className="hint">
                  <b>Hint:</b> Drag and drop an image from your computer, paste from clipboard (Ctrl/Cmd+V),
                  or provide a URL. Accepted file types: jpg, jpeg, png, webp, gif, avif, heic, heif.
                </p>
              </div>

              {ref.preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="ref-preview" src={ref.preview} alt={ref.name || `Reference ${index + 1}`}
                  style={{ opacity: ref.uploading ? 0.4 : 1 }} />
              )}

              <button type="button" className="link-btn block"
                onClick={() => updateReference(ref.key, { showAdvanced: !ref.showAdvanced })}>
                Advanced settings {ref.showAdvanced ? "▴" : "▾"}
              </button>
              {ref.showAdvanced && (
                <>
                  <label className="field-label" htmlFor={`fid-${ref.key}`}>Detail level</label>
                  <select id={`fid-${ref.key}`} value={ref.fidelity} disabled={busy}
                    onChange={(e) => updateReference(ref.key, { fidelity: e.target.value as Fidelity })}>
                    <option value="high">High — best likeness (default)</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low — just the general look</option>
                  </select>
                </>
              )}
            </div>
          ))}

          {references.length < MAX_REFERENCES && !busy && (
            <button type="button" className="btn add-ref" onClick={() => setReferences((r) => [...r, newReference()])}>
              + Add reference image
            </button>
          )}

          <span className="field-label">Script</span>
          <p className="hint" style={{ marginTop: 0 }}>
            Optional. Plan moments ahead: each beat starts at a set time after the movie begins.
          </p>
          {beats.map((beat, index) => (
            <div className="ref-card" key={beat.key}>
              <div className="section-head">
                <strong>Beat {index + 1}</strong>
                {!busy && (
                  <button type="button" className="link-btn"
                    onClick={() => setBeats((list) => list.filter((b) => b.key !== beat.key))}>Remove</button>
                )}
              </div>
              <label className="field-label" htmlFor={`offset-${beat.key}`}>Starts at (seconds)</label>
              <input id={`offset-${beat.key}`} inputMode="decimal" value={beat.offset} disabled={busy}
                onChange={(e) => setBeats((list) => list.map((b) => (b.key === beat.key ? { ...b, offset: e.target.value.replace(/[^\d.]/g, "") } : b)))} />
              <label className="field-label" htmlFor={`beat-${beat.key}`}>What happens</label>
              <textarea id={`beat-${beat.key}`} rows={3} value={beat.prompt} disabled={busy}
                placeholder="e.g. Nora leaps onto the ferry just as it leaves; Milo throws her the bag."
                onChange={(e) => setBeats((list) => list.map((b) => (b.key === beat.key ? { ...b, prompt: e.target.value } : b)))} />
            </div>
          ))}
          {beats.length < MAX_BEATS && !busy && (
            <button type="button" className="btn add-ref"
              onClick={() => setBeats((list) => [...list, {
                key: crypto.randomUUID(),
                offset: String(list.length ? (Number(list[list.length - 1].offset) || 0) + 15 : 0),
                prompt: "",
              }])}>
              + Add script beat
            </button>
          )}

          <span className="field-label">Reference audio</span>
          <p className="hint" style={{ marginTop: 0 }}>
            Optional. Up to {MAX_AUDIO} clips (a voice, music or dialogue) that shape the movie's sound.
          </p>
          {audioRefs.map((audio, index) => (
            <div className="ref-card" key={audio.key}>
              <div className="section-head">
                <strong>Reference audio {index + 1}</strong>
                {!busy && (
                  <button type="button" className="link-btn"
                    onClick={() => setAudioRefs((list) => list.filter((a) => a.key !== audio.key))}>Remove</button>
                )}
              </div>
              <label className="field-label" htmlFor={`aname-${audio.key}`}>Name</label>
              <input id={`aname-${audio.key}`} value={audio.name} maxLength={64} disabled={busy}
                placeholder="e.g. Nora's voice" onChange={(e) => updateAudio(audio.key, { name: e.target.value })} />
              <label className="field-label">Source URL<span className="req">*</span></label>
              <div className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file && !busy) uploadAudio(audio.key, file);
                }}>
                <div className="row">
                  <input value={audio.uploading ? "Uploading…" : audio.url} disabled={busy || audio.uploading}
                    placeholder="Paste an audio URL, or add a file →"
                    onChange={(e) => updateAudio(audio.key, { url: e.target.value.trim(), error: null })} />
                  <label className={`btn ${busy ? "disabled" : ""}`}>
                    Add audio
                    <input type="file" accept="audio/*" hidden disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadAudio(audio.key, file);
                        e.target.value = "";
                      }} />
                  </label>
                </div>
                {audio.error && <p className="error">{audio.error}</p>}
                <p className="hint"><b>Hint:</b> Drag and drop an audio file (mp3, wav, m4a, ogg) or provide a URL.</p>
              </div>
              {audio.url && !audio.uploading && <audio controls src={audio.url} className="audio-preview" />}
            </div>
          ))}
          {audioRefs.length < MAX_AUDIO && !busy && (
            <button type="button" className="btn add-ref"
              onClick={() => setAudioRefs((list) => [...list, { key: crypto.randomUUID(), name: "", url: "", uploading: false, error: null }])}>
              + Add reference audio
            </button>
          )}

          <button type="button" className="link-btn block" style={{ marginTop: 16 }} onClick={() => setShowAdvanced((v) => !v)}>
            Advanced settings {showAdvanced ? "▴" : "▾"}
          </button>
          {showAdvanced && (
            <>
              <label className="field-label" htmlFor="seed">Seed</label>
              <input id="seed" inputMode="numeric" value={seed} disabled={busy}
                placeholder="Random" onChange={(e) => setSeed(e.target.value.replace(/[^\d]/g, ""))} />
              <p className="hint">Use the same seed and prompt to get a similar result again.</p>
            </>
          )}
        </div>

        <div className="input-footer">
          {error && <span className="error footer-error">{error}</span>}
          <button type="button" className="btn" disabled={busy} onClick={reset}>Reset</button>
          <button type="button" id="connect" className="btn primary" disabled={!canConnect} onClick={connect}>
            Connect <kbd>CTRL ↵</kbd>
          </button>
        </div>
      </section>

      {/* ------------------------------------------------------------------ Result */}
      <section className="card result-card">
        <div className="card-body">
          <div className="section-head">
            <h2 className="card-title" style={{ margin: 0 }}>
              Result <span className={`badge badge-${status}`}>{statusLabel}</span>
            </h2>
            <button type="button" className="btn" onClick={() => playerRef.current?.requestFullscreen?.()}>
              ⛶ Enter world
            </button>
          </div>

          <div className="player" ref={playerRef}>
            <video ref={videoRef} autoPlay playsInline controls={status === "live"} />
            {status === "idle" && (
              <div className="player-empty"><span>Pick an example or write a prompt, then press <b>Connect</b>.</span></div>
            )}
            {status === "connecting" && <div className="player-empty"><span>Getting a GPU ready… this can take a moment.</span></div>}
          </div>

          {status !== "idle" && (
            <div className="directions" ref={directionsRef}>
              <div className="section-head">
                <span className="field-label" style={{ margin: 0 }}>Directions</span>
                {status === "live" && speechSupported && (
                  <select className="lang" value={speechLang} disabled={listening} aria-label="Speech language"
                    onChange={(e) => setSpeechLang(e.target.value)}>
                    {SPEECH_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </select>
                )}
              </div>
              {directions.length > 0 && (
                <ol className="direction-log">
                  {directions.map((d) => (
                    <li key={d.version} className={`direction-${d.state}`}>
                      <code>{formatClock(d.atMs)}</code>
                      <span>{d.via === "voice" ? "🎤 " : ""}{d.text}</span>
                      <em>{{ sent: "sending…", applied: "on screen", rejected: "rejected" }[d.state]}</em>
                    </li>
                  ))}
                </ol>
              )}
              {status === "live" && (
                <>
                  <div className="row">
                    <input
                      id="direction"
                      value={direction}
                      placeholder={listening ? "Listening… just speak" : "Type what happens next, e.g. Milo trips and Nora catches the bag"}
                      onChange={(e) => setDirection(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.ctrlKey && !e.metaKey && sendDirection(direction, "typed")}
                    />
                    <button type="button" className={`btn mic ${listening ? "on" : ""}`}
                      title={listening ? "Stop listening" : "Speak your direction"}
                      onClick={() => (listening ? stopListening() : startListening())}>
                      {listening ? "■ Stop mic" : "🎤 Speak"}
                    </button>
                    <button type="button" className="btn primary" onClick={() => sendDirection(direction, "typed")}>Send</button>
                  </div>
                  <p className="hint">
                    {listening
                      ? "Listening. Each sentence you say is sent to the scene when you pause."
                      : speechSupported
                        ? "Press Enter to send, or press Speak and say what should happen next."
                        : "Voice input isn't supported in this browser. Try Chrome, Edge or Safari."}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="session-bar">
            <span>
              {status === "live" && <>Session live · <code>{formatElapsed(elapsedMs)}</code></>}
              {status === "ended" && <>Session ended · <code>{formatElapsed(elapsedMs)}</code></>}
              {status === "connecting" && "Connecting…"}
              {status === "idle" && "No session yet"}
            </span>
            <span className="row" style={{ flex: "none" }}>
              {recording && (
                <a className="btn" href={recording} download="my-movie.webm">⬇ Download recording</a>
              )}
              {busy ? (
                <button type="button" className="btn dark" onClick={() => finish()}>Stop</button>
              ) : status === "ended" ? (
                <button type="button" className="btn dark" onClick={connect} disabled={!canConnect}>Start again</button>
              ) : null}
            </span>
          </div>

          {notice && <p className="notice">{notice}</p>}

          <div className="cost">
            <p>Sessions cost <b>{usd(price.perSecondMc, 4)}</b> per second of video at {resolution}.</p>
            {status !== "idle" && (
              <p>
                {status === "ended" ? "This session cost" : "Estimated cost so far"}{" "}
                <b>{usd(status === "ended" && spentMc > 0 ? spentMc : Math.max(spentMc, estimatedCostMc), 4)}</b>.
              </p>
            )}
            <p>
              Your balance: <b>{usd(balanceMc)}</b> (about {Math.floor(balanceMc / price.perSecondMc / 60)} min at {resolution}).{" "}
              <Link href="/billing">Top up</Link>
            </p>
            {balanceMc < price.minStartMc && !busy && (
              <p className="error">You need at least {usd(price.minStartMc)} to start a session.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
