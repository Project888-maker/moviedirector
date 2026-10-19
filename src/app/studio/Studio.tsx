"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";
import { EXAMPLES, type Example } from "./examples";
import WorldLoader, { LOADING_STEPS } from "./WorldLoader";
import { MovieRecorder, type Recording } from "./recorder";

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
  // Came from a ready-made example (replaced when another example is picked).
  fromExample?: boolean;
};
type AudioReference = { key: string; name: string; url: string; uploading: boolean; error: string | null };
type Beat = { key: string; offset: string; prompt: string };
type Direction = { version: number; atMs: number; text: string; state: "sent" | "applied" | "rejected"; via: "world" | "typed" | "voice" };
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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the prompt mentions a reference by name; the model only uses photos it is told about. */
function mentions(prompt: string, name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}($|[^\\p{L}\\p{N}])`, "iu").test(prompt);
}

const castLine = (name: string) => `${name} is in this scene; match ${name}'s appearance exactly to the reference photo named ${name}.`;

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
  const [worldMode, setWorldMode] = useState(false);
  // How many of LOADING_STEPS are done; the movie is showing once all are.
  const [stage, setStage] = useState(0);
  const [muted, setMuted] = useState(false);
  const [sessionMenu, setSessionMenu] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
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
  const [recording, setRecording] = useState<Recording | null>(null);
  const [saving, setSaving] = useState(false);
  const [showResult, setShowResult] = useState(false);
  // Safety net: stop automatically after this many minutes (0 = no limit).
  const [maxMinutes, setMaxMinutes] = useState(2);

  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Names of the reference photos sent with the scene, to spot any the model refuses.
  const sentRefsRef = useRef<string[]>([]);
  const promptVersionRef = useRef(1);
  const recorderRef = useRef<MovieRecorder | null>(null);
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
    // Keep the user's own photos; only swap the previous example's cast.
    setReferences((refs) =>
      [
        ...(example.references ?? []).map((r) => ({ ...newReference(), name: r.name, url: r.url, preview: r.url, fromExample: true })),
        ...refs.filter((r) => !r.fromExample),
      ].slice(0, MAX_REFERENCES),
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
    if (recorderRef.current || !videoRef.current || !MovieRecorder.supported()) return;
    try {
      const recorder = new MovieRecorder(videoRef.current, stream);
      recorder.start();
      recorderRef.current = recorder;
    } catch (error) {
      console.error("Recording unavailable", error);
    }
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
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      setSaving(true);
      recorder.stop().then((file) => {
        setRecording(file);
        setSaving(false);
      });
    }
    setStatus((s) => (s === "idle" ? s : "ended"));
    if (session || recorder) setShowResult(true);
    setWorldMode(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (message) setNotice(message);
  }, []);

  async function connect() {
    if (!canConnect) return;
    setError(null);
    setNotice(null);
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setShowResult(false);
    setSpentMc(0);
    setElapsedMs(0);
    setStartedAt(null);
    startedAtRef.current = null;
    setDirections([{ version: 1, atMs: 0, text: prompt.trim(), state: "sent", via: "world" }]);
    setStage(0);
    setSessionMenu(false);
    setLogExpanded(false);

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
    setWorldMode(true);

    // Watch the realtime client's requests to show real progress on the loading screen.
    const advance = (n: number) => setStage((s) => Math.max(s, n));
    const trackingFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      const target = new Headers(init?.headers).get("x-fal-target-url") ?? "";
      if (response.ok && target.endsWith("/ice")) advance(1);
      if (response.ok && target.endsWith("/session")) advance(2);
      return response;
    };

    // Every request the realtime client makes goes through our proxy, tagged with the
    // billing session id. The proxy adds the fal key and meters the heartbeats.
    const fal = createFalClient({ proxyUrl: `/api/fal/proxy?sid=${data.id}`, fetch: trackingFetch });
    const session = fal.realtime.open(wma(modelId), {
      receive: ["video", "audio"],
      onMedia: (stream) => {
        if (videoRef.current) videoRef.current.srcObject = stream;
        startRecording(stream);
      },
      onData: (raw) => handleMessage(raw),
      onState: (state) => {
        if (state === "live") {
          setStage((s) => Math.max(s, 3));
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
    // Every photo needs a name the prompt uses; add a casting line for any the prompt never mentions.
    const castRefs = references
      .filter((r) => r.url && !r.error)
      .map((r, i) => ({ ...r, name: r.name.trim() || `Character ${i + 1}` }));
    const sceneprompt = [prompt.trim(), ...castRefs.filter((r) => !mentions(prompt, r.name)).map((r) => castLine(r.name))].join("\n");
    sentRefsRef.current = castRefs.map((r) => r.name);
    const script = beats
      .filter((b) => b.prompt.trim())
      .map((b) => ({ offset: Math.max(0, Number(b.offset) || 0), prompt: b.prompt.trim() }))
      .sort((a, b) => a.offset - b.offset);
    session.send({
      type: "configure",
      protocol_version: 1,
      prompt_version: promptVersionRef.current,
      prompt: sceneprompt,
      resolution,
      aspect_ratio: aspectRatio,
      ...(Number.isFinite(parsedSeed) ? { seed: parsedSeed } : {}),
      reference_images: castRefs.map((r) => ({ url: r.url, name: r.name, fidelity: r.fidelity })),
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
        setStage((s) => Math.max(s, 4));
        setStatus("live");
        markStarted();
        break;
      case "chunk":
        setStage(LOADING_STEPS.length);
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
            ? "That was blocked by the AI's safety filter."
            : message.reason === "invalid_image"
              ? "A reference photo couldn't be used. It may be unreadable, or blocked by the safety filter (for example real public figures)."
              : `That direction couldn't be used (${message.reason}).`,
        );
        break;
      case "reference_state": {
        // The model reports which references it accepted; say so if any photo was dropped.
        const accepted = new Set(
          ((message.references as { kind: string; name?: string | null }[]) ?? [])
            .filter((r) => r.kind === "image")
            .map((r) => (r.name ?? "").toLowerCase()),
        );
        const missing = sentRefsRef.current.filter((n) => !accepted.has(n.toLowerCase()));
        if (missing.length && accepted.size < sentRefsRef.current.length) {
          setNotice(
            `The AI didn't accept ${missing.length === 1 ? "the photo" : "the photos"} for ${missing.join(", ")}. ` +
              "Its safety filter blocks some photos, for example real public figures or celebrities. Try a different photo.",
          );
        }
        sentRefsRef.current = [];
        break;
      }
      case "error":
        setError(
          message.code === "content_policy"
            ? "The AI's safety filter blocked this scene or one of its photos (for example real public figures). Try a different photo or prompt."
            : message.code === "balance_unavailable"
              ? "Filming is temporarily unavailable. Please try again in a few minutes. You haven't been charged for this attempt."
              : String(message.error ?? message.code),
        );
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

  // World mode covers the page: lock scrolling behind it, and let Escape go back to the studio.
  useEffect(() => {
    if (!worldMode) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.fullscreenElement && setWorldMode(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [worldMode]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Bring the directions box into view once the movie starts.
  useEffect(() => {
    if (status === "live") directionsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [status]);

  // Stop automatically at the chosen length so a forgotten tab can't drain the balance.
  useEffect(() => {
    if (status === "live" && maxMinutes > 0 && elapsedMs >= maxMinutes * 60_000) {
      finish(`Stopped automatically at your ${maxMinutes}-minute limit.`);
    }
  }, [status, elapsedMs, maxMinutes, finish]);

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
                <span className="example-cover" style={{ backgroundImage: `url(${example.cover})` }} />
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

          <label className="field-label" htmlFor="maxlen">Stop automatically after</label>
          <select id="maxlen" value={maxMinutes} disabled={busy} onChange={(e) => setMaxMinutes(Number(e.target.value))}>
            {[1, 2, 5, 10].map((m) => (
              <option key={m} value={m}>{m} minute{m > 1 ? "s" : ""} (up to {usd(price.perSecondMc * 60 * m)})</option>
            ))}
            <option value={0}>No limit (stop it yourself)</option>
          </select>
          <p className="hint">A safety limit so a forgotten session can’t use up your credit.</p>

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

              {ref.url && !ref.uploading && !ref.error && !mentions(prompt, ref.name) && (
                <div className="ref-warn">
                  {ref.name.trim() ? (
                    <>
                      Your prompt doesn’t mention <b>{ref.name.trim()}</b>, so the AI won’t know where to use this photo.{" "}
                      {!busy && (
                        <button type="button" className="link-btn"
                          onClick={() => setPrompt((p) => `${p.trim()}${p.trim() ? "\n" : ""}${castLine(ref.name.trim())}`)}>
                          Add {ref.name.trim()} to the prompt
                        </button>
                      )}
                    </>
                  ) : (
                    <>Give this photo a name (like the character’s name) and use that name in your prompt.</>
                  )}
                </div>
              )}
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
      <section className={`card result-card ${worldMode ? "world-open" : ""}`}>
        <div className="card-body">
          <div className="section-head">
            <h2 className="card-title" style={{ margin: 0 }}>
              Result <span className={`badge badge-${status}`}>{statusLabel}</span>
            </h2>
            <button type="button" className="btn" disabled={!busy} onClick={() => setWorldMode(true)}>
              ⛶ Enter world
            </button>
          </div>

          <div className={`player ${worldMode ? "world" : ""}`} ref={playerRef}>
            <video ref={videoRef} autoPlay playsInline controls={!worldMode && status === "live"}
              onPlaying={() => setStage(LOADING_STEPS.length)} />
            {status === "idle" && (
              <div className="player-empty"><span>Pick an example or write a prompt, then press <b>Connect</b>.</span></div>
            )}
            {busy && stage < LOADING_STEPS.length && <WorldLoader stage={stage} />}

            {worldMode && (
              <>
                <div className="world-top">
                  <div className="row world-group">
                    <button type="button" className="world-btn" title="Back to studio (Esc)" onClick={() => setWorldMode(false)}>←</button>
                    <span className="world-pill">🎬 AI Movie Director</span>
                    <span className="world-pill hide-sm">H3 Max Reference Director</span>
                  </div>
                  {status === "live" && (
                    <div className={`world-meter ${maxMinutes > 0 && maxMinutes * 60_000 - elapsedMs < 15_000 ? "warn" : ""}`}>
                      <span className="dot live" />
                      <b>{formatClock(elapsedMs)}</b>
                      {maxMinutes > 0 && <span className="muted"> / {maxMinutes}:00</span>}
                      <span className="sep" />
                      <b>{usd(Math.max(spentMc, estimatedCostMc))}</b>
                      <span className="muted hide-sm"> · {usd(Math.max(0, balanceMc - Math.max(spentMc, estimatedCostMc)))} left</span>
                    </div>
                  )}
                  <div className="row world-group">
                    <button type="button" className="world-btn" title={muted ? "Unmute" : "Mute"} onClick={() => setMuted((m) => !m)}>
                      {muted ? "🔇" : "🔊"}
                    </button>
                    <button type="button" className="world-btn" title="Full screen"
                      onClick={() => (document.fullscreenElement ? document.exitFullscreen() : playerRef.current?.requestFullscreen?.())}>
                      ⛶
                    </button>
                    <div className="session-menu">
                      <button type="button" className="world-btn" onClick={() => setSessionMenu((v) => !v)}>
                        <span className={`dot ${status === "live" ? "live" : ""}`} /> Session ▾
                      </button>
                      {sessionMenu && (
                        <div className="session-pop">
                          <p><span className="muted">Status</span> <b>{statusLabel}</b></p>
                          <p><span className="muted">Time</span> <b>{formatElapsed(elapsedMs)}</b></p>
                          <p><span className="muted">Cost so far</span> <b>{usd(Math.max(spentMc, estimatedCostMc), 2)}</b></p>
                          <p><span className="muted">Balance</span> <b>{usd(balanceMc)}</b></p>
                          <button type="button" className="btn dark" style={{ width: "100%" }} onClick={() => finish("Session stopped.")}>
                            Stop session
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {(notice || error) && (
                  <div className={`world-toast ${error ? "bad" : ""}`} role="status">
                    <span>{error ?? notice}</span>
                    <button type="button" aria-label="Dismiss" onClick={() => { setNotice(null); setError(null); }}>✕</button>
                  </div>
                )}

                {status === "live" && stage >= LOADING_STEPS.length && (
                  <div className="world-bottom">
                    <div className={`world-log ${logExpanded ? "expanded" : ""}`}>
                      {(logExpanded ? directions : directions.slice(-1)).map((d) => {
                        const isNow = d.version === [...directions].reverse().find((x) => x.state === "applied")?.version;
                        return (
                          <div key={d.version} className={`world-log-item direction-${d.state}`}>
                            <div className="world-log-meta">
                              <code>{formatClock(d.atMs)}</code>
                              <b>{d.via === "world" ? "World" : d.via === "voice" ? "🎤 Voice" : "Direction"}</b>
                              {isNow && <span className="now">Now</span>}
                              {d.state === "sent" && <span className="muted">sending…</span>}
                              {d.state === "rejected" && <span className="rejected">rejected</span>}
                            </div>
                            <p>{d.text}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="world-compose">
                      <button type="button" className="world-expand" title={logExpanded ? "Show less" : "Show all directions"}
                        onClick={() => setLogExpanded((v) => !v)}>
                        {logExpanded ? "▾" : "▴"}
                      </button>
                      <textarea
                        rows={2}
                        value={direction}
                        placeholder={listening ? "Listening… just speak" : "What should happen next?"}
                        onChange={(e) => setDirection(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                            e.preventDefault();
                            sendDirection(direction, "typed");
                          }
                        }}
                      />
                      <div className="world-compose-bar">
                        {speechSupported && (
                          <select className="lang dark" value={speechLang} disabled={listening} aria-label="Speech language"
                            onChange={(e) => setSpeechLang(e.target.value)}>
                            {SPEECH_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                          </select>
                        )}
                        <span style={{ flex: 1 }} />
                        <button type="button" className={`world-btn mic ${listening ? "on" : ""}`}
                          title={speechSupported ? (listening ? "Stop listening" : "Speak your direction") : "Voice input isn't supported in this browser"}
                          disabled={!speechSupported}
                          onClick={() => (listening ? stopListening() : startListening())}>
                          {listening ? "■ Listening" : "🎤"}
                        </button>
                        <button type="button" className="world-send" disabled={!direction.trim()}
                          onClick={() => sendDirection(direction, "typed")}>
                          Send prompt ↵
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
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
              {saving && <span className="muted">Saving your movie…</span>}
              {recording && (
                <>
                  <button type="button" className="btn" onClick={() => setShowResult(true)}>▶ Watch</button>
                  <a className="btn" href={recording.url} download={`ai-movie.${recording.extension}`}>⬇ Download movie</a>
                </>
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
            <p>
              Filming costs <b>{usd(price.perSecondMc * 60)} per minute</b> at {resolution}, billed by the second
              ({usd(price.perSecondMc, 3)}/sec).
            </p>
            {status !== "idle" && (
              <p>
                {status === "ended" ? "This session cost" : "Estimated cost so far"}{" "}
                <b>{usd(status === "ended" && spentMc > 0 ? spentMc : Math.max(spentMc, estimatedCostMc))}</b>.
              </p>
            )}
            <p>
              Your balance: <b>{usd(balanceMc)}</b> (about {formatClock((balanceMc / price.perSecondMc) * 1000)} min at {resolution}).{" "}
              <Link href="/billing">Top up</Link>
            </p>
            {balanceMc < price.minStartMc && !busy && (
              <p className="error">You need at least {usd(price.minStartMc)} to start a session.</p>
            )}
          </div>
        </div>
      </section>

      {showResult && (
        <div className="result-modal" role="dialog" aria-modal="true" aria-label="Your movie">
          <div className="result-modal-card">
            <div className="section-head" style={{ marginTop: 0 }}>
              <h2 className="card-title" style={{ margin: 0 }}>Your movie is ready</h2>
              <button type="button" className="link-btn" onClick={() => setShowResult(false)} aria-label="Close">✕</button>
            </div>
            {saving && <div className="result-modal-wait">Saving your movie…</div>}
            {!saving && recording && (
              <video className="result-modal-video" src={recording.url} controls autoPlay playsInline />
            )}
            {!saving && !recording && (
              <div className="result-modal-wait">
                This browser couldn’t record the session. Try Chrome or Edge on a computer to save your movies.
              </div>
            )}
            <div className="result-modal-stats">
              <span>Length <b>{formatElapsed(elapsedMs)}</b></span>
              <span>Cost <b>{usd(spentMc > 0 ? spentMc : estimatedCostMc)}</b></span>
              <span>Balance <b>{usd(balanceMc)}</b></span>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              Movies are saved in this browser only. Download it now to keep it.
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShowResult(false)}>Close</button>
              {recording && (
                <a className="btn primary" href={recording.url} download={`ai-movie.${recording.extension}`}>
                  ⬇ Download movie ({(recording.size / 1_000_000).toFixed(1)} MB)
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
