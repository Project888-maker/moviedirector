"use client";

import { useState } from "react";
import { downloadMedia } from "@/lib/media";

/** Saves a result through our domain, showing progress for large videos. */
export function DownloadButton({ url, className = "btn small" }: { url: string; className?: string }) {
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress !== null;
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setProgress(0);
        await downloadMedia(url, setProgress);
        setProgress(null);
      }}
    >
      {busy ? `Downloading… ${Math.round(progress * 100)}%` : "Download"}
    </button>
  );
}
