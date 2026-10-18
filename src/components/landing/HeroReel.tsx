"use client";

import { useEffect, useRef, useState } from "react";
import { CLIPS, poster, video } from "./media";

const REEL = ["harbor", "neon", "clouds", "space", "desert", "diner"];
const SHOT_MS = 5200;

/** Full-bleed background reel that crossfades between the example scenes. */
export default function HeroReel() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % REEL.length), SHOT_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    refs.current.forEach((el, i) => {
      if (!el) return;
      if (i === active) {
        el.currentTime = 0;
        el.play().catch(() => {});
      } else {
        el.pause();
      }
    });
  }, [active]);

  const clip = CLIPS.find((c) => c.id === REEL[active])!;
  return (
    <div className="lp-reel" aria-hidden="true">
      {REEL.map((id, i) => (
        <video
          key={id}
          ref={(el) => { refs.current[i] = el; }}
          className={i === active ? "on" : ""}
          src={video(id)}
          poster={poster(id)}
          muted
          playsInline
          loop
          preload={i < 2 ? "auto" : "metadata"}
        />
      ))}
      <div className="lp-reel-caption">
        <span className="lp-rec" /> {clip.genre} · “{clip.title}”
      </div>
    </div>
  );
}
