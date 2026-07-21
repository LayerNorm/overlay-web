"use client";

import {
  ArrowUp,
  AtSign,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  FileText,
  FolderOpen,
  Globe2,
  Image as ImageIcon,
  LayoutGrid,
  LayoutList,
  Loader2,
  MessageSquare,
  Paperclip,
  PenLine,
  Plus,
  Puzzle,
  Search,
  Upload,
  Workflow,
  Zap,
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
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => false,
  );
}

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

/* ─── Shared app primitives ──────────────────────────────────────────────── */

/** App header bar — matches AppScreenShell header (min-h-14, px-3 py-2.5). */
function AppHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-2 border-b border-[var(--border)] px-3 py-2.5 sm:px-4 md:min-h-16 md:py-0">
      {children}
    </div>
  );
}

/** Model picker pill — matches ChatExperienceHeader (h-8 rounded-md surface-subtle). */
function ModelPill({ model = "Auto" }: { model?: string }) {
  return (
    <button
      type="button"
      className="flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] px-2.5 text-left text-xs leading-none text-[var(--muted)] hover:bg-[var(--border)] md:max-w-[13rem]"
    >
      <span className="truncate">{model}</span>
      <ChevronDown
        className="h-[11px] w-[11px] shrink-0 opacity-60"
        strokeWidth={1.75}
      />
    </button>
  );
}

/** Composer card — matches ChatComposer (rounded-2xl border surface-elevated). */
function ComposerShell({
  children,
  active = false,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <div className="overflow-visible rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="p-2.5 sm:p-3">
        {children}
        <div className="mt-2.5 flex items-center gap-1">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-muted)]">
            <Paperclip className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-muted)]">
            <AtSign className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-muted)]">
            <Brain className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="flex-1" />
          <span
            className={cx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
              active
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "bg-[var(--surface-subtle)] text-[var(--muted-light)]",
            )}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2} />
          </span>
        </div>
      </div>
    </div>
  );
}

/** Section label — matches integrations section headers (text-[11px] uppercase tracking). */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-light)]">
      {children}
    </p>
  );
}

/* ─── Chat play ──────────────────────────────────────────────────────────── */

const CHAT_SUGGESTIONS = [
  { icon: ImageIcon, label: "Create an image" },
  { icon: PenLine, label: "Write or edit" },
  { icon: Globe2, label: "Look something up" },
];

const CHAT_USER_PROMPT = "Summarize Q1 performance and draft a board update";
const CHAT_REPLY =
  "Revenue grew 18% QoQ. Three risks need board attention: enterprise churn, hiring lag in infra, and the Europe launch slip. Draft memo attached with recommended asks.";

