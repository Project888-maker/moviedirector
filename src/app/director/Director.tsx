"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PublicJob } from "@/lib/jobs";
import { formatUsd } from "@/lib/pricing";
import { TIERS, findTool } from "@/lib/tools";
import type { Approval } from "@/lib/director/tools";
import type { Attachment, DirectorEvent, Effort } from "@/lib/director/agent";
import type { TimelineItem, TimelinePart } from "@/lib/director/timeline";
import { JobCard, NEXT_STEPS } from "../create/Creations";
import { uploadFile } from "../create/upload";
import Markdown from "./Markdown";

type ChatSummary = { id: string; title: string; updatedAt: string };
type ChatData = {
  chat: { id: string; title: string; effort: Effort; askApproval: boolean; aiChargedMc: number; busy: boolean; unreported: number };
  timeline: TimelineItem[];
  approvals: Approval[];
  jobs: PublicJob[];
  balanceMc: number;
};
type Live = { thinking: string; text: string; steps: string[]; startedAt: number };
type Draft = Attachment & { uploading?: boolean; preview?: string };
type Input =
  | { kind: "message"; text: string; attachments: Attachment[] }
  | { kind: "approval"; decisions: Record<string, boolean> }
  | { kind: "update" };

const EFFORT_INFO: Record<Effort, { label: string; hint: string }> = {
  low: { label: "Low", hint: "Fastest and cheapest. Good for simple requests." },
  medium: { label: "Medium", hint: "Balanced. Recommended for most work." },
  high: { label: "High", hint: "Thinks hardest. For planning films and tricky fixes." },
};

const SUGGESTIONS = [
  { title: "Put me in a scene", text: "I want to star in a short cinematic clip. What do you need from me?" },
  { title: "Make a product ad", text: "Help me make a 15-second vertical ad for my product. I'll upload photos." },
  { title: "Plan a short film", text: "Help me plan and make a 1-minute short film on a budget of about $5." },
  { title: "Talking photo", text: "Make a photo of me say a short welcome message in a natural voice." },
  { title: "What can you do?", text: "What can you make on this platform, and roughly what does it cost?" },
];

const kindOf = (file: File): Attachment["kind"] | null =>
  file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;

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

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const ICONS = {
  plus: "M12 5v14M5 12h14",
  send: "M12 19V5M5 12l7-7 7 7",
  stop: "M7 7h10v10H7z",
  mic: "M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm7 9a7 7 0 0 1-14 0m7 7v4",
  hand: "M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  media: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  chevron: "M9 6l6 6-6 6",
  check: "M5 13l4 4L19 7",
  menu: "M4 6h16M4 12h16M4 18h16",
  x: "M6 6l12 12M18 6 6 18",
};

function Thumb({ url, kind }: { url: string; kind: Attachment["kind"] }) {
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" />;
  }
  if (kind === "video") return <video src={`${url}#t=0.1`} muted playsInline preload="metadata" />;
  return <span className="dir-audio-thumb"><Icon d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></span>;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  if (now == null) return null;
  return <>{((now - since) / 1000).toFixed(1)}s</>;
}

/** Thinking and tool steps, folded into one "Worked" line like a director's notes. */
function WorkLog({ parts, live }: { parts: TimelinePart[]; live?: Live }) {
  const [open, setOpen] = useState(false);
  const steps = parts.filter((p) => p.type === "step");
  const thoughts = parts.filter((p) => p.type === "thinking");
  if (!live && !steps.length && !thoughts.length) return null;
  const summary = live ? <>Working… <Elapsed since={live.startedAt} /></> : `Worked · ${steps.length ? `${steps.length} step${steps.length === 1 ? "" : "s"}` : "thought it through"}`;
  return (
    <div className={`dir-work ${open ? "open" : ""}`}>
      <button type="button" className="dir-work-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {live && <span className="spinner small" aria-hidden="true" />}
        <span>{summary}</span>
        <Icon d={ICONS.chevron} size={14} />
      </button>
      {(open || live) && (
        <div className="dir-work-body">
          {parts.map((p, i) =>
            p.type === "thinking" ? (
              <p key={i} className="dir-thought">{p.text}</p>
            ) : p.type === "step" ? (
              <p key={i} className={`dir-step ${p.error ? "error" : ""}`}><Icon d={p.error ? ICONS.x : ICONS.check} size={14} /> {p.label}</p>
            ) : null,
          )}
          {live && live.thinking && <p className="dir-thought live">{live.thinking.slice(-600)}</p>}
        </div>
      )}
    </div>
  );
}

