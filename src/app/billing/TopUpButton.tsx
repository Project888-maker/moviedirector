"use client";

import { useState } from "react";

export default function TopUpButton({ amountUsd }: { amountUsd: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountUsd }),
        });
        const data = await res.json().catch(() => null);
        if (data?.url) window.location.href = data.url;
        else {
          alert(data?.error ?? "Could not start checkout.");
          setBusy(false);
        }
      }}
    >
      Buy
    </button>
  );
}
