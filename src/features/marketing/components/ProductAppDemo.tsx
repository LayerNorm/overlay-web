"use client";

import {
  AtSign,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
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
  Play,
  Plus,
  Puzzle,
  ScanEye,
  Send,
  ShieldCheck,
  Sparkles,
  Video,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  MARKETING_LOGO_SIZE,
  marketingSerifStyle,
} from "@/features/marketing/lib/marketingLayout";
import { getMarketingAppHref } from "@/shared/marketing/marketing";

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type DemoSurface =
  | "chat"
  | "files"
  | "extensions"
  | "projects"
  | "automations";

type GenerationMode = "text" | "image" | "video";

type PlayClock = number;

/* ─── Surfaces (match DEFAULT_OVERLAY_NAVIGATION in @overlay/app-core) ───── */

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

/* ─── Reduced motion + play clock ────────────────────────────────────────── */

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

/**
 * Drives the chat greeting → suggestions → typed prompt → reply sequence.
 * Plays once on first mount; stops as soon as the user interacts.
 */
function useChatPlayClock(
  active: boolean,
  durationMs: number,
  reduced: boolean,
): PlayClock {
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (startedRef.current) return;
    startedRef.current = true;

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
  }, [active, durationMs, reduced]);

  return reduced ? durationMs : elapsed;
}

function at(t: PlayClock, threshold: PlayClock) {
  return t >= threshold;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ─── Shared app primitives ──────────────────────────────────────────────── */

/** App header bar — matches AppScreenHeader (min-h-14, px-3 py-2.5). */
function AppHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-2 border-b border-[var(--border)] px-3 py-2.5 sm:px-4 md:min-h-16 md:py-0">
      {children}
    </div>
  );
}

/** Section label — matches integrations section headers. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-light)]">
      {children}
    </p>
  );
}

/* ─── Model picker (matches ChatExperienceHeader model pill + dropdown) ──── */

interface DemoModel {
  id: string;
  name: string;
  cost: 0 | 1 | 2 | 3;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  free?: boolean;
}

const MODELS: DemoModel[] = [
  { id: "openrouter/free", name: "Auto", cost: 0, free: true },
  { id: "gpt-5.4", name: "GPT-5.4", cost: 3, supportsVision: true, supportsReasoning: true },
  { id: "claude-4.5", name: "Claude 4.5", cost: 3, supportsVision: true, supportsReasoning: true },
  { id: "gemini-3", name: "Gemini 3", cost: 2, supportsVision: true },
  { id: "deepseek-r2", name: "DeepSeek R2", cost: 1, supportsReasoning: true },
];

function ModelBadges({ model }: { model: DemoModel }) {
  return (
    <span className="flex h-5 shrink-0 items-center gap-1">
      {model.supportsVision ? (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-subtle)] text-[var(--muted)]">
          <ScanEye size={10} strokeWidth={1.75} />
        </span>
      ) : null}
      {model.supportsReasoning ? (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-subtle)] text-[var(--muted)]">
          <Sparkles size={10} strokeWidth={1.75} />
        </span>
      ) : null}
    </span>
  );
}

