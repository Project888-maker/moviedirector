"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";
import { formatUsd } from "@/lib/pricing";
import { MovieRecorder, type Recording } from "../studio/recorder";

type Status = "idle" | "connecting" | "live" | "ended";
type Source = "webcam" | "file";
type Session = { send(message: object): void; close(): void };
type Look = { version: number; text: string; state: "sent" | "applied" };

// The model takes and returns 1280x704 at 24 fps.
const WIDTH = 1280;
const HEIGHT = 704;
const FPS = 24;

const PRESETS = [
  { label: "Anime", prompt: "Hand-drawn Japanese anime, clean line art, cel shading, vibrant colors, studio anime film look" },
  { label: "Pixar 3D", prompt: "Pixar-style 3D animated film, soft global illumination, expressive stylized characters, rich colors" },
  { label: "Claymation", prompt: "Claymation stop-motion, handmade plasticine characters and props, visible fingerprints, soft studio light" },
  { label: "Comic book", prompt: "Comic book illustration, bold black ink outlines, halftone dots, vivid flat colors" },
  { label: "Oil painting", prompt: "Impressionist oil painting, thick visible brush strokes, warm rich colors, canvas texture" },
  { label: "Cyberpunk", prompt: "Cyberpunk city at night, rain, magenta and teal neon lighting, futuristic cinematic look" },
  { label: "LEGO", prompt: "Everything made of LEGO bricks, plastic minifigure people, toy photography, bright studio light" },
  { label: "Watercolor", prompt: "Soft watercolor illustration, paper texture, pastel washes, gentle storybook look" },
  { label: "Superhero", prompt: "Blockbuster superhero movie, people wear sleek armored suits, dramatic lighting, cinematic color grade" },
  { label: "Zombie film", prompt: "Horror zombie movie, people are pale zombies with torn clothes, grim desaturated light, film grain" },
];

const STEPS = ["Network checked", "Machine found", "Connected", "Creating your look", "First frames"];

