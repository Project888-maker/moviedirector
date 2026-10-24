"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicJob } from "@/lib/jobs";
import { TIERS, findTool, type OutputType } from "@/lib/tools";
import { formatUsd } from "@/lib/pricing";

/** Where a finished result can go next, so creators can chain tools into a movie. */
export const NEXT_STEPS: Record<OutputType, { label: string; toolId: string; field: string }[]> = {
  video: [
    { label: "Add music", toolId: "sonilo-music", field: "video_url" },
    { label: "Add sound effects", toolId: "mirelo-sfx", field: "video_url" },
    { label: "Extend", toolId: "h3-extend", field: "video_url" },
    { label: "Restyle", toolId: "lucy-restyle", field: "video_url" },
    { label: "Edit with words", toolId: "flux-edit-video", field: "video_url" },
    { label: "Add to movie", toolId: "join-clips", field: "video_urls" },
  ],
  image: [
    { label: "Animate", toolId: "vidu-image", field: "image_url" },
    { label: "Cast in a scene", toolId: "h3-cast", field: "reference_image_urls" },
    { label: "Make it talk", toolId: "h3-lipsync", field: "image_url" },
    { label: "Edit", toolId: "klein-edit", field: "image_urls" },
  ],
  audio: [{ label: "Make a photo say it", toolId: "h3-lipsync", field: "audio_url" }],
};

export type UseResult = (toolId: string, field: string, url: string) => void;

const isPending = (job: PublicJob) => job.status === "queued" || job.status === "running";

/** Keeps a list of jobs fresh while any of them is still generating. */
export function useJobs(initial: PublicJob[]) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initial);
  const pending = jobs.filter(isPending).map((job) => job.id).join(",");

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const updates = await Promise.all(
        pending.split(",").map((id) =>
          fetch(`/api/jobs/${id}`, { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => (data?.job as PublicJob | undefined) ?? null)
            .catch(() => null),
        ),
      );
      if (cancelled) return;
      const changed = updates.filter((u): u is PublicJob => !!u && !isPending(u));
      setJobs((prev) => prev.map((job) => updates.find((u) => u?.id === job.id) ?? job));
      // A failed job is refunded; refresh the balance in the nav.
      if (changed.some((job) => job.status === "failed")) router.refresh();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pending, router]);

  return [jobs, setJobs] as const;
}

function Elapsed({ since }: { since: string }) {
  // Starts after mount so the server and browser render the same text.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (now == null) return null;
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return <>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</>;
}

export function JobCard({ job, onUse }: { job: PublicJob; onUse: UseResult }) {
  const tool = findTool(job.toolId);
  const [selected, setSelected] = useState(0);
  const url = job.outputUrls[selected] ?? job.outputUrls[0];
  const steps = NEXT_STEPS[job.outputType as OutputType] ?? [];

  return (
    <article className={`job-card ${job.status}`}>
      <header>
        <div>
          <b>{tool?.name ?? job.toolId}</b>
          {tool && <span className={`tier-pill ${tool.tier}`}>{TIERS[tool.tier].label}</span>}
        </div>
        <span className="muted">{formatUsd(job.chargedMc)}</span>
      </header>

      {isPending(job) && (
        <div className="job-wait">
          <span className="spinner" aria-hidden="true" />
          <div>
            <b>{job.status === "queued" ? "Waiting in line…" : "Generating…"} <Elapsed since={job.createdAt} /></b>
            <span className="muted">Usually {tool?.time ?? "a few minutes"}. You can keep working; it saves to My creations.</span>
          </div>
        </div>
      )}

      {job.status === "failed" && <p className="job-error">{job.error ?? "This didn't work. You have been refunded."}</p>}

      {job.status === "done" && url && (
        <>
          <div className="job-media">
            {job.outputType === "video" && <video src={`${url}#t=0.1`} controls playsInline preload="metadata" />}
            {job.outputType === "audio" && <audio src={url} controls preload="metadata" />}
            {job.outputType === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={job.prompt ?? "Generated image"} />
            )}
          </div>
          {job.outputUrls.length > 1 && (
            <div className="job-thumbs">
              {job.outputUrls.map((u, i) => (
                <button key={u} type="button" className={i === selected ? "on" : ""} onClick={() => setSelected(i)} aria-label={`Show image ${i + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" />
                </button>
              ))}
            </div>
          )}
          <div className="job-actions">
            <a className="btn small" href={url} target="_blank" rel="noreferrer" download>Download</a>
            {steps.map((step) => (
              <button key={step.label} type="button" className="btn small" onClick={() => onUse(step.toolId, step.field, url)}>
                {step.label} →
              </button>
            ))}
          </div>
        </>
      )}

      {job.prompt && <p className="job-prompt">{job.prompt}</p>}
    </article>
  );
}

/** The My creations grid, used on the library page. Results open in the Create page for next steps. */
export function CreationsGrid({ initialJobs }: { initialJobs: PublicJob[] }) {
  const [jobs] = useJobs(initialJobs);
  const onUse: UseResult = (toolId, field, url) => {
    window.location.href = `/create?tool=${toolId}&${field}=${encodeURIComponent(url)}`;
  };
  if (!jobs.length) {
    return (
      <div className="panel empty-state">
        <h2>Nothing here yet</h2>
        <p className="muted">Everything you make in Create is saved here.</p>
        <a className="btn primary" href="/create">Make something</a>
      </div>
    );
  }
  return (
    <div className="creations-grid">
      {jobs.map((job) => <JobCard key={job.id} job={job} onUse={onUse} />)}
    </div>
  );
}
