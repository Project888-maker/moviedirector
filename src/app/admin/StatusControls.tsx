"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Maintenance, ProviderAlert } from "@/lib/status";

export default function StatusControls({ maintenance, autoPause, alerts }: { maintenance: Maintenance; autoPause: boolean; alerts: ProviderAlert[] }) {
  const router = useRouter();
  const [message, setMessage] = useState(maintenance.message);
  const [saving, setSaving] = useState(false);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    await fetch("/api/admin/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="status-controls">
      <div className={`status-switch ${maintenance.on ? "on" : ""}`}>
        <div>
          <b>{maintenance.on ? "Generations are paused" : "Site is live"}</b>
          <span className="muted">
            {maintenance.on
              ? `Since ${maintenance.since ? new Date(maintenance.since).toLocaleString() : "now"}${maintenance.reason === "auto" ? " (paused automatically: a provider ran out of credit)" : ""}. Customers see the banner below and can't start new generations; you still can, to test.`
              : "Customers can generate normally."}
          </span>
        </div>
        <button type="button" className={`btn ${maintenance.on ? "primary" : "dark"}`} disabled={saving} onClick={() => save({ maintenance: !maintenance.on, message })}>
          {maintenance.on ? "Resume the site" : "Pause for maintenance"}
        </button>
      </div>
      <label>
        <span className="field-label">Banner message customers see while paused</span>
        <textarea rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      {message !== maintenance.message && (
        <button type="button" className="btn" disabled={saving} onClick={() => save({ maintenance: maintenance.on, message })}>Save message</button>
      )}
      <label className="pg-toggle">
        <input type="checkbox" checked={autoPause} disabled={saving} onChange={(e) => save({ autoPause: e.target.checked })} />
        <span>Pause automatically when fal or Anthropic runs out of credit</span>
      </label>
      {alerts.length > 0 && (
        <div className="status-alerts">
          {alerts.map((a) => (
            <p key={a.provider}>
              <b>{a.provider === "fal" ? "fal" : "Anthropic"} ran out of credit</b> at {new Date(a.at).toLocaleString()}. <span className="muted">{a.message}</span>
            </p>
          ))}
          <button type="button" className="btn" disabled={saving} onClick={() => save({ clearAlerts: true })}>I topped up, clear these alerts</button>
        </div>
      )}
    </div>
  );
}