// Errors the model reports that end the session on its side.
const FATAL = new Set(["generation_failed", "balance_unavailable", "content_policy", "invalid_input"]);

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

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function Mirror({ perSecondMc, minStartMc, initialBalanceMc }: { perSecondMc: number; minStartMc: number; initialBalanceMc: number }) {
  const [source, setSource] = useState<Source>("webcam");
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [withSound, setWithSound] = useState(true);
  const [prompt, setPrompt] = useState(PRESETS[0].prompt);
  const [enhance, setEnhance] = useState(true);
  const [maxMinutes, setMaxMinutes] = useState(2);
  const [status, setStatus] = useState<Status>("idle");
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [looks, setLooks] = useState<Look[]>([]);
  const [direction, setDirection] = useState("");
  const [listening, setListening] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [spentMc, setSpentMc] = useState(0);
  const [balanceMc, setBalanceMc] = useState(initialBalanceMc);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [saving, setSaving] = useState(false);
  const [showInput, setShowInput] = useState(true);

  const inputVideoRef = useRef<HTMLVideoElement>(null);
  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const canvasStreamRef = useRef<{ stream: MediaStream; stop: () => void } | null>(null);
  const fileAudioRef = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const recorderRef = useRef<MovieRecorder | null>(null);
  const versionRef = useRef(0);
  const firstFrameRef = useRef(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const wantListeningRef = useRef(false);

  const busy = status === "connecting" || status === "live";
  const hasInput = source === "webcam" ? camOn : !!fileUrl;
  const canStart = !busy && hasInput && prompt.trim().length > 0 && balanceMc >= minStartMc;
  const perMinute = formatUsd(perSecondMc * 60);

  // ---- input --------------------------------------------------------------------------------

  async function startCamera() {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: WIDTH }, height: { ideal: HEIGHT }, frameRate: { ideal: FPS } },
        audio: withSound,
      });
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = stream;
      if (inputVideoRef.current) {
        inputVideoRef.current.srcObject = stream;
        inputVideoRef.current.muted = true;
        await inputVideoRef.current.play().catch(() => {});
      }
      setCamOn(true);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setCamError(
        name === "NotAllowedError"
          ? "Camera access was blocked. Allow it in your browser's address bar, then try again."
          : name === "NotFoundError"
            ? "No camera was found on this device. Try uploading a video instead."
            : "The camera couldn't start. Close other apps using it and try again.",
      );
    }
  }

  function stopCamera() {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    if (inputVideoRef.current && source === "webcam") inputVideoRef.current.srcObject = null;
    setCamOn(false);
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("Choose a video file (MP4, MOV or WebM).");
      return;
    }
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileUrl(URL.createObjectURL(file));
    setFileName(file.name);
    setError(null);
  }

  function chooseSource(next: Source) {
    if (busy || next === source) return;
    if (next === "file") stopCamera();
    setSource(next);
  }

  useEffect(() => {
    const el = inputVideoRef.current;
    if (source !== "file" || !el || !fileUrl) return;
    el.srcObject = null;
    el.src = fileUrl;
    el.loop = true;
    el.muted = true;
    el.play().catch(() => {});
  }, [source, fileUrl]);

  /**
   * The model only accepts exactly 1280x704 at 24 fps, so the camera or file is drawn onto a canvas
   * at that size (cover-fit) and the canvas is what gets sent. Cameras deliver 720p, 480p or
   * portrait shapes, and anything else comes back black.
   */
  function canvasStream(): MediaStream | null {
    const el = inputVideoRef.current;
    if (!el) return null;
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d")!;
    let frame = 0;
    const draw = () => {
      const { videoWidth: w, videoHeight: h } = el;
      if (w && h) {
        // Cover-fit: fill the frame, crop the overflow.
        const scale = Math.max(WIDTH / w, HEIGHT / h);
        const dw = w * scale;
        const dh = h * scale;
        ctx.drawImage(el, (WIDTH - dw) / 2, (HEIGHT - dh) / 2, dw, dh);
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    const stream = canvas.captureStream(FPS);
    canvasStreamRef.current = { stream, stop: () => cancelAnimationFrame(frame) };
    return stream;
  }

  /** The sound that goes into the recording: the microphone, or the uploaded video's own audio. */
  function recordingAudio(): MediaStreamTrack[] {
    if (!withSound) return [];
    if (source === "webcam") return camStreamRef.current?.getAudioTracks() ?? [];
    const el = inputVideoRef.current;
    if (!el) return [];
    if (!fileAudioRef.current) {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaElementSource(el).connect(dest);
      fileAudioRef.current = { ctx, dest };
    }
    fileAudioRef.current.ctx.resume().catch(() => {});
    return fileAudioRef.current.dest.stream.getAudioTracks();
  }

  // ---- session ------------------------------------------------------------------------------

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
    canvasStreamRef.current?.stop();
    canvasStreamRef.current = null;
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
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (message) setNotice(message);
  }, []);

  async function start() {
    if (!canStart) return;
    setError(null);
    setNotice(null);
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setSpentMc(0);
    setElapsedMs(0);
    setStartedAt(null);
    setStage(0);
    versionRef.current = 1;
    setLooks([{ version: 1, text: prompt.trim(), state: "sent" }]);

    const localStream = canvasStream();
    if (!localStream || !localStream.getVideoTracks().length) {
      setError("No video to send. Turn on your camera or choose a video.");
      return;
    }
    if (source === "file") inputVideoRef.current?.play().catch(() => {});

    const res = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "mirror" }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Could not start a session.");
      canvasStreamRef.current?.stop();
      return;
    }
    sessionIdRef.current = data.id;
    firstFrameRef.current = false;
    setStatus("connecting");

    const advance = (n: number) => setStage((s) => Math.max(s, n));
    const trackingFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      const target = new Headers(init?.headers).get("x-fal-target-url") ?? "";
      if (response.ok && target.endsWith("/ice")) advance(1);
      if (response.ok && target.endsWith("/session")) advance(2);
      return response;
    };

    // Requests go through our proxy, which adds the fal key and bills every heartbeat.
    const fal = createFalClient({ proxyUrl: `/api/fal/proxy?sid=${data.id}`, fetch: trackingFetch });
    const session = fal.realtime.open(wma("vast/eden-live-5b-video"), {
      receive: ["video"],
      localStream,
      onMedia: (stream) => {
        const video = outputVideoRef.current;
        if (video) {
          video.srcObject = stream;
          video.play().catch(() => {});
          watchFirstFrame(video);
        }
        if (!recorderRef.current && outputVideoRef.current && MovieRecorder.supported()) {
          try {
            const audio = recordingAudio();
            const recorder = new MovieRecorder(outputVideoRef.current, audio.length ? new MediaStream(audio) : stream);
            recorder.start();
            recorderRef.current = recorder;
          } catch (err) {
            console.error("Recording unavailable", err);
          }
        }
      },
      onData: (raw) => handleMessage(raw),
      onState: (state) => {
        console.info("[mirror] state", state);
        if (state === "live") advance(3);
        if (state === "closed" || state === "failed") finish();
      },
      onError: (err) => {
        const text = err instanceof Error ? err.message : String(err);
        console.error("realtime error", text);
        setError(
          /ICE|TURN|STUN|relay|peer connection/i.test(text)
            ? "The live video couldn't connect. Your network may block video calls: try another Wi-Fi, turn off your VPN, or use Chrome. Connections that never start are refunded."
            : text,
        );
        finish();
      },
    });
    sessionRef.current = session;
    session.send({ type: "configure", prompt: prompt.trim(), enable_prompt_expansion: enhance });
  }

  /** The session counts as live (and billable without refund) only once a restyled frame is on screen. */
  function watchFirstFrame(video: HTMLVideoElement) {
    const shown = () => {
      if (firstFrameRef.current || !sessionRef.current) return;
      firstFrameRef.current = true;
      console.info("[mirror] first frame", video.videoWidth, "x", video.videoHeight);
      setStage(STEPS.length);
      setStatus("live");
      setStartedAt(Date.now());
      if (sessionIdRef.current) fetch(`/api/sessions/${sessionIdRef.current}/live`, { method: "POST" }).catch(() => {});
    };
    const withCallback = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (withCallback.requestVideoFrameCallback) withCallback.requestVideoFrameCallback(shown);
    else video.addEventListener("loadeddata", shown, { once: true });
  }

  function handleMessage(raw: string) {
    let message: { type?: string; [key: string]: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type !== "stats" && message.type !== "pong") console.info("[mirror]", message);
    switch (message.type) {
      case "configured":
        // The look is set; frames follow a few seconds later.
        setStage((s) => Math.max(s, 4));
        setLooks((list) => list.map((l, i) => (i === list.length - 1 ? { ...l, state: "applied" } : l)));
        break;
      case "reset_applied":
        setLooks((list) => list.map((l, i) => (i === list.length - 1 ? { ...l, state: "applied" } : l)));
        break;
      case "prompt_applied":
        setLooks((list) => list.map((l, i) => (i === list.length - 1 ? { ...l, state: "applied" } : l)));
        break;
      case "error": {
        const text = String(message.error ?? "Something went wrong.");
        setError(/policy|safety/i.test(text) ? "The AI's safety filter blocked this. Try a different style or video." : text);
        if (message.retryable === false || FATAL.has(text)) finish();
        break;
      }
    }
  }

  function changeLook(raw: string, reset = false) {
    const text = raw.trim();
    if (!text || !sessionRef.current) return;
    versionRef.current += 1;
    sessionRef.current.send(reset ? { type: "reset", prompt: text } : { type: "prompt", prompt: text });
    setLooks((list) => [...list, { version: versionRef.current, text, state: "sent" }]);
    setPrompt(text);
    setDirection("");
  }

  // ---- voice --------------------------------------------------------------------------------

  function toggleVoice() {
    if (listening) {
      wantListeningRef.current = false;
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Speech = speechRecognition();
    if (!Speech) {
      setNotice("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    const recognition = new Speech();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) changeLook(event.results[i][0].transcript);
        else interim += event.results[i][0].transcript;
      }
      setDirection(interim);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        setNotice("Microphone access was blocked. Allow it in your browser's address bar to speak.");
        wantListeningRef.current = false;
        setListening(false);
      }
    };
    recognition.onend = () => {
      if (wantListeningRef.current && sessionRef.current) recognition.start();
      else setListening(false);
    };
    wantListeningRef.current = true;
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  // ---- timers, billing and cleanup ------------------------------------------------------------

  // Don't leave people waiting (or paying) for a picture that never comes: some networks block
  // video calls. Sessions that never showed a frame are refunded.
  useEffect(() => {
    if (status !== "connecting") return;
    const timer = setTimeout(
      () => finish("No picture arrived from the AI, so we stopped and refunded this session. Your network may block video calls: try another Wi-Fi, turn off your VPN, or use Chrome."),
      45_000,
    );
    return () => clearTimeout(timer);
  }, [status, finish]);

  useEffect(() => {
    if (status !== "live" || !startedAt) return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
    return () => clearInterval(timer);
  }, [status, startedAt]);

  useEffect(() => {
    if (status === "live" && maxMinutes > 0 && elapsedMs >= maxMinutes * 60_000) finish(`Stopped automatically at your ${maxMinutes}-minute limit.`);
  }, [status, elapsedMs, maxMinutes, finish]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(async () => {
      const id = sessionIdRef.current;
      if (!id) return;
      const res = await fetch(`/api/sessions/${id}`).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json();
      setBalanceMc(data.balanceMc);
      setSpentMc(data.chargedMc);
      if (data.status === "ended" && data.endReason === "insufficient_balance") {
        setError("You ran out of credit. Top up to keep going.");
        finish();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [busy, finish]);

  useEffect(() => {
    if (status !== "ended" || !sessionIdRef.current) return;
    const id = sessionIdRef.current;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/sessions/${id}`).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json();
      setBalanceMc(data.balanceMc);
      setSpentMc(data.chargedMc);
    }, 1500);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    const onLeave = () => finish();
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [finish]);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else stageRef.current?.requestFullscreen().catch(() => {});
  }

  // ---- render -------------------------------------------------------------------------------

  const statusLabel = { idle: "Ready", connecting: "Connecting…", live: "Live", ended: "Ended" }[status];
  const activePreset = PRESETS.find((p) => p.prompt === prompt.trim());

  return (
    <div className="mirror">
      <section className="panel mirror-input">
        <h2>Your video</h2>
        <div className="seg" role="tablist" aria-label="Video source">
          <button type="button" className={source === "webcam" ? "on" : ""} onClick={() => chooseSource("webcam")} disabled={busy}>Webcam</button>
          <button type="button" className={source === "file" ? "on" : ""} onClick={() => chooseSource("file")} disabled={busy}>Upload a video</button>
        </div>

        <div className={`mirror-preview ${source === "webcam" ? "selfie" : ""}`}>
          <video ref={inputVideoRef} playsInline muted autoPlay />
          {source === "webcam" && !camOn && (
            <div className="mirror-placeholder">
              <button type="button" className="btn primary" onClick={startCamera}>Turn on camera</button>
              <span>Your camera stays private until you press Start.</span>
              {camError && <span className="warn-text">{camError}</span>}
            </div>
          )}
          {source === "file" && !fileUrl && (
            <label className="mirror-placeholder drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); }}>
              <input type="file" accept="video/*" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
              <b>Choose a video</b>
              <span>or drop it here. It plays on a loop while the AI restyles it.</span>
            </label>
          )}
        </div>
        <div className="mirror-input-actions">
          {source === "webcam" && camOn && !busy && <button type="button" className="link-btn" onClick={stopCamera}>Turn camera off</button>}
          {source === "file" && fileUrl && !busy && (
            <label className="link-btn">
              <input type="file" accept="video/*" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
              Change video ({fileName.slice(0, 40)})
            </label>
          )}
          <label className="pg-toggle small">
            <input type="checkbox" checked={withSound} disabled={busy || (source === "webcam" && camOn)} onChange={(e) => setWithSound(e.target.checked)} />
            <span>{source === "webcam" ? "Record my microphone too" : "Keep the video's sound in the recording"}</span>
          </label>
        </div>

        <h2 className="mirror-h2">Choose a look</h2>
        <div className="mirror-presets">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className={activePreset?.label === p.label ? "on" : ""}
              onClick={() => (status === "live" ? changeLook(p.prompt) : setPrompt(p.prompt))}>
              {p.label}
            </button>
          ))}
        </div>
        <label>
          <span className="field-label">Or describe your own</span>
          <textarea rows={3} maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={status === "connecting"}
            placeholder="Ancient Roman marble statues come to life in a sunlit temple" />
        </label>
        <label className="pg-toggle small">
          <input type="checkbox" checked={enhance} disabled={busy} onChange={(e) => setEnhance(e.target.checked)} />
          <span>Enhance my description with AI (adds about a second)</span>
        </label>
        <label>
          <span className="field-label">Stop automatically after</span>
          <select value={maxMinutes} onChange={(e) => setMaxMinutes(Number(e.target.value))} disabled={busy}>
            {[1, 2, 5, 10].map((m) => <option key={m} value={m}>{m} minute{m > 1 ? "s" : ""} (max {formatUsd(perSecondMc * 60 * m)})</option>)}
            <option value={0}>No limit</option>
          </select>
        </label>

        <div className="mirror-start">
          <div>
            <b>{perMinute}</b><span className="muted"> per minute</span>
            <p className="hint">Billed per second, with a 10-second minimum. Balance {formatUsd(balanceMc)}.</p>
          </div>
          {busy ? (
            <button type="button" className="btn dark" onClick={() => finish()}>Stop</button>
          ) : (
            <button type="button" className="btn primary" onClick={start} disabled={!canStart}>Start Live Mirror</button>
          )}
        </div>
        {balanceMc < minStartMc && <p className="hint warn">You need at least {formatUsd(minStartMc)} of credit. <Link href="/billing">Top up</Link></p>}
        <p className="hint">Only use videos of people who agreed to it.</p>
      </section>

      <section className="panel mirror-result">
        <div className="mirror-result-head">
          <h2>Result <span className={`badge badge-${status}`}>{statusLabel}</span></h2>
          {busy && (
            <span className="mirror-meter">
              <b>{clock(elapsedMs)}</b> · {formatUsd(spentMc)} spent
            </span>
          )}
        </div>
        <div className={`mirror-stage ${status} ${source === "webcam" ? "selfie" : ""}`} ref={stageRef}>
          <video ref={outputVideoRef} playsInline autoPlay muted />
          {status === "connecting" && (
            <div className="mirror-loading" role="status">
              <span className="spinner" />
              <ol>
                {STEPS.map((label, i) => <li key={label} className={i < stage ? "done" : i === stage ? "current" : "todo"}>{label}</li>)}
              </ol>
            </div>
          )}
          {status === "idle" && (
            <div className="mirror-empty">
              <b>Become anything, live.</b>
              <span>Turn on your camera or pick a video, choose a look and press Start. The AI redraws every frame in real time while you move.</span>
            </div>
          )}
          {status === "ended" && !recording && !saving && <div className="mirror-empty"><b>Session ended.</b></div>}
          {status === "live" && showInput && source === "webcam" && camStreamRef.current && (
            <video className="mirror-pip" playsInline muted autoPlay ref={(el) => { if (el && camStreamRef.current && el.srcObject !== camStreamRef.current) el.srcObject = camStreamRef.current; }} />
          )}
          {busy && (
            <div className="mirror-stage-tools">
              {source === "webcam" && <button type="button" onClick={() => setShowInput(!showInput)}>{showInput ? "Hide me" : "Show me"}</button>}
              <button type="button" onClick={toggleFullscreen}>Fullscreen</button>
            </div>
          )}
        </div>

        {status === "live" && (
          <div className="mirror-live">
            <div className="row">
              <input value={direction} onChange={(e) => setDirection(e.target.value)} onKeyDown={(e) => e.key === "Enter" && changeLook(direction)}
                placeholder="Change the look: “now make it a snowy winter scene”" />
              <button type="button" className={`btn mic ${listening ? "on" : ""}`} onClick={toggleVoice}>{listening ? "Listening…" : "Speak"}</button>
              <button type="button" className="btn primary" onClick={() => changeLook(direction)} disabled={!direction.trim()}>Apply</button>
            </div>
            <p className="hint">
              New looks blend in within a second or two. <button type="button" className="link-btn" onClick={() => changeLook(prompt, true)}>Restart from the current frame</button> if it drifts.
            </p>
            <ul className="mirror-looks">
              {looks.slice(-4).reverse().map((l) => <li key={l.version} className={l.state}>{l.state === "applied" ? "✓" : "…"} {l.text}</li>)}
            </ul>
          </div>
        )}

        {error && <p className="pg-error" role="alert">{error}</p>}
        {notice && <p className="hint">{notice}</p>}

        {(saving || recording) && (
          <div className="mirror-recording">
            {saving && <p className="muted">Saving your recording…</p>}
            {recording && (
              <>
                <video src={recording.url} controls playsInline />
                <div className="row">
                  <a className="btn primary" href={recording.url} download={`live-mirror.${recording.extension}`}>Download video</a>
                  <span className="muted">{(recording.size / 1048576).toFixed(1)} MB · charged {formatUsd(spentMc)}</span>
                </div>
                <p className="hint">The recording lives in this browser tab. Download it before you leave the page.</p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