function ModelPicker({
  model,
  onChange,
}: {
  model: DemoModel;
  onChange: (m: DemoModel) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0 flex-1 md:w-auto md:flex-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] px-2.5 text-left text-xs leading-none text-[var(--muted)] hover:bg-[var(--border)] md:w-auto md:max-w-[13rem]"
      >
        <span className="min-w-0 truncate">{model.name}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      {open ? (
        <div className="overlay-pop-in absolute left-0 right-0 top-full z-20 mt-1 max-w-[calc(100vw-1.5rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg md:left-auto md:right-0 md:w-64 md:max-w-none">
          <div className="max-h-72 overflow-y-auto">
            {MODELS.map((m, i) => {
              const isSel = m.id === model.id;
              const prev = MODELS[i - 1];
              const showFreeDivider = !m.free && prev?.free;
              return (
                <div key={m.id}>
                  {showFreeDivider ? (
                    <div className="mt-1 border-t border-[var(--border)] px-3 pb-1 pt-2 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--muted-light)]">
                      Premium
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      onChange(m);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-muted)] ${
                      isSel
                        ? "font-medium text-[var(--foreground)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {isSel ? (
                        <Check size={10} />
                      ) : (
                        <span className="inline-block w-[10px]" />
                      )}
                      {m.name}
                    </span>
                    <ModelBadges model={m} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Generation mode toggle (matches GenerationModeToggle) ──────────────── */

const GEN_MODES: Array<{
  value: GenerationMode;
  label: string;
  Icon: LucideIcon;
}> = [
  { value: "text", label: "Text", Icon: MessageSquare },
  { value: "image", label: "Image", Icon: ImageIcon },
  { value: "video", label: "Video", Icon: Video },
];

function GenerationModeToggle({
  mode,
  onChange,
}: {
  mode: GenerationMode;
  onChange: (m: GenerationMode) => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center rounded-lg bg-[var(--surface-subtle)] p-0.5">
      {GEN_MODES.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            title={label}
            onClick={() => onChange(value)}
            className={`flex h-7 items-center justify-center gap-1 rounded-md px-2.5 text-xs transition-colors ${
              active
                ? "bg-[var(--surface-elevated)] font-medium text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            <Icon size={11} className="shrink-0" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Temporary chat button (matches TemporaryChatButton) ────────────────── */

const TEMPORARY_CHAT_ICON_SRC = "/assets/icons/dashed-chat.png";

function TemporaryChatButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? "Disable temporary chat" : "Enable temporary chat"}
      onClick={onClick}
      className={`flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-[background-color,border-color,box-shadow,color] duration-300 ${
        active
          ? "temporary-chat-inverse-surface border-dashed border-[var(--temporary-chat-border)] shadow-sm"
          : "border-transparent bg-[var(--surface-subtle)] text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)]"
      }`}
    >
      <span
        aria-hidden
        className="size-4 bg-current"
        style={{
          WebkitMask: `url(${TEMPORARY_CHAT_ICON_SRC}) center / contain no-repeat`,
          mask: `url(${TEMPORARY_CHAT_ICON_SRC}) center / contain no-repeat`,
        }}
      />
    </button>
  );
}

/* ─── Composer (matches ChatComposer / ComposerInputCard) ───────────────── */

function ComposerControls({
  hasText,
  onSend,
  onAttachClick,
  onMentionClick,
}: {
  hasText: boolean;
  onSend: () => void;
  onAttachClick: () => void;
  onMentionClick: () => void;
}) {
  return (
    <div className="mt-2 grid min-h-9 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2">
      <button
        type="button"
        onClick={onAttachClick}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        aria-label="Attach files"
      >
        <Paperclip size={16} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onMentionClick}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        aria-label="Insert mention"
      >
        <AtSign size={16} strokeWidth={1.75} />
      </button>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" />
      <button
        type="button"
        onClick={onSend}
        disabled={!hasText}
        aria-label="Send"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-[transform,background-color,opacity] duration-150 ease-out hover:opacity-80 active:scale-[0.97] disabled:opacity-40"
      >
        <Send size={17} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function ComposerCard({
  value,
  onChange,
  onKeyDown,
  onSend,
  onAttachClick,
  onMentionClick,
  placeholder,
  hasText,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onAttachClick: () => void;
  onMentionClick: () => void;
  placeholder: string;
  hasText: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autofocus when the chat surface is empty (mirrors the app's empty-state focus).
  useEffect(() => {
    if (hasText) return;
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [hasText]);

  return (
    <div className="overflow-visible rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[background-color,border-color,box-shadow,color] duration-300">
      <div className="p-2.5 sm:p-3">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          className="block max-h-[12rem] min-h-[1.5rem] w-full resize-none border-0 bg-transparent px-1.5 py-1.5 text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        />
        <ComposerControls
          hasText={hasText}
          onSend={onSend}
          onAttachClick={onAttachClick}
          onMentionClick={onMentionClick}
        />
      </div>
    </div>
  );
}

/* ─── Chat suggestions (matches ChatEmptyState) ──────────────────────────── */

const CHAT_SUGGESTIONS: Array<{
  id: "image" | "write" | "lookup";
  label: string;
  Icon: LucideIcon;
  seed: string;
}> = [
  { id: "image", label: "Create an image", Icon: ImageIcon, seed: "Create an image of " },
  { id: "write", label: "Write or edit", Icon: PenLine, seed: "Help me write or edit " },
  { id: "lookup", label: "Look something up", Icon: Globe2, seed: "Look up " },
];

/* ─── Chat play (auto-run once on first mount) ───────────────────────────── */

const CHAT_PLAY_DURATION = 9000;
const CHAT_USER_PROMPT = "Summarize Q1 performance and draft a board update";
const CHAT_REPLY =
  "Revenue grew 18% QoQ. Three risks need board attention: enterprise churn, hiring lag in infra, and the Europe launch slip. Draft memo attached with recommended asks.";

function ChatPlay({
  t,
  hasInteracted,
  composerValue,
  onComposerChange,
  onSend,
  onSuggestionClick,
  model,
  onModelChange,
  tempChat,
  onTempChatToggle,
  genMode,
  onGenModeChange,
}: {
  t: PlayClock;
  hasInteracted: boolean;
  composerValue: string;
  onComposerChange: (v: string) => void;
  onSend: () => void;
  onSuggestionClick: (seed: string) => void;
  model: DemoModel;
  onModelChange: (m: DemoModel) => void;
  tempChat: boolean;
  onTempChatToggle: () => void;
  genMode: GenerationMode;
  onGenModeChange: (m: GenerationMode) => void;
}) {
  // Auto-play sequence only runs before the user interacts.
  const showGreeting = !hasInteracted && at(t, 0);
  const showSuggestions = !hasInteracted && at(t, 200);
  const autoTypedLen = Math.min(
    CHAT_USER_PROMPT.length,
    Math.floor(Math.max(0, t - 1600) / 22),
  );
  const autoTyped = !hasInteracted ? CHAT_USER_PROMPT.slice(0, autoTypedLen) : "";
  const showAutoUserMsg = !hasInteracted && at(t, 3400);
  const showAutoTools = !hasInteracted && at(t, 4200);
  const showAutoReply = !hasInteracted && at(t, 5000);
  const autoReplyLen = Math.min(
    CHAT_REPLY.length,
    Math.floor(Math.max(0, t - 5000) / 14),
  );
  const autoReply = !hasInteracted ? CHAT_REPLY.slice(0, autoReplyLen) : "";
  const showAutoSources = !hasInteracted && at(t, 8200);

  // Once the user has interacted, the composer is the live input.
  const displayValue = hasInteracted ? composerValue : autoTyped;
  const hasText = displayValue.trim().length > 0;
  const showConversation = hasInteracted ? false : showAutoUserMsg;

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      {/* Header — matches ChatExperienceHeader */}
      <AppHeader>
        <ModelPicker model={model} onChange={onModelChange} />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Mobile: hidden on md+ */}
          <div className="flex shrink-0 items-center gap-1.5 md:hidden">
            <GenerationModeToggle mode={genMode} onChange={onGenModeChange} />
            <TemporaryChatButton active={tempChat} onClick={onTempChatToggle} />
            <button
              type="button"
              className="flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              aria-label="Export"
            >
              <Download size={15} strokeWidth={1.75} />
            </button>
          </div>
          {/* Desktop: hidden on mobile */}
          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
            <GenerationModeToggle mode={genMode} onChange={onGenModeChange} />
            <TemporaryChatButton active={tempChat} onClick={onTempChatToggle} />
            <button
              type="button"
              className="flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              aria-label="Export"
            >
              <Download size={15} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </AppHeader>

      {/* Body */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {showConversation ? (
          <div className="flex flex-1 flex-col gap-4 overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
            <div className="mx-auto w-full max-w-4xl">
              <div className="ml-auto max-w-[85%] rounded-2xl bg-[var(--foreground)] px-4 py-2.5 text-sm text-[var(--background)]">
                {CHAT_USER_PROMPT}
              </div>
            </div>
            {showAutoTools ? (
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
            {showAutoReply ? (
              <div className="mx-auto w-full max-w-4xl">
                <div className="max-w-[92%] space-y-2">
                  <p className="text-sm leading-6 text-[var(--foreground)]">
                    {autoReply}
                    {autoReplyLen < CHAT_REPLY.length ? (
                      <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-[var(--foreground)]" />
                    ) : null}
                  </p>
                  {showAutoSources ? (
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
          </div>
        )}
      </div>

      {/* Composer + suggestions — matches ChatComposer (composer) + ChatEmptyState (suggestions below) */}
      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="mx-auto w-full max-w-[36rem]">
          <ComposerCard
            value={displayValue}
            onChange={onComposerChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            onSend={onSend}
            onAttachClick={onSend}
            onMentionClick={onSend}
            placeholder="Ask anything, use @ to reference files, memory, tools…"
            hasText={hasText}
          />
          {/* Suggestions below composer — matches ChatEmptyState */}
          {showSuggestions ? (
            <div className="mt-4 flex items-center gap-2 md:flex-wrap md:justify-center">
              {CHAT_SUGGESTIONS.map(({ id, label, Icon, seed }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSuggestionClick(seed)}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-2xl border border-[var(--border)] bg-transparent px-3.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
                >
                  <Icon size={15} strokeWidth={1.75} className="shrink-0 text-[var(--muted)]" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ─── Files play (static snapshot) ───────────────────────────────────────── */

const FILES_LIST = [
  { name: "Q1 plan.docx", kind: "Doc", icon: FileText, selected: true },
  { name: "Curriculum.pdf", kind: "PDF", icon: FileText },
  { name: "Financials.xlsx", kind: "Sheet", icon: FileText },
  { name: "Launch notes", kind: "Note", icon: BookOpen },
  { name: "Team memory", kind: "Memory", icon: Brain },
];

function FilesPlay() {
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <AppHeader>
        <span className="text-sm font-medium text-[var(--foreground)]">Files</span>
        <span className="text-xs text-[var(--muted-light)]">{FILES_LIST.length} items</span>
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
              const isSelected = file.selected;
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
                  <file.icon className="mt-0.5 h-[15px] w-[15px] shrink-0 text-[var(--muted-light)]" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate leading-relaxed text-[var(--foreground)]">
                    {file.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--muted-light)]">{file.kind}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="hidden w-[280px] shrink-0 overflow-hidden bg-[var(--sidebar-surface)] p-4 md:block">
          <SectionLabel>Preview</SectionLabel>
          <div className="mt-3 space-y-3">
            <p className="text-sm font-medium text-[var(--foreground)]" style={marketingSerifStyle()}>
              Q1 plan.docx
            </p>
            <div className="space-y-2">
              {[100, 92, 96, 70].map((w, i) => (
                <div key={i} className="h-2 rounded-full bg-[var(--surface-subtle)]" style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px]">
              <AtSign className="h-3 w-3 text-[var(--muted)]" strokeWidth={1.75} />
              <span className="text-[var(--muted)]">Reference in chat</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Extensions play (static snapshot) ──────────────────────────────────── */

const EXTENSIONS_LIST = [
  { name: "Web Search", kind: "Tool", icon: Globe2 },
  { name: "Browser Use", kind: "Tool", icon: ScanEye },
  { name: "Sandbox", kind: "Tool", icon: Play },
  { name: "Gmail", kind: "Connector", icon: AtSign },
  { name: "Google Drive", kind: "Connector", icon: FolderOpen },
  { name: "Slack", kind: "Connector", icon: MessageSquare },
];

function ExtensionsPlay() {
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <AppHeader>
        <span className="text-sm font-medium text-[var(--foreground)]">Extensions</span>
        <span className="text-xs text-[var(--muted-light)]">{EXTENSIONS_LIST.length} items</span>
        <span className="flex-1" />
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--surface-subtle)] px-2.5 text-xs text-[var(--foreground)] hover:bg-[var(--border)]"
        >
          <Plus size={13} strokeWidth={1.75} />
          Add
        </button>
      </AppHeader>
      <div className="flex-1 overflow-hidden p-3 sm:p-4">
        <div className="mx-auto max-w-3xl space-y-1">
          {EXTENSIONS_LIST.map((ext) => (
            <div
              key={ext.name}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-muted)]"
            >
              <ext.icon className="mt-0.5 h-[15px] w-[15px] shrink-0 text-[var(--muted-light)]" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate leading-relaxed text-[var(--foreground)]">{ext.name}</span>
              <span className="shrink-0 text-[10px] text-[var(--muted-light)]">{ext.kind}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Projects play (static snapshot) ────────────────────────────────────── */

const PROJECT_CHATS = ["Board prep · Q1", "Hiring plan review", "Europe launch risks"];
const PROJECT_FILES = ["Financials.xlsx", "Board_update_Q1.md", "Churn_analysis.md"];

function ProjectsPlay() {
  const [activeTab, setActiveTab] = useState<"chats" | "files" | "instructions">("chats");
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <AppHeader>
        <span className="text-sm font-medium text-[var(--foreground)]">Board prep</span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          Project
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--surface-subtle)] px-2.5 text-xs text-[var(--foreground)] hover:bg-[var(--border)]"
        >
          <Plus size={13} strokeWidth={1.75} />
          New
        </button>
      </AppHeader>
      <div className="flex-1 overflow-hidden p-3 sm:p-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-1">
            {(["chats", "files", "instructions"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
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
                {PROJECT_CHATS.map((chat) => (
                  <div key={chat} className="flex w-full items-center gap-2 py-2 text-left text-sm text-[var(--foreground)] hover:opacity-80">
                    <MessageSquare className="h-[13px] w-[13px] text-[var(--muted-light)]" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">{chat}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {activeTab === "files" ? (
              <div className="divide-y divide-[var(--border)]">
                {PROJECT_FILES.map((file) => (
                  <div key={file} className="flex w-full items-center gap-2 py-2 text-left text-sm text-[var(--foreground)] hover:opacity-80">
                    <FileText className="h-[13px] w-[13px] text-[var(--muted-light)]" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">{file}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {activeTab === "instructions" ? (
              <div>
                <p className="text-xs text-[var(--muted)]">
                  Set context and customize how Overlay responds in this project.
                </p>
                <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="min-h-[6rem] text-sm text-[var(--foreground)]">
                    This project tracks board readiness. Prioritize concise summaries, flag risks early, and reference the latest metrics from Financials.xlsx.
                  </p>
                </div>
                <p className="mt-2 text-[11px] text-[var(--muted-light)]">Saved</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Automations play (static snapshot) ─────────────────────────────────── */

const AUTO_STEPS = [
  { label: "Trigger · New file in Drive", complete: true },
  { label: "Extract knowledge", complete: true },
  { label: "Draft summary in Chat", complete: true },
  { label: "Request human approval", complete: false, approval: true },
  { label: "Notify Slack channel", complete: false },
];

function AutomationsPlay() {
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <AppHeader>
        <ModelPillPlaceholder label="Auto" />
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          Governed
        </span>
        <span className="flex-1" />
      </AppHeader>
      <div className="flex-1 overflow-hidden p-4">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm font-medium text-[var(--foreground)]" style={marketingSerifStyle()}>
            Weekly knowledge digest
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Runs on a schedule. Consequential steps wait for approval.
          </p>
          <ol className="mt-6 space-y-2">
            {AUTO_STEPS.map((step, i) => (
              <li
                key={step.label}
                className={cx(
                  "flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors",
                  step.approval && !step.complete
                    ? "border-[var(--foreground)] bg-[var(--surface-subtle)]"
                    : "border-[var(--border)] bg-[var(--surface-elevated)]",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[var(--muted-light)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[var(--foreground)]">{step.label}</span>
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {step.approval && !step.complete ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                      Needs approval
                    </span>
                  ) : step.complete ? (
                    <span className="inline-flex items-center gap-1 text-[var(--foreground)]">
                      <Check className="h-3 w-3" strokeWidth={2} />
                      Done
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                      Running…
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function ModelPillPlaceholder({ label }: { label: string }) {
  return (
    <span className="flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] px-2.5 text-left text-xs leading-none text-[var(--muted)] md:max-w-[13rem]">
      <span className="truncate">{label}</span>
      <ChevronDown size={11} className="shrink-0 opacity-60" />
    </span>
  );
}

/* ─── Surface stage ──────────────────────────────────────────────────────── */

function SurfaceStage({
  surface,
  ...chatProps
}: { surface: DemoSurface } & React.ComponentProps<typeof ChatPlay>) {
  switch (surface) {
    case "files":
      return <FilesPlay />;
    case "extensions":
      return <ExtensionsPlay />;
    case "projects":
      return <ProjectsPlay />;
    case "automations":
      return <AutomationsPlay />;
    case "chat":
    default:
      return <ChatPlay {...chatProps} />;
  }
}

/* ─── Sidebar (matches AppSidebar) ───────────────────────────────────────── */

const SIDEBAR_CHATS = [
  "Board prep · Q1",
  "Hiring plan review",
  "Europe launch risks",
  "Curriculum draft",
];

function DemoSidebar({
  surface,
  onSelect,
}: {
  surface: DemoSurface;
  onSelect: (s: DemoSurface) => void;
}) {
  return (
    <aside className="hidden border-r border-[var(--border)] bg-[var(--sidebar-surface)] md:flex md:w-[220px] md:shrink-0 md:flex-col">
      {/* Brand row */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <Image
          src="/assets/overlay-logo.png"
          alt=""
          width={MARKETING_LOGO_SIZE}
          height={MARKETING_LOGO_SIZE}
          className="shrink-0"
        />
        <span className="text-sm font-medium tracking-tight" style={marketingSerifStyle()}>
          overlay
        </span>
      </div>

      {/* Nav */}
      <nav className="shrink-0 space-y-0.5 px-2 py-2" aria-label="Product surfaces">
        {SURFACES.map((item) => {
          const active = item.key === surface;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(item.key)}
              className={cx(
                "group flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm transition-colors",
                active
                  ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]",
              )}
            >
              <item.icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Inline chat panel — matches the real sidebar's chat list when Chat is active */}
      {surface === "chat" ? (
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
          <div className="flex items-center justify-between px-2 py-2">
            <SectionLabel>Chats</SectionLabel>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              aria-label="New chat"
            >
              <Plus size={14} strokeWidth={1.75} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SIDEBAR_CHATS.map((chat, i) => (
              <button
                key={chat}
                type="button"
                className={cx(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  i === 0
                    ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]",
                )}
              >
                <MessageSquare className="h-[13px] w-[13px] shrink-0 text-[var(--muted-light)]" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{chat}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Account row — matches SidebarAccountMenu collapsed state */}
      <div className="mt-auto shrink-0 border-t border-[var(--border)] p-2">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-xs font-medium text-[var(--muted)]">
            G
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">Guest</span>
          <ChevronUp size={14} className="shrink-0 text-[var(--muted-light)]" strokeWidth={1.75} />
        </button>
      </div>
    </aside>
  );
}

/* ─── Mobile surface switcher ────────────────────────────────────────────── */

function MobileSurfaceSwitcher({
  surface,
  onSelect,
}: {
  surface: DemoSurface;
  onSelect: (s: DemoSurface) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] p-2 md:hidden">
      {SURFACES.map((item) => {
        const active = item.key === surface;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
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
  );
}

/* ─── Main demo component ────────────────────────────────────────────────── */

export function ProductAppDemo() {
  const reduced = usePrefersReducedMotion();
  const { isAuthenticated } = useAuth();
  const [surface, setSurface] = useState<DemoSurface>("chat");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [model, setModel] = useState<DemoModel>(MODELS[0]!);
  const [tempChat, setTempChat] = useState(false);
  const [genMode, setGenMode] = useState<GenerationMode>("text");

  // Auto-play only runs for the chat surface, before first interaction.
  const playActive = surface === "chat" && !hasInteracted;
  const t = useChatPlayClock(playActive, CHAT_PLAY_DURATION, reduced);

  const selectSurface = useCallback((next: DemoSurface) => {
    setSurface(next);
    setHasInteracted(true);
  }, []);

  const handleComposerChange = useCallback((v: string) => {
    setHasInteracted(true);
    setComposerValue(v);
  }, []);

  const handleSend = useCallback(() => {
    const prompt = (hasInteracted ? composerValue : "").trim();
    // Stash the prompt in sessionStorage under the key the app's ChatExperience
    // already reads on mount (see ChatExperience.tsx ~line 304). This survives
    // the sign-in redirect, which a ?prompt= query param would NOT (the redirect
    // target is a hardcoded path). Satisfies "route to app, pass the prompt" via
    // a more robust channel.
    if (prompt) {
      try {
        sessionStorage.setItem("overlay:guest-draft", prompt);
      } catch {
        /* ignore — blocked storage must not crash the demo */
      }
    }
    const href = getMarketingAppHref(isAuthenticated);
    window.location.href = href;
  }, [composerValue, hasInteracted, isAuthenticated]);

  const handleSuggestionClick = useCallback((seed: string) => {
    setHasInteracted(true);
    setComposerValue(seed);
  }, []);

  const chatPlayProps = {
    t,
    hasInteracted,
    composerValue,
    onComposerChange: handleComposerChange,
    onSend: handleSend,
    onSuggestionClick: handleSuggestionClick,
    model,
    onModelChange: setModel,
    tempChat,
    onTempChatToggle: () => {
      setHasInteracted(true);
      setTempChat((v) => !v);
    },
    genMode,
    onGenModeChange: (m: GenerationMode) => {
      setHasInteracted(true);
      setGenMode(m);
    },
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-[0_24px_80px_var(--overlay-scrim)]">
      {/* Window chrome — neutral gray dots (not warm-paper artifacts) */}
      <div className="flex h-10 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-elevated)] px-4">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#e4e4e7]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#d4d4d8]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#a1a1aa]" />
        </span>
        <span className="mx-auto text-[11px] text-[var(--muted-light)]">
          overlay — {SURFACES.find((s) => s.key === surface)?.label}
        </span>
      </div>

      <div className="flex">
        <DemoSidebar surface={surface} onSelect={selectSurface} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileSurfaceSwitcher surface={surface} onSelect={selectSurface} />
          <div className="min-w-0 bg-[var(--background)]">
            <SurfaceStage surface={surface} {...chatPlayProps} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Mini scenes for feature cards ──────────────────────────────────────── */

export function FeatureMiniScene({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-[140px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      {children}
    </div>
  );
}

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
        { icon: BookOpen, name: "Launch notes" },
        { icon: Brain, name: "Team memory" },
      ].map((item) => (
        <div
          key={item.name}
          className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-[11px] text-[var(--foreground)]"
        >
          <item.icon className="h-3 w-3 shrink-0 text-[var(--muted-light)]" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
        </div>
      ))}
    </div>
  );
}

export function MiniSceneAgents() {
  return (
    <div className="space-y-1.5">
      {[
        { icon: Globe2, label: "Web Search" },
        { icon: ScanEye, label: "Browser Use" },
        { icon: Play, label: "Sandbox" },
      ].map((tool) => (
        <div
          key={tool.label}
          className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-[11px] text-[var(--foreground)]"
        >
          <tool.icon className="h-3 w-3 shrink-0 text-[var(--muted-light)]" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{tool.label}</span>
          <Check className="h-3 w-3 shrink-0 text-[var(--foreground)]" strokeWidth={2} />
        </div>
      ))}
    </div>
  );
}

export function MiniSceneWorkflows() {
  return (
    <div className="space-y-1.5">
      {[
        { label: "Trigger", icon: Zap },
        { label: "Extract", icon: Brain },
        { label: "Approve", icon: Check },
      ].map((step, i) => (
        <div
          key={step.label}
          className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-[11px] text-[var(--foreground)]"
        >
          <span className="font-mono text-[9px] text-[var(--muted-light)]">
            {String(i + 1).padStart(2, "0")}
          </span>
          <step.icon className="h-3 w-3 shrink-0 text-[var(--muted-light)]" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{step.label}</span>
        </div>
      ))}
    </div>
  );
}

export function MiniSceneInfra() {
  return (
    <div className="space-y-1.5">
      {[
        { label: "Hosted", active: true },
        { label: "Private cloud", active: false },
        { label: "On-premises", active: false },
      ].map((opt) => (
        <div
          key={opt.label}
          className={cx(
            "flex items-center justify-between rounded-md border px-2 py-1.5 text-[11px]",
            opt.active
              ? "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]"
              : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]",
          )}
        >
          <span>{opt.label}</span>
          {opt.active ? <Check className="h-3 w-3 text-[var(--foreground)]" strokeWidth={2} /> : null}
        </div>
      ))}
    </div>
  );
}

export function MiniSceneData() {
  return (
    <div className="space-y-1.5">
      {[
        { label: "Storage: US region", icon: FolderOpen },
        { label: "Retention: 90 days", icon: BookOpen },
        { label: "Access: 3 admins", icon: ShieldCheck },
      ].map((row) => (
        <div
          key={row.label}
          className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-[11px] text-[var(--foreground)]"
        >
          <row.icon className="h-3 w-3 shrink-0 text-[var(--muted-light)]" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
        </div>
      ))}
    </div>
  );
}
