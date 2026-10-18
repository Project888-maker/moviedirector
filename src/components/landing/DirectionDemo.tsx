"use client";

import { useEffect, useState } from "react";

const SCRIPT = [
  { text: "Nora leaps onto the ferry just as it pulls away", voice: false },
  { text: "Milo throws her the canvas bag from the dock", voice: true },
  { text: "Rain starts to fall and the gulls scatter", voice: false },
  { text: "Cut to Nora on deck, laughing, bag in hand", voice: true },
];

/** A looping mock of the live director's composer: a direction is typed, sent, then lands on screen. */
export default function DirectionDemo({ compact = false }: { compact?: boolean }) {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"typing" | "sent" | "applied">("typing");
  const line = SCRIPT[index];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(line.text);
      setPhase("applied");
      return;
    }
    let cancelled = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      setPhase("typing");
      for (let i = 1; i <= line.text.length && !cancelled; i++) {
        setTyped(line.text.slice(0, i));
        await wait(line.voice ? 28 : 45);
      }
      if (cancelled) return;
      await wait(500);
      setPhase("sent");
      await wait(1100);
      if (cancelled) return;
      setPhase("applied");
      await wait(2400);
      if (!cancelled) setIndex((i) => (i + 1) % SCRIPT.length);
    })();
    return () => { cancelled = true; };
  }, [index, line]);

  const stamp = `0:${String(12 + index * 9).padStart(2, "0")}`;
  return (
    <div className={`lp-demo ${compact ? "compact" : ""}`} aria-hidden="true">
      {phase !== "typing" && (
        <div className="lp-demo-log">
          <div className="lp-demo-meta">
            <code>{stamp}</code>
            <b>{line.voice ? "🎤 Voice" : "Direction"}</b>
            {phase === "applied" ? <span className="now">On screen</span> : <span className="muted">sending…</span>}
          </div>
          <p>{line.text}</p>
        </div>
      )}
      <div className="lp-demo-compose">
        <p className={phase === "typing" ? "typing" : "placeholder"}>
          {phase === "typing" ? typed : "What should happen next?"}
        </p>
        <div className="lp-demo-bar">
          <span className={`lp-demo-mic ${line.voice && phase === "typing" ? "on" : ""}`}>
            {line.voice && phase === "typing" ? "● Listening" : "🎤"}
          </span>
          <span className="lp-demo-send">Send ↵</span>
        </div>
      </div>
    </div>
  );
}
