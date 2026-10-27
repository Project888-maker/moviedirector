"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PublicJob } from "@/lib/jobs";
import { MC_PER_USD, formatUsd } from "@/lib/pricing";
import {
  GOALS,
  TIERS,
  TOOLS,
  defaultValues,
  findTool,
  measuredFields,
  typicalPriceMc,
  userPriceMc,
  type Durations,
  type Field,
  type GoalId,
  type Tool,
  type Values,
} from "@/lib/tools";
import { JobCard, useJobs, type UseResult } from "./Creations";
import { readDuration, uploadFile } from "./upload";

type Props = {
  markup: number;
  signedIn: boolean;
  initialBalanceMc: number;
  initialJobs: PublicJob[];
  initialToolId?: string;
  initialMedia?: Record<string, string>;
};

const ACCEPT = { image: "image/*", video: "video/mp4,video/quicktime,video/webm,video/*", audio: "audio/*" } as const;

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function initialValues(tool: Tool, media?: Record<string, string>): Values {
  const values = defaultValues(tool);
  for (const field of tool.fields) {
    const url = media?.[field.key];
    if (field.type === "media" && url && /^https:\/\//.test(url)) values[field.key] = [url];
  }
  return values;
}

export default function Playground({ markup, signedIn, initialBalanceMc, initialJobs, initialToolId, initialMedia }: Props) {
  const router = useRouter();
  const startTool = findTool(initialToolId ?? "") ?? TOOLS[0];
  const [toolId, setToolId] = useState(startTool.id);
  const [valuesByTool, setValuesByTool] = useState<Record<string, Values>>(() => ({ [startTool.id]: initialValues(startTool, initialMedia) }));
  const [durations, setDurations] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<{ message: string; topUp?: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [balanceMc, setBalanceMc] = useState(initialBalanceMc);
  const [jobs, setJobs] = useJobs(initialJobs);
  const formRef = useRef<HTMLElement>(null);

  const tool = findTool(toolId) ?? TOOLS[0];
  const goal = GOALS.find((g) => g.id === tool.goal)!;
  const values = valuesByTool[tool.id] ?? defaultValues(tool);
  const goalTools = TOOLS.filter((t) => t.goal === tool.goal);

  // Keep the chosen tool in the address bar so it can be bookmarked and shared.
  useEffect(() => {
    window.history.replaceState(null, "", `/create?tool=${tool.id}`);
  }, [tool.id]);

  // Read the length of uploaded videos and audio to show the price before generating.
  useEffect(() => {
    for (const field of measuredFields(tool)) {
      const url = (values[field.key] as string[])[0];
      if (!url || url in durations) continue;
      setDurations((d) => ({ ...d, [url]: null }));
      readDuration(url, field.kind as "video" | "audio").then((seconds) => setDurations((d) => ({ ...d, [url]: seconds })));
    }
  }, [tool, values, durations]);

  const price = useMemo(() => {
    const measured: Durations = {};
    for (const field of measuredFields(tool)) {
      const url = (values[field.key] as string[])[0];
      const seconds = url ? durations[url] : undefined;
      if (seconds == null) {
        const perSecond = tool.cost(values, { ...measured, [field.key]: 1 }) * MC_PER_USD * (1 + markup / 100);
        return { mc: null, note: `${url ? "Reading your file…" : `Add ${field.label.toLowerCase()} to see the price.`} About ${formatUsd(perSecond)} per second.` };
      }
      measured[field.key] = seconds;
    }
    return { mc: userPriceMc(tool.cost(values, measured), markup), note: null };
  }, [tool, values, durations, markup]);

  function selectTool(id: string) {
    const next = findTool(id);
    if (!next) return;
    setToolId(id);
    setError(null);
    setValuesByTool((all) => (all[id] ? all : { ...all, [id]: defaultValues(next) }));
  }

  function selectGoal(id: GoalId) {
    if (id === tool.goal) return;
    selectTool(TOOLS.find((t) => t.goal === id)!.id);
  }

  function setValue(key: string, value: Values[string]) {
    setValuesByTool((all) => ({ ...all, [tool.id]: { ...(all[tool.id] ?? defaultValues(tool)), [key]: value } }));
  }

  const sendToTool: UseResult = (nextToolId, field, url) => {
    const next = findTool(nextToolId);
    if (!next) return;
    const spec = next.fields.find((f) => f.key === field);
    setToolId(nextToolId);
    setError(null);
    setValuesByTool((all) => {
      const current = all[nextToolId] ?? defaultValues(next);
      const existing = (current[field] as string[]) ?? [];
      const max = spec?.type === "media" ? spec.max ?? 1 : 1;
      const urls = max > 1 ? [...existing.filter((u) => u !== url), url].slice(-max) : [url];
      return { ...all, [nextToolId]: { ...current, [field]: urls } };
    });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const uploading = Object.values(busy).some(Boolean);

  async function generate() {
    if (!signedIn) {
      router.push("/signup");
      return;
    }
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolId: tool.id, values }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setSubmitting(false);
    if (!res?.ok || !data?.job) {
      setError({ message: data?.error ?? "Couldn't start. Check your connection and try again.", topUp: res?.status === 402 });
      return;
    }
    setJobs((list) => [data.job as PublicJob, ...list]);
    if (typeof data.balanceMc === "number") setBalanceMc(data.balanceMc);
    if (data.job.status === "failed") setError({ message: data.job.error });
    router.refresh();
  }

  const canAfford = price.mc == null || balanceMc >= price.mc;

  return (
    <div className="pg">
      <header className="pg-head">
        <div>
          <h1>Create</h1>
          <p className="muted">
            Pick what you want to make, choose a budget, and see the exact price before you press Generate.
            New here? Read the <Link href="/guide">movie-making guide</Link>.
          </p>
        </div>
        <div className="row">
          <Link href="/director" className="btn primary">Ask the AI Director</Link>
          <Link href="/library" className="btn">My creations</Link>
        </div>
      </header>

      {/* ------------------------------------------------------------ 1. goal */}
      <section aria-label="What do you want to make?">
        <h2 className="pg-step"><span>1</span> What do you want to make?</h2>
        <div className="pg-goals">
          {GOALS.map((g) => (
            <button key={g.id} type="button" className={`pg-goal ${g.id === tool.goal ? "on" : ""}`} onClick={() => selectGoal(g.id)} aria-pressed={g.id === tool.goal}>
              <Icon d={g.icon} />
              <b>{g.title}</b>
              <span>{g.description}</span>
            </button>
          ))}
          <Link href="/studio" className="pg-goal live">
            <Icon d="M23 7l-7 5 7 5V7zM1 5h15v14H1z" />
            <b>Live movie <span className="tier-pill premium">Premium</span></b>
            <span>Direct a film in real time by typing or talking.</span>
          </Link>
          <Link href="/mirror" className="pg-goal live mirror">
            <Icon d="M15 10l5-3v10l-5-3M3 6h12v12H3z" />
            <b>Live Mirror <span className="tier-pill budget">New</span></b>
            <span>Turn your webcam or a video into anime, Pixar, clay… live.</span>
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------------------ 2. budget */}
      <section aria-label="Choose a tool">
        <h2 className="pg-step"><span>2</span> Choose your budget for “{goal.title.toLowerCase()}”</h2>
        <div className="pg-tools">
          {goalTools.map((t) => (
            <button key={t.id} type="button" className={`pg-tool ${t.id === tool.id ? "on" : ""}`} onClick={() => selectTool(t.id)} aria-pressed={t.id === tool.id}>
              <span className={`tier-pill ${t.tier}`}>{TIERS[t.tier].label}</span>
              <b>{t.name}</b>
              <span className="pg-tool-model">{t.model}</span>
              <span>{t.summary}</span>
              <span className="pg-tool-meta">
                <span>about {formatUsd(typicalPriceMc(t, markup))}</span>
                <span>{t.time}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ 3. make it */}
      <div className="pg-main">
        <section className="panel pg-form" ref={formRef} aria-label={`${tool.name} settings`}>
          <h2 className="pg-step"><span>3</span> {tool.name}</h2>
          <details className="pg-howto" open>
            <summary>How to use it · best for {tool.bestFor.toLowerCase()}</summary>
            <ul>{tool.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
          </details>

          {tool.fields.map((field) => (
            <FieldInput
              key={`${tool.id}-${field.key}`}
              field={field}
              value={values[field.key]}
              onChange={(v) => setValue(field.key, v)}
              onBusy={(b) => setBusy((all) => ({ ...all, [`${tool.id}-${field.key}`]: b }))}
              durations={durations}
            />
          ))}

          <div className="pg-price">
            <div>
              <span className="muted">Price</span>
              <b>{price.mc != null ? formatUsd(price.mc) : "—"}</b>
            </div>
            {signedIn && <span className="muted">Balance {formatUsd(balanceMc)}</span>}
          </div>
          {price.note && <p className="hint">{price.note}</p>}
          {!canAfford && <p className="hint warn">Not enough credit. <Link href="/billing">Top up</Link> to generate this.</p>}
          {error && (
            <p className="pg-error" role="alert">
              {error.message} {error.topUp && <Link href="/billing">Top up</Link>}
            </p>
          )}
          <button type="button" className="btn primary pg-generate" onClick={generate} disabled={submitting || uploading || (signedIn && !canAfford)}>
            {!signedIn ? "Sign up to generate" : submitting ? "Starting…" : uploading ? "Uploading…" : `Generate${price.mc != null ? ` · ${formatUsd(price.mc)}` : ""}`}
          </button>
          <p className="hint">If anything fails, the full price goes back to your balance automatically.</p>
        </section>

        <section className="pg-results" aria-label="Your creations">
          <div className="pg-results-head">
            <h2>Your creations</h2>
            {jobs.length > 0 && <Link href="/library">See all</Link>}
          </div>
          {jobs.length === 0 ? (
            <div className="panel empty-state">
              <p><b>Your results appear here.</b></p>
              <p className="muted">
                Each result has buttons for the next step: animate an image, add music to a clip, make a photo talk.
                Chain them to build a whole movie.
              </p>
            </div>
          ) : (
            <div className="pg-feed">
              {jobs.slice(0, 12).map((job) => <JobCard key={job.id} job={job} onUse={sendToTool} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ form fields

function FieldInput({
  field,
  value,
  onChange,
  onBusy,
  durations,
}: {
  field: Field;
  value: Values[string];
  onChange: (value: Values[string]) => void;
  onBusy: (busy: boolean) => void;
  durations: Record<string, number | null>;
}) {
  switch (field.type) {
    case "text":
      return (
        <label>
          <span className="field-label">{field.label}{field.required && <span className="req"> *</span>}</span>
          <textarea
            rows={field.rows ?? 3}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.help && <span className="hint">{field.help}</span>}
        </label>
      );
    case "select":
      return (
        <label>
          <span className="field-label">{field.label}</span>
          <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {field.help && <span className="hint">{field.help}</span>}
        </label>
      );
    case "slider":
      return (
        <label>
          <span className="field-label pg-slider-label">
            {field.label} <b>{String(value)}{field.unit && ` ${field.unit}`}</b>
          </span>
          <input type="range" min={field.min} max={field.max} step={field.step} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} />
          {field.help && <span className="hint">{field.help}</span>}
        </label>
      );
    case "toggle":
      return (
        <label className="pg-toggle">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>{field.label}</span>
        </label>
      );
    case "media":
      return <MediaInput field={field} urls={(value as string[]) ?? []} onChange={onChange} onBusy={onBusy} durations={durations} />;
  }
}

function MediaInput({
  field,
  urls,
  onChange,
  onBusy,
  durations,
}: {
  field: Extract<Field, { type: "media" }>;
  urls: string[];
  onChange: (urls: string[]) => void;
  onBusy: (busy: boolean) => void;
  durations: Record<string, number | null>;
}) {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const max = field.max ?? 1;
  const latest = useRef(urls);
  latest.current = urls;

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const picked = Array.from(files).slice(0, Math.max(1, max - (max > 1 ? urls.length : 0)));
    setUploading((n) => n + picked.length);
    onBusy(true);
    for (const file of picked) {
      try {
        const url = await uploadFile(file);
        onChange(max > 1 ? [...latest.current, url].slice(0, max) : [url]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The upload failed.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    onBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  const remove = (url: string) => onChange(urls.filter((u) => u !== url));
  const canAdd = max > 1 ? urls.length + uploading < max : true;
  const seconds = urls[0] ? durations[urls[0]] : null;

  return (
    <div className="pg-media">
      <span className="field-label">
        {field.label}{field.required && <span className="req"> *</span>}
        {max > 1 && <span className="muted"> · {urls.length}/{max}</span>}
      </span>
      <div className={`pg-media-list ${field.kind}`}>
        {urls.map((url, i) => (
          <figure key={url} className="pg-media-item">
            {field.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={`${field.label} ${i + 1}`} />
            )}
            {field.kind === "video" && <video src={url} muted playsInline controls preload="metadata" />}
            {field.kind === "audio" && <audio src={url} controls preload="metadata" />}
            {max > 1 && <span className="pg-ref-tag">@{i + 1}</span>}
            <button type="button" className="pg-remove" onClick={() => remove(url)} aria-label="Remove">×</button>
          </figure>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`up-${i}`} className="pg-media-item uploading"><span className="spinner" aria-hidden="true" /> Uploading…</div>
        ))}
        {canAdd && (
          <button type="button" className="pg-drop" onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            <b>{urls.length && max === 1 ? "Replace" : "Upload"} {field.kind}</b>
            <span>or drop it here</span>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" hidden accept={ACCEPT[field.kind]} multiple={max > 1} onChange={(e) => addFiles(e.target.files)} />
      {field.help && <span className="hint">{field.help}</span>}
      {field.seconds && seconds != null && (
        <span className={`hint ${seconds < field.seconds.min || seconds > field.seconds.max ? "warn" : ""}`}>
          Length {seconds.toFixed(1)} s{seconds < field.seconds.min || seconds > field.seconds.max ? ` · this tool takes ${field.seconds.min}–${field.seconds.max} s` : ""}
        </span>
      )}
      {error && <span className="hint warn">{error}</span>}
    </div>
  );
}