export default function Director({
  initialChats,
  initialChatId,
  initialBalanceMc,
}: {
  initialChats: ChatSummary[];
  initialChatId: string | null;
  initialBalanceMc: number;
}) {
  const router = useRouter();
  const [chats, setChats] = useState(initialChats);
  const [activeId, setActiveId] = useState<string | null>(initialChatId);
  const [data, setData] = useState<ChatData | null>(null);
  const [loading, setLoading] = useState(!!initialChatId);
  const [live, setLive] = useState<Live | null>(null);
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [effort, setEffort] = useState<Effort>("medium");
  const [askApproval, setAskApproval] = useState(true);
  const [effortOpen, setEffortOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [panel, setPanel] = useState<"none" | "chats" | "media">("none");
  const [mediaTab, setMediaTab] = useState<"outputs" | "attachments">("outputs");
  const [preview, setPreview] = useState<{ url: string; kind: Attachment["kind"] } | null>(null);
  const [listening, setListening] = useState(false);
  const [balanceMc, setBalanceMc] = useState(initialBalanceMc);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const streaming = live !== null;

  const loadChats = useCallback(async () => {
    const res = await fetch("/api/director/chats", { cache: "no-store" }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (json?.chats) setChats(json.chats);
  }, []);

  const loadChat = useCallback(async (id: string) => {
    const res = await fetch(`/api/director/chats/${id}`, { cache: "no-store" }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as ChatData | null;
    setLoading(false);
    if (!res?.ok || !json?.chat) {
      setNotice({ text: "Couldn't open this chat.", error: true });
      return;
    }
    setData(json);
    setBalanceMc(json.balanceMc);
    setEffort(json.chat.effort);
    setAskApproval(json.chat.askApproval);
  }, []);

  useEffect(() => {
    if (activeId) loadChat(activeId);
  }, [activeId, loadChat]);

  useEffect(() => {
    if (!effortOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".dir-effort")) setEffortOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [effortOpen]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data?.timeline.length, live?.text, live?.steps.length, data?.approvals.length]);

  function openChat(id: string | null) {
    abortRef.current?.abort();
    setActiveId(id);
    setData(null);
    setLive(null);
    setNotice(null);
    setPanel("none");
    setLoading(!!id);
    window.history.replaceState(null, "", id ? `/director?chat=${id}` : "/director");
  }

  async function ensureChat(): Promise<string | null> {
    if (activeId) return activeId;
    const res = await fetch("/api/director/chats", { method: "POST" }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!json?.id) return null;
    setActiveId(json.id);
    window.history.replaceState(null, "", `/director?chat=${json.id}`);
    await fetch(`/api/director/chats/${json.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effort, askApproval }),
    }).catch(() => {});
    return json.id;
  }

  const send = useCallback(
    async (input: Input, chatId?: string) => {
      const id = chatId ?? activeId;
      if (!id) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setNotice(null);
      setLive({ thinking: "", text: "", steps: [], startedAt: Date.now() });
      // Show the person's message right away.
      if (input.kind === "message") {
        setData((d) =>
          d ? { ...d, approvals: [], timeline: [...d.timeline, { kind: "user", id: `local-${Date.now()}`, text: input.text, attachments: input.attachments }] } : d,
        );
      } else if (input.kind === "approval") setData((d) => (d ? { ...d, approvals: [] } : d));

      try {
        const res = await fetch(`/api/director/chats/${id}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input, effort }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const json = await res.json().catch(() => null);
          setNotice({ text: json?.error ?? "Couldn't reach the Director. Try again.", error: true });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as DirectorEvent;
            if (event.t === "text") setLive((l) => (l ? { ...l, text: l.text + event.text } : l));
            else if (event.t === "thinking") setLive((l) => (l ? { ...l, thinking: l.thinking + event.text } : l));
            else if (event.t === "step") setLive((l) => (l ? { ...l, steps: [...l.steps, event.label] } : l));
            else if (event.t === "error") setNotice({ text: event.message, error: true });
            else if (event.t === "notice") setNotice({ text: event.text });
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) setNotice({ text: "The connection dropped. Your chat is saved.", error: true });
      } finally {
        abortRef.current = null;
        setLive(null);
        await loadChat(id);
        loadChats();
        router.refresh();
      }
    },
    [activeId, effort, loadChat, loadChats, router],
  );

  async function submit(override?: string) {
    const message = (override ?? text).trim();
    const ready = drafts.filter((d) => !d.uploading);
    if (streaming || (!message && !ready.length) || drafts.some((d) => d.uploading)) return;
    const id = await ensureChat();
    if (!id) {
      setNotice({ text: "Couldn't start a chat. Are you signed in?", error: true });
      return;
    }
    setText("");
    setDrafts([]);
    if (!data) setData({ chat: { id, title: message.slice(0, 60) || "New chat", effort, askApproval, aiChargedMc: 0, busy: false, unreported: 0 }, timeline: [], approvals: [], jobs: [], balanceMc });
    await send({ kind: "message", text: message, attachments: ready.map(({ url, kind, name }) => ({ url, kind, name })) }, id);
  }

  function decide(decisions: Record<string, boolean>) {
    if (!streaming) send({ kind: "approval", decisions });
  }

  // ---- generations: watch the ones still running and tell the Director when they finish
  const pendingJobs = (data?.jobs ?? []).filter((j) => j.status === "queued" || j.status === "running").map((j) => j.id).join(",");
  useEffect(() => {
    if (!pendingJobs || !activeId) return;
    const timer = setInterval(async () => {
      const updates = await Promise.all(
        pendingJobs.split(",").map((id) =>
          fetch(`/api/jobs/${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => (j?.job as PublicJob) ?? null).catch(() => null),
        ),
      );
      const finished = updates.some((u) => u && u.status !== "queued" && u.status !== "running");
      setData((d) => (d ? { ...d, jobs: d.jobs.map((job) => updates.find((u) => u?.id === job.id) ?? job) } : d));
      if (finished) window.dispatchEvent(new Event("director-job-finished"));
    }, 5000);
    return () => clearInterval(timer);
  }, [pendingJobs, activeId]);

  const sendRef = useRef(send);
  sendRef.current = send;
  const stateRef = useRef({ streaming, approvals: data?.approvals.length ?? 0 });
  stateRef.current = { streaming, approvals: data?.approvals.length ?? 0 };
  // Generations that finished while the person was away: let the Director review them now.
  const unreported = data?.chat.unreported ?? 0;
  useEffect(() => {
    if (unreported > 0 && !stateRef.current.streaming && !stateRef.current.approvals && !data?.chat.busy) sendRef.current({ kind: "update" });
    // Only when a chat (re)loads with something new to report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreported, data?.chat.id]);

  useEffect(() => {
    const onFinished = () => {
      if (!stateRef.current.streaming && !stateRef.current.approvals) sendRef.current({ kind: "update" });
    };
    window.addEventListener("director-job-finished", onFinished);
    return () => window.removeEventListener("director-job-finished", onFinished);
  }, []);

  // ---- composer helpers
  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files).slice(0, 10)) {
      const kind = kindOf(file);
      if (!kind) {
        setNotice({ text: `${file.name}: only images, videos and audio are supported.`, error: true });
        continue;
      }
      const preview = URL.createObjectURL(file);
      const key = `${preview}`;
      setDrafts((d) => [...d, { url: key, kind, name: file.name.slice(0, 100), uploading: true, preview }]);
      try {
        const url = await uploadFile(file);
        setDrafts((d) => d.map((x) => (x.url === key ? { ...x, url, uploading: false } : x)));
      } catch (err) {
        setDrafts((d) => d.filter((x) => x.url !== key));
        setNotice({ text: err instanceof Error ? err.message : "Upload failed.", error: true });
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function attach(url: string, kind: Attachment["kind"], name: string) {
    setDrafts((d) => (d.some((x) => x.url === url) ? d : [...d, { url, kind, name }]));
    setPreview(null);
    setPanel("none");
    textRef.current?.focus();
  }

  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Speech = speechRecognition();
    if (!Speech) {
      setNotice({ text: "Voice input isn't supported in this browser. Try Chrome or Edge.", error: true });
      return;
    }
    const recognition = new Speech();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;
    const base = text ? `${text.trimEnd()} ` : "";
    let heard = "";
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) heard += event.results[i][0].transcript;
      setText(base + heard.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function saveSetting(patch: { effort?: Effort; askApproval?: boolean }) {
    if (patch.effort) setEffort(patch.effort);
    if (patch.askApproval !== undefined) setAskApproval(patch.askApproval);
    if (!activeId) return;
    await fetch(`/api/director/chats/${activeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
  }

  async function deleteChat(id: string) {
    if (!window.confirm("Delete this chat? Its generations stay in My creations.")) return;
    await fetch(`/api/director/chats/${id}`, { method: "DELETE" }).catch(() => {});
    setChats((c) => c.filter((x) => x.id !== id));
    if (id === activeId) openChat(null);
  }

  const jobsById = useMemo(() => new Map((data?.jobs ?? []).map((j) => [j.id, j])), [data?.jobs]);
  const outputs = (data?.jobs ?? []).flatMap((j) => (j.status === "done" ? j.outputUrls.map((url) => ({ url, kind: j.outputType as Attachment["kind"], job: j })) : []));
  const attachments = (data?.timeline ?? []).flatMap((item) => (item.kind === "user" ? item.attachments : []));
  const spentMc = (data?.chat.aiChargedMc ?? 0) + (data?.jobs ?? []).filter((j) => j.status !== "failed").reduce((sum, j) => sum + j.chargedMc, 0);
  const reuseResult = (_toolId: string, _field: string, url: string, label?: string) => {
    const job = data?.jobs.find((j) => j.outputUrls.includes(url));
    attach(url, (job?.outputType as Attachment["kind"]) ?? "video", job ? findTool(job.toolId)?.name ?? "result" : "result");
    if (label) setText(`${label} for this.`);
  };

  // ---------------------------------------------------------------- render
  const sidebar = (
    <aside className={`dir-side ${panel === "chats" ? "open" : ""}`}>
      <div className="dir-side-head">
        <b>AI Director</b>
        <span className="tier-pill premium">Opus 5.5</span>
      </div>
      <button type="button" className="dir-new" onClick={() => openChat(null)}><Icon d={ICONS.plus} /> New chat</button>
      <p className="dir-side-label">Chats</p>
      <nav className="dir-chats">
        {chats.length === 0 && <p className="muted small-text">Your chats appear here.</p>}
        {chats.map((c) => (
          <div key={c.id} className={`dir-chat-row ${c.id === activeId ? "on" : ""}`}>
            <button type="button" onClick={() => openChat(c.id)} title={c.title}>{c.title}</button>
            <button type="button" className="dir-chat-del" onClick={() => deleteChat(c.id)} aria-label={`Delete ${c.title}`}><Icon d={ICONS.trash} size={15} /></button>
          </div>
        ))}
      </nav>
      <div className="dir-side-foot">
        <Link href="/create">Create tools</Link>
        <Link href="/guide">Guide</Link>
      </div>
    </aside>
  );

  const mediaPanel = (
    <aside className={`dir-media ${panel === "media" ? "open" : ""}`}>
      <div className="dir-media-tabs">
        <button type="button" className={mediaTab === "outputs" ? "on" : ""} onClick={() => setMediaTab("outputs")}>Outputs <span>{outputs.length}</span></button>
        <button type="button" className={mediaTab === "attachments" ? "on" : ""} onClick={() => setMediaTab("attachments")}>Attachments <span>{attachments.length}</span></button>
        <button type="button" className="dir-media-close" onClick={() => setPanel("none")} aria-label="Close"><Icon d={ICONS.x} /></button>
      </div>
      <div className="dir-media-grid">
        {(mediaTab === "outputs" ? outputs : attachments).map((m, i) => (
          <button key={`${m.url}-${i}`} type="button" className="dir-media-item" onClick={() => setPreview({ url: m.url, kind: m.kind })}>
            <Thumb url={m.url} kind={m.kind} />
            <span className="dir-media-kind">{m.kind}</span>
          </button>
        ))}
        {(mediaTab === "outputs" ? outputs : attachments).length === 0 && (
          <p className="muted small-text">{mediaTab === "outputs" ? "Finished generations from this chat appear here." : "Files you send in this chat appear here."}</p>
        )}
      </div>
    </aside>
  );

  return (
    <div className="dir">
      {sidebar}
      <section className="dir-main">
        <header className="dir-head">
          <button type="button" className="dir-icon-btn mobile-only" onClick={() => setPanel(panel === "chats" ? "none" : "chats")} aria-label="Chats"><Icon d={ICONS.menu} /></button>
          <h1>{data?.chat.title ?? "New chat"}</h1>
          {spentMc > 0 && <span className="dir-spent" title="Assistant usage plus generations in this chat">This chat {formatUsd(spentMc)}</span>}
          <button type="button" className="dir-icon-btn" onClick={() => setPanel(panel === "media" ? "none" : "media")} aria-label="Media">
            <Icon d={ICONS.media} />
            {outputs.length > 0 && <span className="dir-badge">{outputs.length}</span>}
          </button>
        </header>

        <div className="dir-scroll" ref={scrollRef}>
          {loading && <div className="dir-loading"><span className="spinner" /></div>}
          {!loading && !data?.timeline.length && !streaming && (
            <div className="dir-empty">
              <span className="dir-empty-mark"><Icon d={ICONS.bolt} size={28} /></span>
              <h2>What should we create today?</h2>
              <p className="muted">
                Tell the Director your idea. It picks the right AI tools, asks for the photos or videos it needs,
                shows you the price, makes it, and checks the result for you.
              </p>
              <div className="dir-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s.title} type="button" onClick={() => submit(s.text)}>
                    <b>{s.title}</b>
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="dir-thread">
            {data?.timeline.map((item) => {
              if (item.kind === "user") {
                return (
                  <div key={item.id} className="dir-user">
                    {item.attachments.length > 0 && (
                      <div className="dir-user-files">
                        {item.attachments.map((a) => (
                          <button key={a.url} type="button" className="dir-file" onClick={() => setPreview({ url: a.url, kind: a.kind })} title={a.name}>
                            <Thumb url={a.url} kind={a.kind} />
                          </button>
                        ))}
                      </div>
                    )}
                    {item.text && <div className="dir-bubble">{item.text}</div>}
                  </div>
                );
              }
              if (item.kind === "update") {
                return <div key={item.id} className="dir-update"><Icon d={ICONS.check} size={14} /> {item.text.includes("failed") ? "A generation failed and was refunded" : "Generation finished, the Director is reviewing it"}</div>;
              }
              return (
                <div key={item.id} className="dir-reply">
                  <WorkLog parts={item.parts} />
                  {item.parts.map((p, i) =>
                    p.type === "text" ? (
                      <Markdown key={i} text={p.text} />
                    ) : p.type === "job" && jobsById.get(p.jobId) ? (
                      <div key={i} className="dir-job"><JobCard job={jobsById.get(p.jobId)!} onUse={(toolId, field, url) => reuseResult(toolId, field, url, NEXT_STEPS[(jobsById.get(p.jobId)!.outputType) as "video"]?.find((s) => s.toolId === toolId)?.label)} /></div>
                    ) : null,
                  )}
                </div>
              );
            })}

            {live && (
              <div className="dir-reply">
                <WorkLog parts={live.steps.map((label) => ({ type: "step" as const, label }))} live={live} />
                {live.text && <Markdown text={live.text} />}
              </div>
            )}

            {!streaming && data && data.approvals.length > 0 && (
              <div className="dir-approvals">
                {data.approvals.map((a) => {
                  const tool = findTool(a.toolId);
                  const media = Object.values(a.values).flatMap((v) => (Array.isArray(v) ? v : []));
                  const settings = ["duration", "resolution", "aspect_ratio", "num_images", "voice"]
                    .filter((k) => a.values[k] !== undefined && a.values[k] !== "")
                    .map((k) => (k === "duration" ? `${a.values[k]} s` : k === "num_images" ? `${a.values[k]} images` : String(a.values[k])));
                  return (
                    <div key={a.toolUseId} className="dir-approval">
                      <div className="dir-approval-head">
                        <span className="muted">Ready to generate</span>
                        {tool && <span className={`tier-pill ${tool.tier}`}>{TIERS[tool.tier].label}</span>}
                      </div>
                      <b>{a.title}</b>
                      <span className="muted">{tool?.name} · {tool?.model}{settings.length ? ` · ${settings.join(" · ")}` : ""}</span>
                      {media.length > 0 && (
                        <div className="dir-approval-media">{media.slice(0, 6).map((url) => <span key={url} className="dir-file small"><Thumb url={url} kind={/\.(mp4|mov|webm)/i.test(url) ? "video" : /\.(mp3|wav|m4a)/i.test(url) ? "audio" : "image"} /></span>)}</div>
                      )}
                      {typeof a.values.prompt === "string" && a.values.prompt && <p className="dir-approval-prompt">{a.values.prompt}</p>}
                      <div className="dir-approval-actions">
                        <button type="button" className="btn primary" onClick={() => decide({ [a.toolUseId]: true })} disabled={data.approvals.length > 1}>
                          Approve · {formatUsd(a.priceMc)}
                        </button>
                        <button type="button" className="btn" onClick={() => decide({ [a.toolUseId]: false })} disabled={data.approvals.length > 1}>Decline</button>
                      </div>
                    </div>
                  );
                })}
                {data.approvals.length > 1 && (
                  <div className="dir-approval-all">
                    <button type="button" className="btn primary" onClick={() => decide(Object.fromEntries(data.approvals.map((a) => [a.toolUseId, true])))}>
                      Approve all · {formatUsd(data.approvals.reduce((s, a) => s + a.priceMc, 0))}
                    </button>
                    <button type="button" className="btn" onClick={() => decide(Object.fromEntries(data.approvals.map((a) => [a.toolUseId, false])))}>Decline all</button>
                  </div>
                )}
                <p className="hint">You only pay if you approve. Failed generations are refunded automatically.</p>
              </div>
            )}

            {notice && (
              <div className={`dir-notice ${notice.error ? "error" : ""}`} role="status">
                {notice.text} {notice.error && /credit|Top up/i.test(notice.text) && <Link href="/billing">Top up</Link>}
              </div>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------------- composer */}
        <div className="dir-composer-wrap">
          <div className={`dir-composer ${listening ? "listening" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            {drafts.length > 0 && (
              <div className="dir-drafts">
                {drafts.map((d) => (
                  <span key={d.url} className={`dir-file ${d.uploading ? "uploading" : ""}`} title={d.name}>
                    <Thumb url={d.preview ?? d.url} kind={d.kind} />
                    {d.uploading && <span className="spinner small" />}
                    {!d.uploading && <button type="button" className="pg-remove" onClick={() => setDrafts((all) => all.filter((x) => x.url !== d.url))} aria-label="Remove">×</button>}
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={textRef}
              rows={2}
              value={text}
              placeholder={data?.timeline.length ? "Reply to the Director…" : "Describe what you want to make…"}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="dir-tools">
              <button type="button" className="dir-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach photos, videos or audio" title="Attach photos, videos or audio"><Icon d={ICONS.plus} /></button>
              <button type="button" className={`dir-chip ${askApproval ? "on" : ""}`} onClick={() => saveSetting({ askApproval: !askApproval })} title={askApproval ? "You approve each generation before it runs" : `Generations up to $3 run without asking`}>
                <Icon d={ICONS.hand} size={16} /> {askApproval ? "Ask for approval" : "Auto-run"}
              </button>
              <span className="dir-spacer" />
              <div className="dir-effort">
                <button type="button" className="dir-chip" onClick={() => setEffortOpen(!effortOpen)} aria-expanded={effortOpen}>
                  <Icon d={ICONS.bolt} size={15} /> <span className="dir-model">Opus 5.5</span> <span className="muted">{EFFORT_INFO[effort].label}</span>
                </button>
                {effortOpen && (
                  <div className="dir-effort-pop" role="dialog" aria-label="Effort">
                    <b>{EFFORT_INFO[effort].label}</b>
                    <span className="muted">Claude Opus 5.5</span>
                    <div className="dir-effort-track">
                      {(Object.keys(EFFORT_INFO) as Effort[]).map((e) => (
                        <button key={e} type="button" className={e === effort ? "on" : ""} onClick={() => saveSetting({ effort: e })} aria-label={EFFORT_INFO[e].label} />
                      ))}
                    </div>
                    <div className="dir-effort-ends"><span>Faster</span><span>Smarter</span></div>
                    <p className="hint">{EFFORT_INFO[effort].hint}</p>
                  </div>
                )}
              </div>
              <button type="button" className={`dir-icon-btn ${listening ? "rec" : ""}`} onClick={toggleMic} aria-label={listening ? "Stop listening" : "Speak"} title="Speak instead of typing"><Icon d={ICONS.mic} /></button>
              {streaming ? (
                <button type="button" className="dir-send" onClick={() => abortRef.current?.abort()} aria-label="Stop"><Icon d={ICONS.stop} /></button>
              ) : (
                <button type="button" className="dir-send" onClick={() => submit()} disabled={(!text.trim() && !drafts.length) || drafts.some((d) => d.uploading)} aria-label="Send"><Icon d={ICONS.send} /></button>
              )}
            </div>
          </div>
          <p className="dir-foot">Balance {formatUsd(balanceMc)} · The Director usually costs 5–30¢ per message; generations show their price first.</p>
          <input ref={fileRef} type="file" hidden multiple accept="image/*,video/*,audio/*" onChange={(e) => addFiles(e.target.files)} />
        </div>
      </section>
      {mediaPanel}

      {preview && (
        <div className="dir-lightbox" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
          <div className="dir-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            {preview.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt="" />
            )}
            {preview.kind === "video" && <video src={preview.url} controls autoPlay playsInline />}
            {preview.kind === "audio" && <audio src={preview.url} controls autoPlay />}
            <div className="dir-lightbox-actions">
              <button type="button" className="btn primary" onClick={() => attach(preview.url, preview.kind, "from this chat")}>Use in message</button>
              <a className="btn" href={preview.url} target="_blank" rel="noreferrer">Download</a>
              <button type="button" className="btn" onClick={() => setPreview(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
