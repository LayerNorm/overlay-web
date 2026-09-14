"use client";

/**
 * The interactive app-shell demo on the landing page: primary rail, contextual
 * secondary panel, and an agent DM — a faithful miniature of the real
 * Overlay shell (AppSidebarPrimaryRail + AppSidebarSecondaryPanel + main).
 * Everything is clickable; inert demo actions surface a toast.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  AtSign,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  FileText,
  FolderOpen,
  Hash,
  MessageSquare,
  Monitor,
  Paperclip,
  Plus,
  Puzzle,
  Search,
  Settings,
  User,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Creature, type CreatureShape } from "@/components/orb/Creature";
import { OverlayMark } from "@/components/orb/Orb";
import { useLandingThemeOptional } from "@/contexts/LandingThemeContext";

/* ---------- demo toast (shared via window event) ---------- */

const TOAST_EVENT = "overlay:landing-toast";

export function landingToast(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

export function LandingToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onToast = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), 1400);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className={`landing-toast${message ? " show" : ""}`} role="status">
      {message ?? " "}
    </div>
  );
}

/* ---------- theme-aware brand logos ---------- */

function BrandLogo({
  light,
  dark,
  alt = "",
  className,
}: {
  light: string;
  dark?: string;
  alt?: string;
  className?: string;
}) {
  const landing = useLandingThemeOptional();
  const src = landing?.isLandingDark && dark ? dark : light;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

export type LogoSpec = { light: string; dark?: string };

const LOGO: Record<string, LogoSpec> = {
  claude: { light: "https://svgl.app/library/claude-ai-icon.svg" },
  openai: {
    light: "https://svgl.app/library/openai.svg",
    dark: "https://svgl.app/library/openai_dark.svg",
  },
  cursor: {
    light: "https://svgl.app/library/cursor_light.svg",
    dark: "https://svgl.app/library/cursor_dark.svg",
  },
  windsurf: {
    light: "https://svgl.app/library/windsurf-light.svg",
    dark: "https://svgl.app/library/windsurf-dark.svg",
  },
  apple: {
    light: "https://svgl.app/library/apple.svg",
    dark: "https://svgl.app/library/apple_dark.svg",
  },
  slack: { light: "https://svgl.app/library/slack.svg" },
  telegram: { light: "https://svgl.app/library/telegram.svg" },
  discord: { light: "https://svgl.app/library/discord.svg" },
  google: { light: "https://svgl.app/library/google.svg" },
};

/* ---------- demo data ---------- */

type DemoMessage =
  | { who: "user"; text: string }
  | {
      who: "agent";
      worked: string;
      body: ReactNode;
      code?: { file: string; lang: string; body: string };
    };

type DemoAgent = {
  id: string;
  name: string;
  shape: CreatureShape;
  color: string;
  status: "working" | "running" | "idle";
  sub: string;
  time: string;
  msgs: DemoMessage[];
};

const AGENTS: DemoAgent[] = [
  {
    id: "scout",
    name: "Scout",
    shape: "blob",
    color: "#8b5cf6",
    status: "working",
    sub: "Working on its computer",
    time: "now",
    msgs: [
      {
        who: "user",
        text: "Pull this week’s competitor launch notes into a brief, and put the draft in the Q2 folder.",
      },
      {
        who: "agent",
        worked: "Worked for 42s, called 6 tools",
        body: (
          <>
            <p>
              Done — I scanned the eleven launch posts you saved, cross-checked
              pricing changes on three vendor sites, and wrote the brief to{" "}
              <b>Q2/competitor-brief.md</b>.
            </p>
            <p>
              The short version: two of them shipped agent features this week,
              and both moved their free tier up-market.
            </p>
          </>
        ),
        code: {
          file: "competitor-brief.md",
          lang: "markdown",
          body: "# Competitor brief — week 24\n\n1. Northwind shipped multi-agent review\n2. Acme raised free-tier limits\n3. Vektor launched a desktop agent…",
        },
      },
    ],
  },
  {
    id: "brief",
    name: "Brief",
    shape: "droplet",
    color: "#d97706",
    status: "idle",
    sub: "Idle · ran 2m ago",
    time: "2m",
    msgs: [
      { who: "user", text: "Draft the weekly digest and hold it for review." },
      {
        who: "agent",
        worked: "Worked for 28s, called 3 tools",
        body: (
          <p>
            Drafted and parked in <b>Outbox/weekly-digest.md</b> — 6 sections,
            412 words. Say the word and I&apos;ll post it to Slack.
          </p>
        ),
      },
    ],
  },
  {
    id: "ledge",
    name: "Ledge",
    shape: "hexagon",
    color: "#0ea5e9",
    status: "idle",
    sub: "Reconciled March invoices",
    time: "1h",
    msgs: [
      { who: "user", text: "Reconcile March invoices against the ledger." },
      {
        who: "agent",
        worked: "Worked for 3m 12s, called 11 tools",
        body: (
          <p>
            214 invoices matched. Three flagged for review — two missing PO
            numbers and one duplicate charge. The flagged rows are in{" "}
            <b>Finance/review-march.csv</b>.
          </p>
        ),
      },
    ],
  },
  {
    id: "mira",
    name: "Mira",
    shape: "squircle",
    color: "#e11d48",
    status: "running",
    sub: "Watching the support inbox",
    time: "3h",
    msgs: [
      {
        who: "user",
        text: "Anything urgent in the support inbox overnight?",
      },
      {
        who: "agent",
        worked: "Worked for 19s, called 4 tools",
        body: (
          <p>
            Two things: a billing dispute from a team plan customer (drafted a
            reply, needs your sign-off) and a bug report on mobile sign-in I
            filed to the tracker.
          </p>
        ),
      },
    ],
  },
];

const BYO: Array<
  | { name: string; logo: keyof typeof LOGO; sub: string }
  | { name: string; shape: CreatureShape; color: string; sub: string }
> = [
  { name: "Codex", logo: "openai", sub: "This Mac · Connected" },
  { name: "Claude Code", logo: "claude", sub: "This Mac · Connected" },
  { name: "Cursor", logo: "cursor", sub: "This Mac · Connected" },
  { name: "Hermes", shape: "cloud", color: "#0284c7", sub: "Cloud · Idle" },
];

const CHATS = [
  { name: "Launch plan review", sub: "You: looks good, ship it", time: "9:41" },
  { name: "Q2 board deck", sub: "4 files attached", time: "9:12" },
  {
    name: "Expense policy draft",
    sub: "Worked for 51s, called 7 tools",
    time: "Tue",
  },
  { name: "Hiring pipeline sync", sub: "Scout joined this chat", time: "Tue" },
  { name: "Renewal emails", sub: "You: send the v2 version", time: "Mon" },
];
const FILES = [
  { name: "competitor-brief.md", sub: "Edited by Scout · 2m ago" },
  { name: "Q2 board deck.key", sub: "4.2 MB" },
  { name: "review-march.csv", sub: "Flagged by Ledge" },
  { name: "weekly-digest.md", sub: "Outbox" },
  { name: "roadmap.pdf", sub: "Shared with workspace" },
];
const AUTOS = [
  { name: "Weekly competitor digest", sub: "Mon 9:00 AM · Scout" },
  { name: "Support inbox triage", sub: "Every 15 min · Mira" },
  { name: "Invoice reconciliation", sub: "Monthly · Ledge" },
];
const EXTENSIONS = [
  { name: "Slack", logo: "slack" as const, sub: "Connected · 2 agents" },
  { name: "Telegram", logo: "telegram" as const, sub: "Connected · 1 agent" },
  { name: "iMessage", logo: "apple" as const, sub: "Connected · 1 agent" },
  { name: "Discord", logo: "discord" as const, sub: "Available" },
];
const PROJECTS = [
  { name: "Q2 launch", sub: "4 agents · 12 files" },
  { name: "Finance ops", sub: "Ledge · monthly close" },
  { name: "Support desk", sub: "Mira · shared inbox" },
];
const KNOWLEDGE = [
  { name: "Company handbook", sub: "84 documents" },
  { name: "Competitor notes", sub: "Kept current by Scout" },
  { name: "Brand voice", sub: "Used by Brief" },
];

/* ---------- rail + panel definitions ---------- */

type PanelId =
  | "agents"
  | "chats"
  | "files"
  | "extensions"
  | "projects"
  | "knowledge"
  | "automations";

const RAIL: Array<{ id: PanelId; icon: LucideIcon; label: string; badge?: string }> = [
  { id: "agents", icon: Bot, label: "Agents" },
  { id: "chats", icon: MessageSquare, label: "Chats", badge: "3" },
  { id: "files", icon: FileText, label: "Files" },
  { id: "extensions", icon: Puzzle, label: "Extensions" },
  { id: "projects", icon: FolderOpen, label: "Projects" },
  { id: "knowledge", icon: BookOpen, label: "Knowledge" },
  { id: "automations", icon: Workflow, label: "Automations" },
];

const PANEL_TITLE: Record<PanelId, { title: string; action: string; search: string }> = {
  agents: { title: "agents", action: "New agent", search: "Search agents" },
  chats: { title: "chats", action: "New chat", search: "Search chats" },
  files: { title: "files", action: "New upload", search: "Search files" },
  extensions: { title: "extensions", action: "New extension", search: "Search extensions" },
  projects: { title: "projects", action: "New project", search: "Search projects" },
  knowledge: { title: "knowledge", action: "New base", search: "Search knowledge" },
  automations: { title: "automations", action: "New automation", search: "Search automations" },
};

function ByoMark({ item }: { item: (typeof BYO)[number] }) {
  if ("logo" in item) {
    const l = LOGO[item.logo];
    return (
      <span className="byo-logo">
        <BrandLogo light={l.light} dark={l.dark} />
      </span>
    );
  }
  return (
    <span className="cw">
      <Creature shape={item.shape} color={item.color} size={18} animated={false} />
    </span>
  );
}

/* ---------- the demo ---------- */

export function LandingShowcase() {
  const [activeAgent, setActiveAgent] = useState("scout");
  const [activePanel, setActivePanel] = useState<PanelId>("agents");
  const [draft, setDraft] = useState("");
  const [extraMsgs, setExtraMsgs] = useState<
    Record<string, DemoMessage[]>
  >({});
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const agent = AGENTS.find((a) => a.id === activeAgent) ?? AGENTS[0];
  const messages = [...agent.msgs, ...(extraMsgs[agent.id] ?? [])];

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    },
    [],
  );

  function selectAgent(id: string) {
    setActiveAgent(id);
    setActivePanel("agents");
  }

  function sendMessage() {
    const text = draft.trim();
    if (!text || typing) return;
    setDraft("");
    setExtraMsgs((m) => ({
      ...m,
      [agent.id]: [...(m[agent.id] ?? []), { who: "user", text }],
    }));
    setTyping(true);
    typingTimer.current = setTimeout(() => {
      setTyping(false);
      setExtraMsgs((m) => ({
        ...m,
        [agent.id]: [
          ...(m[agent.id] ?? []),
          {
            who: "agent",
            worked: "Worked for 8s, called 2 tools",
            body: <p>On it — I&apos;ll take care of that and report back here.</p>,
          },
        ],
      }));
    }, 1400);
  }

  function panelRows(): ReactNode {
    switch (activePanel) {
      case "agents":
        return (
          <>
            {AGENTS.map((a) => (
              <button
                key={a.id}
                className={`panel-row${a.id === activeAgent ? " active" : ""}`}
                onClick={() => selectAgent(a.id)}
              >
                <span className="cw">
                  <Creature shape={a.shape} color={a.color} size={20} animated={false} />
                </span>
                <span className="meta">
                  <span className="name">{a.name}</span>
                </span>
                <span className="time">{a.time}</span>
              </button>
            ))}
            <div className="panel-section-label">Your agents</div>
            {BYO.map((b) => (
              <button
                key={b.name}
                className="panel-row"
                onClick={() => landingToast(`${b.name} is an external agent`)}
              >
                <ByoMark item={b} />
                <span className="meta">
                  <span className="name">{b.name}</span>
                  <span className="sub" style={{ display: "block" }}>
                    {b.sub}
                  </span>
                </span>
              </button>
            ))}
          </>
        );
      case "chats":
        return (
          <>
            <div className="panel-subnav">
              {[
                { id: "personal", label: "Personal", icon: User },
                { id: "dms", label: "DMs", icon: MessageSquare, cnt: "3" },
                { id: "channels", label: "Channels", icon: Hash },
                { id: "activity", label: "Activity", icon: Bell, cnt: "5" },
              ].map((s) => (
                <button
                  key={s.id}
                  className={`panel-subnav-item${s.id === "dms" ? " active" : ""}`}
                  onClick={() => landingToast(s.label)}
                >
                  <s.icon size={13} strokeWidth={1.75} />
                  {s.label}
                  {s.cnt ? <span className="cnt">{s.cnt}</span> : null}
                </button>
              ))}
            </div>
            <div className="panel-search">
              <div className="search-box">
                <Search size={12} strokeWidth={1.75} />
                Search chats
              </div>
            </div>
            <div className="panel-list">
              {CHATS.map((c) => (
                <button
                  key={c.name}
                  className="panel-row"
                  onClick={() => landingToast(c.name)}
                >
                  <span className="meta">
                    <span className="name">{c.name}</span>
                    <span className="sub" style={{ display: "block" }}>
                      {c.sub}
                    </span>
                  </span>
                  <span className="time">{c.time}</span>
                </button>
              ))}
            </div>
          </>
        );
      case "files":
      case "extensions":
      case "projects":
      case "knowledge":
      case "automations": {
        const rows =
          activePanel === "files"
            ? FILES.map((f) => ({ ...f, icon: FileText }))
            : activePanel === "extensions"
              ? EXTENSIONS
              : activePanel === "projects"
                ? PROJECTS.map((p) => ({ ...p, icon: FolderOpen }))
                : activePanel === "knowledge"
                  ? KNOWLEDGE.map((k) => ({ ...k, icon: BookOpen }))
                  : AUTOS.map((a) => ({ ...a, icon: Workflow }));
        return (
          <>
            <div className="panel-search">
              <div className="search-box">
                <Search size={12} strokeWidth={1.75} />
                {PANEL_TITLE[activePanel].search}
              </div>
            </div>
            <div className="panel-list">
              {rows.map((r) => (
                <button
                  key={r.name}
                  className="panel-row"
                  onClick={() => landingToast(r.name)}
                >
                  {"logo" in r ? (
                    <span className="byo-logo">
                      <BrandLogo
                        light={LOGO[r.logo].light}
                        dark={LOGO[r.logo].dark}
                      />
                    </span>
                  ) : (
                    <r.icon
                      size={14}
                      strokeWidth={1.75}
                      style={{ color: "var(--muted)", flexShrink: 0 }}
                    />
                  )}
                  <span className="meta">
                    <span className="name">{r.name}</span>
                    <span className="sub" style={{ display: "block" }}>
                      {r.sub}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        );
      }
    }
  }

  const panel = PANEL_TITLE[activePanel];

  return (
    <>
      <div className="shot-frame">
        <div className="appshell">
          {/* primary rail */}
          <div className="rail">
            <div className="rail-brand" title="overlay">
              <OverlayMark size={15} label="Overlay" />
            </div>
            <nav className="rail-nav">
              {RAIL.map((r) => (
                <button
                  key={r.id}
                  className={`rail-btn${r.id === activePanel ? " active" : ""}`}
                  title={r.label}
                  onClick={() => setActivePanel(r.id)}
                >
                  <r.icon size={15} strokeWidth={1.75} />
                  {r.badge ? <span className="badge">{r.badge}</span> : null}
                </button>
              ))}
            </nav>
            <div className="rail-foot">
              <button
                className="rail-btn"
                title="Settings"
                onClick={() => landingToast("Settings")}
              >
                <Settings size={15} strokeWidth={1.6} />
              </button>
              <button
                className="avatar-dot"
                title="Account"
                onClick={() => landingToast("Account")}
              >
                D
              </button>
            </div>
          </div>

          {/* secondary panel (content swaps with rail) */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">{panel.title}</span>
              <button
                className="panel-icon-btn"
                title="More"
                onClick={() => landingToast("Panel options")}
              >
                <ChevronDown size={13} strokeWidth={1.75} />
              </button>
            </div>
            <div className="panel-action">
              <button
                className="panel-action-btn"
                onClick={() => landingToast(`${panel.action} opens the editor`)}
              >
                <Plus size={13} strokeWidth={1.75} />
                {panel.action}
              </button>
            </div>
            {activePanel === "agents" ? (
              <div className="panel-search">
                <div className="search-box">
                  <Search size={12} strokeWidth={1.75} />
                  Search agents
                </div>
              </div>
            ) : null}
            {activePanel === "agents" ? (
              <div className="panel-list">{panelRows()}</div>
            ) : (
              panelRows()
            )}
          </div>

          {/* main: agent DM */}
          <div className="main">
            <div className="main-topbar">
              <div className="topbar-agent">
                <span className="cw">
                  <Creature shape={agent.shape} color={agent.color} size={26} animated={false} />
                </span>
                <div>
                  <div className="name">{agent.name}</div>
                  <div className="status">
                    <span
                      className="status-dot"
                      style={{
                        background:
                          agent.status === "idle"
                            ? "var(--muted-light)"
                            : "var(--success)",
                      }}
                    />{" "}
                    {agent.sub}
                  </div>
                </div>
              </div>
              <button
                className="desktop-chip"
                title="Open the live desktop stream"
                onClick={() => landingToast("Live desktop stream opens here")}
              >
                <Monitor size={12} strokeWidth={1.75} /> View desktop
              </button>
              <button
                className="chip"
                title="Model"
                onClick={() => landingToast("Model picker")}
              >
                <BrandLogo light={LOGO.claude.light} /> Sonnet 4.6{" "}
                <ChevronDown size={10} strokeWidth={1.75} />
              </button>
              <button
                className="topbar-icon-btn"
                title="Agent settings"
                onClick={() => landingToast("Agent settings")}
              >
                <Settings size={14} strokeWidth={1.6} />
              </button>
            </div>
            <div className="thread">
              {messages.map((m, i) =>
                m.who === "user" ? (
                  <div className="msg-user" key={i}>
                    {m.text}
                  </div>
                ) : (
                  <div className="msg-agent" key={i}>
                    <span className="cw" style={{ marginTop: 2 }}>
                      <Creature
                        shape={agent.shape}
                        color={agent.color}
                        size={22}
                        animated={false}
                      />
                    </span>
                    <div className="body">
                      <button
                        className="worked-row"
                        onClick={() => landingToast("Expand the tool calls")}
                      >
                        <Check size={12} strokeWidth={2} /> {m.worked}
                      </button>
                      <div className="text">{m.body}</div>
                      {m.code ? (
                        <div className="code-block">
                          <div className="code-head">
                            <span>{m.code.file}</span>
                            <span>{m.code.lang}</span>
                          </div>
                          <div className="code-body">{m.code.body}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ),
              )}
              {typing ? (
                <div className="msg-agent">
                  <span className="cw" style={{ marginTop: 2 }}>
                    <Creature
                      shape={agent.shape}
                      color={agent.color}
                      size={22}
                      animated={false}
                    />
                  </span>
                  <div className="body">
                    <span className="dots">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="composer-wrap">
              <div className="composer">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder={`Message ${agent.name}, use @ to reference files, memory, tools…`}
                  aria-label={`Message ${agent.name}`}
                />
                <div className="composer-row">
                  <div className="composer-left">
                    <button title="Attach" onClick={() => landingToast("Attach a file")}>
                      <Paperclip size={15} strokeWidth={1.6} />
                    </button>
                    <button title="Mention" onClick={() => landingToast("Mention")}>
                      <AtSign size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                  <div className="composer-right">
                    <button
                      className="chip"
                      title="Model"
                      onClick={() => landingToast("Model picker")}
                    >
                      <BrandLogo light={LOGO.claude.light} /> Sonnet 4.6{" "}
                      <ChevronDown size={10} strokeWidth={1.75} />
                    </button>
                    <button
                      className="send-btn"
                      title="Send"
                      onClick={sendMessage}
                    >
                      <ArrowRight size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <LandingToast />
    </>
  );
}

/* ---------- hero agent field (floating creature + BYO logo cards) ---------- */

export function LandingAgentField() {
  const cards: Array<{
    name: string;
    sub: string;
    shape: CreatureShape;
    color: string;
    live?: boolean;
    className: string;
    style: React.CSSProperties;
    toast: string;
  }> = [
    {
      name: "Scout",
      sub: "working on its computer",
      shape: "blob",
      color: "#8b5cf6",
      live: true,
      className: "af-card af-float",
      style: { left: 0, top: 36, transform: "rotate(-6deg)", "--rot": "-6deg" } as React.CSSProperties,
      toast: "Scout — Overlay agent",
    },
    {
      name: "Hermes",
      sub: "idle · reachable on web",
      shape: "cloud",
      color: "#0284c7",
      className: "af-card af-float d2",
      style: { left: 28, top: 196, transform: "rotate(4deg)", "--rot": "4deg" } as React.CSSProperties,
      toast: "Hermes — your agent, in the cloud",
    },
    {
      name: "Brief",
      sub: "drafts your weekly digest",
      shape: "droplet",
      color: "#d97706",
      className: "af-card af-float d3",
      style: { left: 196, top: 268, transform: "rotate(-5deg)", "--rot": "-5deg" } as React.CSSProperties,
      toast: "Brief — Overlay agent",
    },
    {
      name: "Ledge",
      sub: "on iMessage",
      shape: "hexagon",
      color: "#0ea5e9",
      className: "af-card",
      style: { right: 8, top: 128, transform: "rotate(7deg)", "--rot": "7deg" } as React.CSSProperties,
      toast: "Ledge — Overlay agent",
    },
  ];
  const pills: Array<{
    name: string;
    logo: keyof typeof LOGO;
    className: string;
    style: React.CSSProperties;
    toast: string;
  }> = [
    {
      name: "Claude Code",
      logo: "claude",
      className: "af-pill af-float d2",
      style: { right: 24, top: 0, transform: "rotate(5deg)", "--rot": "5deg" } as React.CSSProperties,
      toast: "Claude Code — connected from this Mac",
    },
    {
      name: "Codex",
      logo: "openai",
      className: "af-pill af-float d3",
      style: { left: 184, top: 96, transform: "rotate(3deg)", "--rot": "3deg" } as React.CSSProperties,
      toast: "Codex — connected from this Mac",
    },
    {
      name: "Cursor",
      logo: "cursor",
      className: "af-pill",
      style: { right: 48, top: 236, transform: "rotate(-7deg)", "--rot": "-7deg" } as React.CSSProperties,
      toast: "Cursor — connected",
    },
    {
      name: "Windsurf",
      logo: "windsurf",
      className: "af-pill af-float",
      style: { right: 150, top: 330, transform: "rotate(-3deg)", "--rot": "-3deg" } as React.CSSProperties,
      toast: "Windsurf — connected",
    },
  ];

  return (
    <div className="agent-field rise" style={{ "--i": 5 } as React.CSSProperties} aria-hidden="true">
      {cards.map((c) => (
        <button
          key={c.name}
          className={c.className}
          style={c.style}
          onClick={() => landingToast(c.toast)}
        >
          <span className="cw">
            <Creature shape={c.shape} color={c.color} size={34} animated={false} />
          </span>
          <span>
            <span className="n">
              {c.name} {c.live ? <span className="af-live" /> : null}
            </span>
            <br />
            <span className="s">{c.sub}</span>
          </span>
        </button>
      ))}
      {pills.map((p) => (
        <button
          key={p.name}
          className={p.className}
          style={p.style}
          onClick={() => landingToast(p.toast)}
        >
          <BrandLogo light={LOGO[p.logo].light} dark={LOGO[p.logo].dark} />
          {p.name}
        </button>
      ))}
    </div>
  );
}

export { BrandLogo, LOGO };
export const LANDING_AGENTS = AGENTS;
