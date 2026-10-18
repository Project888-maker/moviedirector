"use client";

import { useEffect, useRef } from "react";
import { poster, video } from "./media";

/** Muted looping clip that only plays while it's on screen. */
export default function LoopVideo({ id, className }: { id: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? el.play().catch(() => {}) : el.pause()),
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <video ref={ref} className={className} src={video(id)} poster={poster(id)}
      muted playsInline loop preload="none" aria-hidden="true" />
  );
}