function ChatPlay({ t }: { t: PlayClock }) {
  const showGreeting = at(t, 0);
  const showSuggestions = at(t, 200);
  const selectedPill = at(t, 1200);
  const typedLen = Math.min(
    CHAT_USER_PROMPT.length,
    Math.floor(Math.max(0, t - 1600) / 22),
  );
  const typed = CHAT_USER_PROMPT.slice(0, typedLen);
  const showUserMsg = at(t, 3400);
  const showTools = at(t, 4200);
  const showReply = at(t, 5000);
  const replyLen = Math.min(
    CHAT_REPLY.length,
    Math.floor(Math.max(0, t - 5000) / 14),
  );
  const reply = CHAT_REPLY.slice(0, replyLen);
  const showSources = at(t, 8200);

  const isComposing = selectedPill && !showUserMsg;

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <AppHeader>
        <ModelPill model="Auto" />
        <span className="flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-[var(--surface-subtle)] text-[var(--muted)]">
          <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </AppHeader>

      <div className="flex flex-1 flex-col overflow-hidden">
        {showUserMsg ? (
          <div className="flex flex-1 flex-col gap-4 overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
            <div className="mx-auto w-full max-w-4xl">
              <div className="ml-auto max-w-[85%] rounded-2xl bg-[var(--foreground)] px-4 py-2.5 text-sm text-[var(--background)]">
                {CHAT_USER_PROMPT}
              </div>
            </div>
            {showTools ? (
              <div className="mx-auto w-full max-w-4xl">
                <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <span className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1">
                    2 tools called
                  </span>
                  <span className="text-[var(--muted-light)]">
                    Files · Memory
                  </span>
                </div>
              </div>
            ) : null}
            {showReply ? (
              <div className="mx-auto w-full max-w-4xl">
                <div className="max-w-[92%] space-y-2">
                  <p className="text-sm leading-6 text-[var(--foreground)]">
                    {reply}
                    {replyLen < CHAT_REPLY.length ? (
                      <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-[var(--foreground)]" />
                    ) : null}
                  </p>
                  {showSources ? (
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
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
            {showGreeting ? (
              <p
                className="text-3xl text-[var(--foreground)]"
                style={marketingSerifStyle()}
              >
                Good morning
              </p>
            ) : null}
            {showSuggestions ? (
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {CHAT_SUGGESTIONS.map((s, i) => {
                  const visible = at(t, 400 + i * 200);
                  const isSelected = selectedPill && i === 1;
                  if (!visible) return null;
                  return (
                    <span
                      key={s.label}
                      className={cx(
                        "inline-flex h-9 shrink-0 items-center gap-2 rounded-2xl border px-3.5 text-sm transition-colors",
                        isSelected
                          ? "border-[var(--foreground)] bg-[var(--surface-muted)] text-[var(--foreground)]"
                          : "border-[var(--border)] bg-transparent text-[var(--foreground)]",
                      )}
                    >
                      <s.icon
                        className="h-[15px] w-[15px] shrink-0"
                        strokeWidth={1.75}
                      />
                      {s.label}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="mx-auto max-w-[56rem]">
          <ComposerShell active={showUserMsg}>
            {isComposing || showUserMsg ? (
              <p className="min-h-[1.5rem] px-1.5 py-1.5 text-sm text-[var(--foreground)]">
                {typed}
                {typedLen < CHAT_USER_PROMPT.length && typedLen > 0 ? (
                  <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-[var(--foreground)]" />
                ) : null}
              </p>
            ) : (
              <p className="min-h-[1.5rem] px-1.5 py-1.5 text-sm text-[var(--muted-light)]">
                Ask anything, use @ to reference files, memory, tools…
              </p>
            )}
          </ComposerShell>
        </div>
      </div>
    </div>
  );
}

/* ─── Files play ─────────────────────────────────────────────────────────── */

const FILES_LIST = [
  {
    name: "Q1 plan.docx",
    kind: "Doc",
    icon: FileText,
    delay: 200,
    selected: true,
  },
  { name: "Curriculum.pdf", kind: "PDF", icon: FileText, delay: 500 },
  { name: "Financials.xlsx", kind: "Sheet", icon: FileText, delay: 800 },
  { name: "Launch notes", kind: "Note", icon: BookOpen, delay: 1100 },
  { name: "Team memory", kind: "Memory", icon: Brain, delay: 1400 },
];

function FilesPlay({ t }: { t: PlayClock }) {
  const showPreview = at(t, 1800);
  const showMention = at(t, 3000);
  const visibleCount = FILES_LIST.filter((f) => at(t, f.delay)).length;

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <AppHeader>
        <span className="text-sm font-medium text-[var(--foreground)]">
          Files
        </span>
        <span className="text-xs text-[var(--muted-light)]">
          {visibleCount} items
        </span>
        <span className="flex-1" />
        <span className="flex h-8 min-h-8 items-center rounded-md border border-[var(--border)]">
          <span className="flex h-8 w-8 items-center justify-center rounded-l-md bg-[var(--surface-subtle)] text-[var(--foreground)]">
            <LayoutList className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-r-md text-[var(--muted)] hover:text-[var(--foreground)]">
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
        </span>
      </AppHeader>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden border-r border-[var(--border)] p-3 sm:p-4">
          <div className="mx-auto max-w-3xl space-y-1">
            {FILES_LIST.map((file) => {
              if (!at(t, file.delay)) return null;
              const isSelected = file.selected && showPreview;
              return (
                <div
                  key={file.name}
                  className={cx(
                    "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                    isSelected
                      ? "border-[var(--border)] bg-[var(--surface-muted)]"
                      : "border-transparent hover:bg-[var(--surface-muted)]",
                  )}
                >
                  <file.icon
                    className="mt-0.5 h-[15px] w-[15px] shrink-0 text-[var(--muted-light)]"
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0 flex-1 truncate leading-relaxed text-[var(--foreground)]">
                    {file.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--muted-light)]">
                    {file.kind}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="hidden w-[280px] shrink-0 overflow-hidden bg-[var(--sidebar-surface)] p-4 md:block">
          <SectionLabel>Preview</SectionLabel>
          {showPreview ? (
            <div className="mt-3 space-y-3">
              <p
                className="text-sm font-medium text-[var(--foreground)]"
                style={marketingSerifStyle()}
              >
                Q1 plan.docx
              </p>
              <div className="space-y-2">
                {[100, 92, 96, 70].map((w, i) => (
                  <div
                    key={i}
                    className="h-2 rounded-full bg-[var(--surface-subtle)]"
                    style={{ width: `${w}%` }}
                  />
                ))}
              </div>
              {showMention ? (
                <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px]">
                  <AtSign
                    className="h-3 w-3 text-[var(--muted)]"
                    strokeWidth={1.75}
                  />
                  <span className="text-[var(--foreground)]">Q1 plan.docx</span>
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

/* ─── Extensions play ────────────────────────────────────────────────────── */

const INTEGRATIONS = [
  { name: "Drive", status: "Connected", delay: 200, letter: "D" },
  { name: "Notion", status: "Connected", delay: 500, letter: "N" },
  {
    name: "Slack",
    status: "Connecting…",
    delay: 800,
    letter: "S",
    final: "Connected",
  },
  { name: "GitHub", status: "Available", delay: 1200, letter: "G" },
  { name: "Calendar", status: "Available", delay: 1500, letter: "C" },
  { name: "Private MCP", status: "Available", delay: 1800, letter: "M" },
];

function ExtensionsPlay({ t }: { t: PlayClock }) {
  const slackDone = at(t, 2600);
  const githubConnecting = at(t, 3400);

  const connected = INTEGRATIONS.filter(
    (i) =>
      at(t, i.delay) &&
      (i.status === "Connected" || (i.name === "Slack" && slackDone)),
  );
  const available = INTEGRATIONS.filter(
    (i) =>
      at(t, i.delay) &&
      i.status === "Available" &&
      !(i.name === "GitHub" && githubConnecting),
  );

  function IntegrationRow({ item }: { item: (typeof INTEGRATIONS)[number] }) {
    const status =
      item.name === "Slack" && slackDone
        ? (item.final ?? item.status)
        : item.name === "GitHub" && githubConnecting
          ? "Connecting…"
          : item.status;
    const isConnected = status === "Connected";
    const isConnecting = status === "Connecting…";

    return (
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="inline-flex flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-xs font-medium text-[var(--foreground)]"
            style={{ width: 28, height: 28 }}
          >
            {item.letter}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--foreground)]">
              {item.name}
            </p>
            <p className="truncate text-xs text-[var(--muted)]">
              {isConnected
                ? "Connected"
                : isConnecting
                  ? "Establishing connection…"
                  : "Available"}
            </p>
          </div>
        </div>
        <span
          className={cx(
            "shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs",
            isConnected
              ? "text-[var(--muted)]"
              : "text-[var(--foreground)] hover:bg-[var(--surface-muted)]",
          )}
        >
          {isConnected ? (
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3" strokeWidth={2} />
              Configure
            </span>
          ) : isConnecting ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
              Connecting
            </span>
          ) : (
            "Connect"
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <AppHeader>
        <span className="text-sm font-medium text-[var(--foreground)]">
          Integrations
        </span>
        <span className="flex-1" />
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-elevated)]">
          <Search
            className="h-3.5 w-3.5 text-[var(--muted)]"
            strokeWidth={1.75}
          />
        </span>
      </AppHeader>

      <div className="flex-1 overflow-hidden p-4">
        <div className="mx-auto max-w-2xl space-y-6">
          {connected.length > 0 ? (
            <div>
              <SectionLabel>Connected</SectionLabel>
              <div className="mt-3 space-y-2">
                {connected.map((item) => (
                  <IntegrationRow key={item.name} item={item} />
                ))}
              </div>
            </div>
          ) : null}
          {available.length > 0 ? (
            <div>
              <SectionLabel>Available</SectionLabel>
              <div className="mt-3 space-y-2">
                {available.map((item) => (
                  <IntegrationRow key={item.name} item={item} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ─── Projects play ──────────────────────────────────────────────────────── */

const PROJECT_CHATS = ["Q1 narrative", "Risk memo", "Hiring plan"];
const PROJECT_FILES = ["Metrics.xlsx", "Deck v3.pdf", "Board notes"];

function ProjectsPlay({ t }: { t: PlayClock }) {
  const showHeader = at(t, 200);
  const showFiles = at(t, 1600);
  const showInstructions = at(t, 2400);
  // Derive active tab from play clock — no state needed, no effect cascade.
  const activeTab: "chats" | "files" | "instructions" = showInstructions
    ? "instructions"
    : showFiles
      ? "files"
      : "chats";

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <AppHeader>
        {showHeader ? (
          <>
            <FolderOpen
              className="h-4 w-4 text-[var(--muted)]"
              strokeWidth={1.75}
            />
            <span
              className="text-sm font-medium text-[var(--foreground)]"
              style={marketingSerifStyle()}
            >
              Board readiness
            </span>
            <span className="flex-1" />
            <span className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 text-xs">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">New chat</span>
              <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={1.75} />
            </span>
            <span className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 text-xs">
              <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Upload</span>
            </span>
          </>
        ) : null}
      </AppHeader>

      <div className="flex-1 overflow-hidden p-4">
        <div className="mx-auto max-w-3xl">
          <div className="inline-flex items-center gap-1 rounded-md p-1">
            {(["chats", "files", "instructions"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={cx(
                  "inline-flex items-center rounded-md px-3 py-1.5 text-xs capitalize transition-colors",
                  activeTab === tab
                    ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]",
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {activeTab === "chats" ? (
              <div className="divide-y divide-[var(--border)]">
                {PROJECT_CHATS.map((chat, i) =>
                  at(t, 1000 + i * 300) ? (
                    <div
                      key={chat}
                      className="flex w-full items-center gap-2 py-2 text-left text-sm text-[var(--foreground)] hover:opacity-80"
                    >
                      <MessageSquare
                        className="h-[13px] w-[13px] text-[var(--muted-light)]"
                        strokeWidth={1.75}
                      />
                      <span className="min-w-0 flex-1 truncate">{chat}</span>
                    </div>
                  ) : null,
                )}
              </div>
            ) : null}
            {activeTab === "files" ? (
              <div className="divide-y divide-[var(--border)]">
                {PROJECT_FILES.map((file, i) =>
                  at(t, 1800 + i * 300) ? (
                    <div
                      key={file}
                      className="flex w-full items-center gap-2 py-2 text-left text-sm text-[var(--foreground)] hover:opacity-80"
                    >
                      <FileText
                        className="h-[13px] w-[13px] text-[var(--muted-light)]"
                        strokeWidth={1.75}
                      />
                      <span className="min-w-0 flex-1 truncate">{file}</span>
                    </div>
                  ) : null,
                )}
              </div>
            ) : null}
            {activeTab === "instructions" ? (
              <div>
                <p className="text-xs text-[var(--muted)]">
                  Set context and customize how Overlay responds in this
                  project.
                </p>
                <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="min-h-[6rem] text-sm text-[var(--foreground)]">
                    This project tracks board readiness. Prioritize concise
                    summaries, flag risks early, and reference the latest
                    metrics from Financials.xlsx.
                    {at(t, 3000) ? (
                      <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-[var(--foreground)]" />
                    ) : null}
                  </p>
                </div>
                <p className="mt-2 text-[11px] text-[var(--muted-light)]">
                  {at(t, 3200) ? "Saved" : "Saving…"}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Automations play ───────────────────────────────────────────────────── */

const AUTO_SUGGESTIONS = [
  { icon: Zap, label: "Build a workflow" },
  { icon: Globe2, label: "Monitor a site" },
  { icon: PenLine, label: "Schedule a report" },
];

const AUTO_STEPS = [
  { label: "Trigger · New file in Drive", delay: 1800 },
  { label: "Extract knowledge", delay: 2600 },
  { label: "Draft summary in Chat", delay: 3400 },
  { label: "Request human approval", delay: 4200 },
  { label: "Notify Slack channel", delay: 5400 },
];

function AutomationsPlay({ t }: { t: PlayClock }) {
  const showGreeting = at(t, 0);
  const showSuggestions = at(t, 200);
  const selectedPill = at(t, 1200);
  const showSteps = at(t, 1800);
  const allDone = at(t, 6200);

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <AppHeader>
        <ModelPill model="Auto" />
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          Governed
        </span>
      </AppHeader>

      <div className="flex flex-1 flex-col overflow-hidden">
        {showSteps ? (
          <div className="flex-1 overflow-hidden p-4">
            <div className="mx-auto max-w-2xl">
              <p
                className="text-sm font-medium text-[var(--foreground)]"
                style={marketingSerifStyle()}
              >
                Weekly knowledge digest
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Runs on a schedule. Consequential steps wait for approval.
              </p>
              <ol className="mt-6 space-y-2">
                {AUTO_STEPS.map((step, i) => {
                  if (!at(t, step.delay)) return null;
                  const isApproval = i === 3;
                  const complete = at(t, step.delay + 600);
                  return (
                    <li
                      key={step.label}
                      className={cx(
                        "flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors",
                        isApproval && !allDone
                          ? "border-[var(--foreground)] bg-[var(--surface-subtle)]"
                          : "border-[var(--border)] bg-[var(--surface-elevated)]",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[var(--muted-light)]">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-[var(--foreground)]">
                          {step.label}
                        </span>
                      </span>
                      <span className="text-[11px] text-[var(--muted)]">
                        {isApproval && !allDone ? (
                          <span className="inline-flex items-center gap-1">
                            <Loader2
                              className="h-3 w-3 animate-spin"
                              strokeWidth={1.75}
                            />
                            Needs approval
                          </span>
                        ) : complete ? (
                          <span className="inline-flex items-center gap-1 text-[var(--foreground)]">
                            <Check className="h-3 w-3" strokeWidth={2} />
                            Done
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Loader2
                              className="h-3 w-3 animate-spin"
                              strokeWidth={1.75}
                            />
                            Running…
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {allDone ? (
                <p className="mt-4 text-xs text-[var(--muted)]">
                  Digest ready. Notifications sent.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
            {showGreeting ? (
              <p
                className="text-3xl text-[var(--foreground)]"
                style={marketingSerifStyle()}
              >
                Automate work
              </p>
            ) : null}
            {showSuggestions ? (
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {AUTO_SUGGESTIONS.map((s, i) => {
                  const visible = at(t, 400 + i * 200);
                  const isSelected = selectedPill && i === 0;
                  if (!visible) return null;
                  return (
                    <span
                      key={s.label}
                      className={cx(
                        "inline-flex h-9 shrink-0 items-center gap-2 rounded-2xl border px-3.5 text-sm transition-colors",
                        isSelected
                          ? "border-[var(--foreground)] bg-[var(--surface-muted)] text-[var(--foreground)]"
                          : "border-[var(--border)] bg-transparent text-[var(--foreground)]",
                      )}
                    >
                      <s.icon
                        className="h-[15px] w-[15px] shrink-0"
                        strokeWidth={1.75}
                      />
                      {s.label}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="mx-auto max-w-[56rem]">
          <ComposerShell active={showSteps}>
            {selectedPill ? (
              <p className="min-h-[1.5rem] px-1.5 py-1.5 text-sm text-[var(--foreground)]">
                Build a workflow that digests new Drive files weekly
              </p>
            ) : (
              <p className="min-h-[1.5rem] px-1.5 py-1.5 text-sm text-[var(--muted-light)]">
                Describe a workflow to automate…
              </p>
            )}
          </ComposerShell>
        </div>
      </div>
    </div>
  );
}

/* ─── Surface stage ──────────────────────────────────────────────────────── */

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
  chat: 9500,
  files: 4500,
  extensions: 4500,
  projects: 4000,
  automations: 7000,
};

const AUTO_ADVANCE_GAP = 2000;

/* ─── Main demo component ────────────────────────────────────────────────── */

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
      className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-[0_24px_80px_var(--overlay-scrim)]"
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
        {/* Sidebar */}
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
            className="mt-3 space-y-0.5 px-2 py-3"
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
                    "flex h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    active
                      ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                      : "text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]",
                  )}
                >
                  <item.icon
                    className="h-[15px] w-[15px] shrink-0"
                    strokeWidth={1.75}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
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

        {/* Surface stage */}
        <div className="min-w-0 bg-[var(--background)]">
          <SurfaceStage surface={surface} t={t} />
        </div>
      </div>
    </div>
  );
}

/* ─── Mini scenes for feature cards ──────────────────────────────────────── */

export function MiniSceneModels() {
  return (
    <div className="space-y-1.5">
      {[
        { name: "Auto", tag: "Free" },
        { name: "GPT-5.4", tag: "Hosted" },
        { name: "Claude 4.5", tag: "Hosted" },
        { name: "Private model", tag: "Private" },
      ].map((m, i) => (
        <div
          key={m.name}
          className={cx(
            "flex items-center justify-between rounded-md border px-2 py-1.5 text-[11px]",
            i === 0
              ? "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]"
              : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]",
          )}
        >
          <span>{m.name}</span>
          <span className="text-[var(--muted-light)]">{m.tag}</span>
        </div>
      ))}
    </div>
  );
}

export function MiniSceneKnowledge() {
  return (
    <div className="space-y-1.5">
      {[
        { icon: FileText, name: "Curriculum.pdf" },
        { icon: Brain, name: "Team memory" },
        { icon: BookOpen, name: "Notion wiki" },
      ].map((item) => (
        <div
          key={item.name}
          className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-[11px]"
        >
          <item.icon
            className="h-3 w-3 text-[var(--muted-light)]"
            strokeWidth={1.75}
          />
          <span className="truncate text-[var(--foreground)]">{item.name}</span>
        </div>
      ))}
    </div>
  );
}

export function MiniSceneAgents() {
  return (
    <div className="space-y-1.5">
      {[
        { l: "Web research", s: "Allowed", ok: true },
        { l: "Send email", s: "Approve", ok: false },
        { l: "CRM write", s: "Blocked", ok: false },
      ].map((row) => (
        <div
          key={row.l}
          className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-[11px]"
        >
          <span className="text-[var(--foreground)]">{row.l}</span>
          <span
            className={cx(
              "inline-flex items-center gap-1",
              row.ok ? "text-[var(--foreground)]" : "text-[var(--muted)]",
            )}
          >
            {row.ok ? <Check className="h-3 w-3" strokeWidth={2} /> : null}
            {row.s}
          </span>
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
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] font-mono text-[11px] text-[var(--foreground)]">
            {n}
          </span>
          {i < 2 ? <span className="h-px w-4 bg-[var(--border)]" /> : null}
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
            "rounded-md border px-2.5 py-1 text-[11px]",
            i === 1
              ? "border-[var(--foreground)] bg-[var(--surface-subtle)] text-[var(--foreground)]"
              : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]",
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
        <p className="text-xs font-medium text-[var(--foreground)]">
          You define retention
        </p>
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
