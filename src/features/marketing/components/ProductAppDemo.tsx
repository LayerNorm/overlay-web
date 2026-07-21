"use client";

import {
  Check,
  FileText,
  FolderOpen,
  MessageSquare,
  Puzzle,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  MARKETING_LOGO_SIZE,
  marketingDemoFrame,
  marketingSerifStyle,
} from "@/features/marketing/lib/marketingLayout";

export type DemoSurface =
  | "chat"
  | "files"
  | "extensions"
  | "projects"
  | "automations";

const SURFACES: Array<{
  key: DemoSurface;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "chat", label: "Chat", icon: MessageSquare },
  { key: "files", label: "Files", icon: FileText },
  { key: "extensions", label: "Extensions", icon: Puzzle },
  { key: "projects", label: "Projects", icon: FolderOpen },
  { key: "automations", label: "Automations", icon: Workflow },
];

const SURFACE_ORDER = SURFACES.map((s) => s.key);

/** Step clocks are ms from surface activation. */
type PlayClock = number;

function subscribeReducedMotion(onStoreChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
}

/**
 * Animation clock driven by rAF. Resets when `activeKey` changes.
 * Reduced-motion users jump to the end state.
 */
function usePlayClock(activeKey: string, durationMs: number, reduced: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const [trackedKey, setTrackedKey] = useState(activeKey);

  if (trackedKey !== activeKey) {
    setTrackedKey(activeKey);
    setElapsed(0);
  }

  useEffect(() => {
    if (reduced) {
      const id = requestAnimationFrame(() => setElapsed(durationMs));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    let origin = 0;
    const tick = (now: number) => {
      if (!origin) origin = now;
      const next = Math.min(durationMs, now - origin);
      setElapsed(next);
      if (next < durationMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeKey, durationMs, reduced]);

  return reduced ? durationMs : elapsed;
}

function at(t: PlayClock, threshold: PlayClock) {
  return t >= threshold;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ─── Surface plays ───────────────────────────────────────────────────────── */

function ChatPlay({ t }: { t: PlayClock }) {
  const showUser = at(t, 400);
  const userLen = Math.min(
    42,
    Math.floor(Math.max(0, t - 400) / 28),
  );
  const userText =
    "Summarize Q1 and draft a board update".slice(0, userLen);
  const showTools = at(t, 2200);
  const showReply = at(t, 3000);
  const replyLen = Math.min(
    180,
    Math.floor(Math.max(0, t - 3000) / 12),
  );
  const fullReply =
    "Revenue grew 18% QoQ. Three risks need board attention: enterprise churn, hiring lag in infra, and the Europe launch slip. Draft memo attached with recommended asks.";
  const reply = fullReply.slice(0, replyLen);
  const showDone = at(t, 6200);

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex h-12 items-center justify-between border-b border-[var(--border)] px-4">
        <span className="text-xs font-medium">New conversation</span>
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[11px]">
          GPT-5.4
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-5">
        {showUser ? (
          <div className="ml-auto max-w-[85%] rounded-2xl bg-[var(--foreground)] px-4 py-2.5 text-sm text-[var(--background)]">
            {userText}
            {userLen < 42 ? (
              <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-[var(--background)]" />
            ) : null}
          </div>
        ) : null}
        {showTools ? (
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1">
              2 tools called
            </span>
            <span className="text-[var(--muted-light)]">Files · Memory</span>
          </div>
        ) : null}
        {showReply ? (
          <div className="max-w-[92%] space-y-2">
            <p className="text-sm leading-6 text-[var(--foreground)]">
              {reply}
              {replyLen < fullReply.length ? (
                <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-[var(--foreground)]" />
              ) : null}
            </p>
            {showDone ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] text-[var(--muted)]">
                  Board_update_Q1.md
                </span>
                <span className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] text-[var(--muted)]">
                  Sources: 4
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="border-t border-[var(--border)] p-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 text-sm text-[var(--muted-light)]">
          Ask anything, use @ to reference files, memory, tools…
        </div>
      </div>
    </div>
  );
}

function FilesPlay({ t }: { t: PlayClock }) {
  const files = [
    { name: "Curriculum.pdf", kind: "PDF", delay: 300 },
    { name: "Q1 plan.docx", kind: "Doc", delay: 700 },
    { name: "Financials.xlsx", kind: "Sheet", delay: 1100 },
    { name: "Launch notes", kind: "Note", delay: 1500 },
  ];
  const selected = at(t, 2000);
  const preview = at(t, 2600);
  const mention = at(t, 3400);

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex h-12 items-center border-b border-[var(--border)] px-4">
        <span className="text-xs font-medium">Files</span>
      </div>
      <div className="grid flex-1 md:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-1.5 border-b border-[var(--border)] p-4 md:border-b-0 md:border-r">
          <p className="mb-3 text-[11px] uppercase tracking-[0.14em] text-[var(--muted-light)]">
            Library
          </p>
          {files.map((file) => {
            const visible = at(t, file.delay);
            if (!visible) return null;
            const isActive = selected && file.name === "Q1 plan.docx";
            return (
              <div
                key={file.name}
                className={cx(
                  "flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "border-[var(--foreground)] bg-[var(--surface-subtle)]"
                    : "border-[var(--border)] bg-[var(--surface-elevated)]",
                )}
              >
                <span className="truncate">{file.name}</span>
                <span className="text-[10px] text-[var(--muted-light)]">
                  {file.kind}
                </span>
              </div>
            );
          })}
        </div>
        <div className="bg-[var(--sidebar-surface)] p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted-light)]">
            Preview
          </p>
          {preview ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-medium" style={marketingSerifStyle()}>
                Q1 plan.docx
              </p>
              <div className="space-y-1.5">
                {["Goals", "Risks", "Hiring", "Board asks"].map((line, i) =>
                  at(t, 2800 + i * 200) ? (
                    <div
                      key={line}
                      className="h-2 rounded-full bg-[var(--border)]"
                      style={{ width: `${70 - i * 10}%` }}
                    />
                  ) : null,
                )}
              </div>
              {mention ? (
                <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px]">
                  <span className="text-[var(--muted)]">@</span>
                  <span>Q1 plan.docx</span>
                  <span className="text-[var(--muted-light)]">in chat</span>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-6 text-xs text-[var(--muted-light)]">
              Select a file…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ExtensionsPlay({ t }: { t: PlayClock }) {
  const items = [
    { name: "Drive", status: "Connected", delay: 400 },
    { name: "Notion", status: "Connected", delay: 800 },
    { name: "Slack", status: "Connecting…", delay: 1200, final: "Connected" },
    { name: "GitHub", status: "Available", delay: 1600 },
    { name: "Calendar", status: "Available", delay: 2000 },
    { name: "Private MCP", status: "Available", delay: 2400 },
  ];
  const slackDone = at(t, 3200);

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex h-12 items-center justify-between border-b border-[var(--border)] px-4">
        <span className="text-xs font-medium">Extensions</span>
        <span className="text-[11px] text-[var(--muted)]">Connect tools</span>
      </div>
      <div className="grid flex-1 gap-2 p-4 sm:grid-cols-2">
        {items.map((item) => {
          if (!at(t, item.delay)) return null;
          const status =
            item.name === "Slack" && slackDone
              ? (item.final ?? item.status)
              : item.status;
          const connected = status === "Connected";
          return (
            <div
              key={item.name}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-3"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] text-xs font-medium">
                  {item.name.slice(0, 1)}
                </span>
                <span className="text-sm">{item.name}</span>
              </div>
              <span
                className={cx(
                  "text-[11px]",
                  connected
                    ? "text-[var(--foreground)]"
                    : "text-[var(--muted-light)]",
                )}
              >
                {connected ? (
                  <span className="inline-flex items-center gap-1">
                    <Check className="h-3 w-3" strokeWidth={2} />
                    Connected
                  </span>
                ) : (
                  status
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectsPlay({ t }: { t: PlayClock }) {
  const showHeader = at(t, 300);
  const chats = at(t, 900);
  const files = at(t, 1600);
  const cta = at(t, 2400);

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex h-12 items-center border-b border-[var(--border)] px-4">
        <span className="text-xs font-medium">Projects</span>
      </div>
      <div className="flex-1 p-5">
        {showHeader ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted-light)]">
              Active project
            </p>
            <h3
              className="mt-2 text-2xl tracking-tight"
              style={marketingSerifStyle()}
            >
              Board readiness
            </h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Chats, files, and automations scoped to one workspace.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {chats ? (
                <div>
                  <p className="text-[11px] font-medium text-[var(--muted-light)]">
                    Chats
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {["Q1 narrative", "Risk memo", "Hiring plan"].map(
                      (item, i) =>
                        at(t, 1000 + i * 250) ? (
                          <li
                            key={item}
                            className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1.5"
                          >
                            {item}
                          </li>
                        ) : null,
                    )}
                  </ul>
                </div>
              ) : null}
              {files ? (
                <div>
                  <p className="text-[11px] font-medium text-[var(--muted-light)]">
                    Files
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {["Metrics.xlsx", "Deck v3.pdf"].map((item, i) =>
                      at(t, 1700 + i * 250) ? (
                        <li
                          key={item}
                          className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1.5"
                        >
                          {item}
                        </li>
                      ) : null,
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
            {cta ? (
              <div className="mt-5 inline-flex rounded-lg bg-[var(--foreground)] px-3 py-2 text-xs font-medium text-[var(--background)]">
                Open workspace
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AutomationsPlay({ t }: { t: PlayClock }) {
  const steps = [
    { label: "Trigger · New file in Drive", delay: 400 },
    { label: "Extract knowledge", delay: 1200 },
    { label: "Draft summary in Chat", delay: 2000 },
    { label: "Request human approval", delay: 2800 },
    { label: "Notify Slack channel", delay: 3600 },
  ];
  const done = at(t, 4400);

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="flex h-12 items-center justify-between border-b border-[var(--border)] px-4">
        <span className="text-xs font-medium">Automations</span>
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10px]">
          Governed
        </span>
      </div>
      <div className="flex-1 p-5">
        <p className="text-sm font-medium" style={marketingSerifStyle()}>
          Weekly knowledge digest
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Runs on a schedule. Consequential steps wait for approval.
        </p>
        <ol className="mt-6 space-y-2">
          {steps.map((step, i) => {
            if (!at(t, step.delay)) return null;
            const isApproval = i === 3;
            const complete = at(t, step.delay + 600);
            return (
              <li
                key={step.label}
                className={cx(
                  "flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm",
                  isApproval && !done
                    ? "border-[var(--foreground)] bg-[var(--surface-subtle)]"
                    : "border-[var(--border)] bg-[var(--surface-elevated)]",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[var(--muted-light)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {step.label}
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {isApproval && !done
                    ? "Needs approval"
                    : complete
                      ? "Done"
                      : "Running…"}
                </span>
              </li>
            );
          })}
        </ol>
        {done ? (
          <p className="mt-4 text-xs text-[var(--muted)]">
            Digest ready. Waiting on approval before notify.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SurfaceStage({ surface, t }: { surface: DemoSurface; t: PlayClock }) {
  switch (surface) {
    case "files":
      return <FilesPlay t={t} />;
    case "extensions":
      return <ExtensionsPlay t={t} />;
    case "projects":
      return <ProjectsPlay t={t} />;
    case "automations":
      return <AutomationsPlay t={t} />;
    case "chat":
    default:
      return <ChatPlay t={t} />;
  }
}

const PLAY_DURATION: Record<DemoSurface, number> = {
  chat: 7500,
  files: 4500,
  extensions: 4500,
  projects: 4000,
  automations: 5500,
};

const AUTO_ADVANCE_GAP = 1800;

/**
 * One large product window. Sidebar switches surfaces; each surface runs a
 * short play script. Auto-advances when idle; pauses on hover/focus.
 */
export function ProductAppDemo() {
  const reduced = usePrefersReducedMotion();
  const [surface, setSurface] = useState<DemoSurface>("chat");
  const [paused, setPaused] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const duration = PLAY_DURATION[surface];
  const t = usePlayClock(`${surface}-${playKey}`, duration, reduced);

  const selectSurface = useCallback((next: DemoSurface) => {
    setSurface(next);
    setPlayKey((k) => k + 1);
  }, []);

  // Auto-advance when a play finishes (unless reduced motion / paused).
  useEffect(() => {
    if (reduced || paused) return;
    if (t < duration) return;
    const timer = window.setTimeout(() => {
      const idx = SURFACE_ORDER.indexOf(surface);
      const next = SURFACE_ORDER[(idx + 1) % SURFACE_ORDER.length]!;
      selectSurface(next);
    }, AUTO_ADVANCE_GAP);
    return () => window.clearTimeout(timer);
  }, [t, duration, surface, paused, reduced, selectSurface]);

  return (
    <div
      className={marketingDemoFrame()}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      {/* Window chrome */}
      <div className="flex h-10 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-elevated)] px-4">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#e5c9b0]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#d4c4a8]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#b8b2a7]" />
        </span>
        <span className="mx-auto text-[11px] text-[var(--muted-light)]">
          overlay — {SURFACES.find((s) => s.key === surface)?.label}
        </span>
      </div>

      <div className="grid md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[var(--border)] bg-[var(--sidebar-surface)] p-2 md:block">
          <div className="flex items-center gap-2 px-2 py-2">
            <Image
              src="/assets/overlay-logo.png"
              alt=""
              width={MARKETING_LOGO_SIZE}
              height={MARKETING_LOGO_SIZE}
              className="shrink-0"
            />
            <span
              className="text-sm font-medium tracking-tight"
              style={marketingSerifStyle()}
            >
              overlay
            </span>
          </div>
          <nav
            className="mt-3 space-y-0.5"
            aria-label="Product surfaces"
          >
            {SURFACES.map((item) => {
              const active = item.key === surface;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => selectSurface(item.key)}
                  className={cx(
                    "flex h-9 w-full items-center rounded-md px-3 text-left text-sm transition-colors",
                    active
                      ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                      : "text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]",
                  )}
                >
                  <item.icon
                    className="h-[15px] w-[15px] shrink-0"
                    strokeWidth={1.75}
                  />
                  <span className="ml-2.5">{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="mt-6 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] p-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted-light)]">
              Playing
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {SURFACES.find((s) => s.key === surface)?.label} session
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
              <div
                className="h-full rounded-full bg-[var(--foreground)] transition-[width] duration-100 ease-linear"
                style={{
                  width: `${Math.min(100, (t / duration) * 100)}%`,
                }}
              />
            </div>
          </div>
        </aside>

        {/* Mobile surface switcher */}
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] p-2 md:hidden">
          {SURFACES.map((item) => {
            const active = item.key === surface;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => selectSurface(item.key)}
                className={cx(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs",
                  active
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "bg-[var(--surface-muted)] text-[var(--muted)]",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="min-w-0 bg-[var(--background)]">
          <SurfaceStage surface={surface} t={t} />
        </div>
      </div>
    </div>
  );
}

/** Static mini-scenes for feature cards (no animation). */
export function MiniSceneModels() {
  return (
    <div className="space-y-1.5">
      {["Auto", "GPT-5.4", "Private model"].map((name, i) => (
        <div
          key={name}
          className={cx(
            "flex items-center justify-between rounded-md border border-[var(--border)] px-2 py-1.5 text-[11px]",
            i === 0
              ? "bg-[var(--surface-elevated)]"
              : "bg-[var(--background)]/60",
          )}
        >
          <span>{name}</span>
          <span className="text-[var(--muted-light)]">
            {i === 2 ? "Private" : "Hosted"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MiniSceneKnowledge() {
  return (
    <div className="space-y-1.5">
      {["Curriculum.pdf", "Team memory", "Notion wiki"].map((item) => (
        <div
          key={item}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-[11px]"
        >
          {item}
        </div>
      ))}
    </div>
  );
}

export function MiniSceneAgents() {
  return (
    <div className="space-y-1.5">
      {[
        { l: "Web research", s: "Allowed" },
        { l: "Send email", s: "Approve" },
        { l: "CRM write", s: "Blocked" },
      ].map((row) => (
        <div
          key={row.l}
          className="flex justify-between rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-[11px]"
        >
          <span>{row.l}</span>
          <span className="text-[var(--muted-light)]">{row.s}</span>
        </div>
      ))}
    </div>
  );
}

export function MiniSceneWorkflows() {
  return (
    <div className="flex items-center gap-2 pt-4">
      {["01", "02", "03"].map((n, i) => (
        <div key={n} className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] font-mono text-[11px]">
            {n}
          </span>
          {i < 2 ? (
            <span className="h-px w-4 bg-[var(--border)]" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function MiniSceneInfra() {
  return (
    <div className="flex flex-wrap gap-1.5 pt-2">
      {["Hosted", "Private cloud", "On-prem"].map((label, i) => (
        <span
          key={label}
          className={cx(
            "rounded-full border px-2.5 py-1 text-[11px]",
            i === 1
              ? "border-[var(--foreground)] bg-[var(--surface-elevated)]"
              : "border-[var(--border)] bg-[var(--background)]/50 text-[var(--muted)]",
          )}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export function MiniSceneData() {
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-4 text-center">
        <p className="text-xs font-medium">You define retention</p>
        <p className="mt-1 text-[10px] text-[var(--muted)]">
          Storage · providers · access
        </p>
      </div>
    </div>
  );
}

export function FeatureMiniScene({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-[140px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      {children}
    </div>
  );
}
