"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_RETRIES = 2;
const SLOW_AFTER_MS = 8000;
const MEDIA_ERRORS: Record<number, string> = { 1: "aborted", 2: "network", 3: "decode", 4: "unsupported" };

/** Sends playback failures to the server log so we can see how often and where videos break. */
function report(event: string, url: string, detail: Record<string, unknown> = {}) {
  try {
    const body = JSON.stringify({ event, url, ...detail });
    if (!navigator.sendBeacon?.("/api/client-errors", new Blob([body], { type: "application/json" }))) {
      fetch("/api/client-errors", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
    }
  } catch {
    // Reporting must never break playback.
  }
}

/**
 * A result video that recovers from stalls and errors instead of showing a dead player.
 * On an error it reloads and resumes from the same second (twice automatically), then
 * offers Try again / Open / Download so the customer is never stuck on a crossed-out play icon.
 */
export function ResultVideo({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const resumeAt = useRef(0);
  const wasPlaying = useRef(false);
  const attempts = useRef(0);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [reloading, setReloadingState] = useState(false);
  const reloadingRef = useRef(false);
  const setReloading = useCallback((v: boolean) => { reloadingRef.current = v; setReloadingState(v); }, []);

  const clearSlow = useCallback(() => {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = null;
    setSlow(false);
  }, []);

  const startSlowTimer = useCallback(() => {
    if (slowTimer.current) return;
    slowTimer.current = setTimeout(() => {
      setSlow(true);
      report("slow", url, { at: ref.current?.currentTime ?? 0 });
    }, SLOW_AFTER_MS);
  }, [url]);

  const reload = useCallback(() => {
    const video = ref.current;
    if (!video) return;
    setFailed(false);
    setReloading(true);
    clearSlow();
    video.load(); // Re-requests the file; the src stays the same so the CDN cache still works.
  }, [clearSlow, setReloading]);

  // Reset when the card switches to another result.
  useEffect(() => {
    attempts.current = 0;
    resumeAt.current = 0;
    wasPlaying.current = false;
    setFailed(false);
    setReloading(false);
    clearSlow();
  }, [url, clearSlow, setReloading]);

  useEffect(() => () => { if (slowTimer.current) clearTimeout(slowTimer.current); }, []);

  const onError = () => {
    const video = ref.current;
    const code = video?.error?.code ?? 0;
    report("error", url, { code, kind: MEDIA_ERRORS[code] ?? "unknown", attempt: attempts.current, at: resumeAt.current });
    clearSlow();
    if (attempts.current < AUTO_RETRIES) {
      attempts.current += 1;
      setTimeout(reload, 800 * attempts.current);
      return;
    }
    setReloading(false);
    setFailed(true);
  };

  const onLoadedMetadata = () => {
    const video = ref.current;
    if (!video) return;
    if (resumeAt.current > 0.5) video.currentTime = resumeAt.current;
    if (reloadingRef.current && wasPlaying.current) video.play().catch(() => {});
    setReloading(false);
  };

  const retryByHand = () => {
    attempts.current = 0;
    wasPlaying.current = true;
    reload();
  };

  return (
    <div className="result-video">
      <video
        ref={ref}
        src={`${url}#t=0.1`}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={() => { if (ref.current) resumeAt.current = ref.current.currentTime; }}
        onPlay={() => { wasPlaying.current = true; }}
        onPause={() => { if (!reloadingRef.current) wasPlaying.current = false; }}
        onWaiting={startSlowTimer}
        onStalled={startSlowTimer}
        onPlaying={clearSlow}
        onCanPlay={clearSlow}
        onError={onError}
      />
      {(slow || reloading) && !failed && (
        <div className="result-video-note">
          <span className="spinner" aria-hidden="true" />
          <span>{reloading ? "Reconnecting…" : "Loading slowly on this connection…"}</span>
          {slow && <button type="button" className="btn small" onClick={retryByHand}>Reload</button>}
        </div>
      )}
      {failed && (
        <div className="result-video-fail" role="alert">
          <b>The video didn’t load.</b>
          <span>Your result is saved. Try again, or open it directly.</span>
          <div className="job-actions">
            <button type="button" className="btn small primary" onClick={retryByHand}>Try again</button>
            <a className="btn small" href={url} target="_blank" rel="noreferrer">Open video</a>
          </div>
        </div>
      )}
    </div>
  );
}
