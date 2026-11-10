import * as React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowLeft,
  ArrowUp,
  Bell,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  CreditCard,
  Download,
  ExternalLink,
  File,
  FileText,
  Folder,
  GitFork,
  Hash,
  Image,
  ListChecks,
  LoaderCircle,
  Mail,
  MessageCircleQuestion,
  MessageSquare,
  Mic,
  MoreHorizontal,
  PanelLeft,
  Paperclip,
  Pin,
  Plus,
  Search,
  Settings,
  Shield,
  Signal,
  Smile,
  Sparkles,
  Star,
  ThumbsUp,
  Trash2,
  User,
  Users,
  Wifi,
  WifiOff,
  Workflow,
  X,
  Zap,
  ScanEye,
  BatteryFull,
  Volume2,
  Bookmark,
  Pencil,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../../../packages/overlay-ui/src/components/ui/button";
import { Input } from "../../../packages/overlay-ui/src/components/ui/input";
import { Textarea } from "../../../packages/overlay-ui/src/components/ui/textarea";
import { DoubleSidebar } from "../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar";
import { OverlayMark } from "../../../packages/overlay-ui/src/components/orb/OverlayMark";
import { BrandLockup } from "../../../packages/overlay-ui/src/components/orb/BrandLockup";
import { AgentCreature } from "../../../src/components/orb/Creature";
import { ProviderLogo } from "../../../packages/overlay-ui/src/components/ui/provider-logo";

const groups = [
  [
    "Entry",
    ["boot", "Boot loader"],
    ["sign-in", "Sign in"],
    ["workspace-gate", "Workspace required"],
    ["account-sheet", "Workspace and account"],
  ],
  [
    "Shell",
    ["agents-drawer", "Agents drawer"],
    ["chats-drawer", "Chats drawer"],
  ],
  [
    "Work",
    ["work-list", "Work list"],
    ["task-detail", "Task detail"],
    ["new-task", "New task"],
  ],
  [
    "Agents",
    ["agent-stream", "Working thread"],
    ["agent-approval", "Approval and question"],
    ["agent-details", "Agent details"],
    ["agent-editor", "Agent editor"],
  ],
  [
    "Chats",
    ["new-chat", "New personal chat"],
    ["chat-stream", "Personal chat"],
    ["model-picker", "Model picker"],
    ["channel", "Channel"],
    ["message-thread", "Thread and actions"],
  ],
  ["Activity", ["activity", "Activity feed"]],
  [
    "Files",
    ["files", "Files"],
    ["note", "Note editor"],
    ["file-preview", "File preview"],
  ],
  [
    "Automations",
    ["automations", "Automations"],
    ["automation-detail", "Automation detail"],
  ],
  ["Search", ["search", "Search and mentions"]],
  [
    "Settings",
    ["settings", "Settings"],
    ["memories", "Memories"],
    ["members", "Members and invitations"],
    ["models", "Models and connections"],
    ["billing", "Billing"],
    ["notifications", "Notifications"],
    ["voice", "Voice and transcription"],
    ["account", "Account"],
    ["help", "Help and bug report"],
  ],
  [
    "Mobile",
    ["push-permission", "Notification permission"],
    ["offline", "Offline"],
  ],
] as const;
const screens = groups.flatMap(
  (g) => g.slice(1) as unknown as [string, string][],
);
const tasks = [
  ["Review subscription pricing", "review", "Overlay", "Ready for review"],
  ["Test the onboarding flow", "progress", "Builder", "Today"],
  ["Research customer feedback", "progress", "Scout", "Today"],
  ["Draft release notes", "todo", "Overlay", "Tomorrow"],
  ["Confirm research scope", "todo", "Scout", "Needs you"],
  ["Ship the mobile beta", "backlog", "Builder", "Oct 28"],
];
const settingPages = [
  ["Memories", Sparkles, "memories"],
  ["Members", Users, "members"],
  ["Models and connections", Bot, "models"],
  ["Billing", CreditCard, "billing"],
  ["Notifications", Bell, "notifications"],
  ["Voice and transcription", Mic, "voice"],
  ["Account", User, "account"],
  ["Help and feedback", CircleHelp, "help"],
] as const;
function B({
  children,
  icon: Icon,
  onClick,
  secondary = false,
  className = "",
  ...props
}: React.ComponentProps<typeof Button> & { icon?: LucideIcon; secondary?: boolean }) {
  return (
    <Button
      variant={secondary ? "secondary" : "ghost"}
      className={"b " + className}
      onClick={onClick}
      {...props}
    >
      {Icon && <Icon size={15} />}
      {children}
    </Button>
  );
}
function I({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <B className="icon-button" aria-label={label} onClick={onClick}>
      <Icon size={17} />
    </B>
  );
}
function Avatar({ name = "Overlay", size = 24, working = false }: { name?: string; size?: number; working?: boolean }) {
  return name === "Divyansh" ? (
    <span className="avatar-human">DL</span>
  ) : (
    <AgentCreature
      agent={{
        name,
        avatarShape: name === "Scout" ? "cloud" : "squircle",
        avatarColor: name === "Scout" ? "#7d9c8c" : "#a28cbd",
      }}
      isDefault={name === "Overlay"}
      size={size}
      working={working}
    />
  );
}
function Tabs({ items, onChange, value }: { items: string[]; onChange?: (value: string) => void; value?: string }) {
  const [v, set] = React.useState(value || items[0]);
  return (
    <div className="tabs">
      {items.map((t: string) => (
        <B
          key={t}
          secondary={v === t}
          onClick={() => {
            set(t);
            onChange?.(t);
          }}
        >
          {t}
        </B>
      ))}
    </div>
  );
}
function Toggle({ initial = true }: { initial?: boolean }) {
  const [on, set] = React.useState(initial);
  return (
    <B
      aria-label={on ? "Turn off" : "Turn on"}
      role="switch"
      aria-checked={on}
      onClick={() => set(!on)}
      className="icon-button"
    >
      <span className={"toggle " + (!on ? "off" : "")} />
    </B>
  );
}
function Row({ icon: Icon, title, sub, right, children, onClick }: { icon?: LucideIcon; title: React.ReactNode; sub?: string; right?: React.ReactNode; children?: React.ReactNode; onClick?: () => void }) {
  return (
    <B className="list-row" onClick={onClick}>
      {Icon && <Icon size={17} className="muted" />}
      <span className="grow">
        <strong>{title}</strong>
        {sub && <small>{sub}</small>}
      </span>
      {children}
      {right || <ChevronRight size={14} className="muted" />}
    </B>
  );
}
function Field({
  label,
  value,
  placeholder,
  multiline = false,
  type = "text",
}: { label: string; value?: string; placeholder?: string; multiline?: boolean; type?: string }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {multiline ? (
        <Textarea
          aria-label={label}
          className="field"
          defaultValue={value}
          placeholder={placeholder}
        />
      ) : (
        <Input
          aria-label={label}
          className="field"
          defaultValue={value}
          placeholder={placeholder}
          type={type}
        />
      )}
    </div>
  );
}
function TaskStatus({ status = "todo" }: { status?: string }) {
  return (
    <svg className="task-status" width="16" height="16" viewBox="0 0 16 16">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={status === "backlog" ? "2.2 2.2" : undefined}
      />
      {status === "progress" && (
        <path d="M8 4a4 4 0 0 1 0 8Z" fill="currentColor" />
      )}
      {status === "review" && (
        <circle cx="8" cy="8" r="3" fill="currentColor" />
      )}
    </svg>
  );
}
function Composer({ agent = false, recipient, onModel }: { agent?: boolean; recipient?: string; onModel?: () => void }) {
  const [draft, set] = React.useState("");
  return (
    <div className="composer">
      <Textarea
        aria-label="Message"
        placeholder={recipient ? `Message ${recipient}` : agent ? "Message Overlay…" : "Ask anything…"}
        value={draft}
        onChange={(e) => set(e.target.value)}
      />
      <div className="composer-tools">
        <I icon={Plus} label="Attach file" />
        <B className="model-chip" onClick={onModel}>
          Auto
          <ChevronDown size={12} />
        </B>
        <span className="grow" />
        <I icon={Mic} label="Voice message" />
        <B
          className="icon-button send"
          aria-label="Send message"
          onClick={() => set("")}
        >
          <ArrowUp size={17} />
        </B>
      </div>
    </div>
  );
}
function Sheet({ children, onClose, title }: { children: React.ReactNode; onClose?: () => void; title?: string }) {
  return (
    <div className="sheet-shade">
      <section className="sheet">
        <div className="sheet-handle" />
        {title && (
          <div className="row spaced">
            <h2>{title}</h2>
            {onClose && <I icon={X} label="Close sheet" onClick={onClose} />}
          </div>
        )}
        {children}
      </section>
    </div>
  );
}
function WorkList({ navigate }: { navigate: (screen: string) => void }) {
  const [filter, set] = React.useState("Needs you");
  return (
    <>
      <div className="content flush">
        <div style={{ padding: "10px 16px" }}>
          <div className="row spaced" style={{ marginBottom: 22 }}>
            <h1>Work</h1>
            <I
              icon={Plus}
              label="New task"
              onClick={() => navigate("new-task")}
            />
          </div>
          <Tabs
            items={["Needs you", "Assigned to me", "Everything"]}
            onChange={set}
          />
        </div>
        <div className="work-section">
          {filter === "Needs you"
            ? "Ready for review"
            : filter === "Assigned to me"
              ? "Your work"
              : "All work"}
        </div>
        {tasks
          .filter((_, i) => filter !== "Needs you" || i === 0 || i === 4)
          .map(([title, status, agent, date]) => (
            <div
              key={title}
              className={"work-row " + status}
              onClick={() => navigate("task-detail")}
              role="button"
              tabIndex={0}
            >
              <TaskStatus status={status} />
              <div className="work-title">
                {title}
                <small>{date}</small>
              </div>
              <Avatar name={agent} />
            </div>
          ))}
        <div className="work-section">In progress · 2</div>
        {tasks.slice(1, 3).map(([title, status, agent]) => (
          <div
            key={title}
            className={"work-row " + status}
            onClick={() => navigate("task-detail")}
          >
            <TaskStatus status={status} />
            <div className="work-title">{title}</div>
            <Avatar name={agent} />
          </div>
        ))}
      </div>
    </>
  );
}
function AgentThread({ approval = false }: { approval?: boolean }) {
  return (
    <>
      <div className={'content chat-body' + (approval ? ' approval-thread' : '')}>
        <div className="user-bubble">
          Review our subscription pricing and recommend what to change.
        </div>
        <div className="assistant-name">
          <Avatar working={!approval} />
          <span>Overlay</span>
          <small>10:42</small>
        </div>
        <p>
          I compared our plans with the market and reviewed the last 30 days of
          feedback.
        </p>
        <details className="tool-row">
          <summary>Reviewed 4 sources</summary>
          <p>Pricing, usage, feedback and competitors</p>
        </details>
        <details className="tool-row">
          <summary>Read pricing notes</summary>
          <p>Current plan structure reviewed.</p>
        </details>
        {approval ? (
          <>
            <div className="approval">
              <div className="row">
                <Shield size={16} />
                <h3>Approve pricing update</h3>
              </div>
              <p>Update the draft pricing page. Nothing will be published.</p>
              <div className="row">
                <B
                  secondary
                  onClick={(e) =>
                    e.currentTarget
                      .closest(".approval")
                      ?.replaceChildren(document.createTextNode("Approved"))
                  }
                >
                  Approve
                </B>
                <B>Decline</B>
              </div>
            </div>
            <div className="row attention">
              <MessageCircleQuestion size={16} />
              <h3>One question</h3>
            </div>
            <p style={{ marginTop: 10 }}>
              Should existing customers keep their current pricing?
            </p>
            <div className="row">
              <B secondary>Keep current pricing</B>
              <B>Review options</B>
            </div>
          </>
        ) : (
          <>
            <p>
              <strong>Keep the entry plan simple.</strong> Most customers need a
              clear starting point, not more tiers.
            </p>
            <p>
              I recommend keeping the current price and moving the usage details
              into a short comparison.
            </p>
            <div className="tool-row">
              <LoaderCircle size={13} className="spin" />
              Drafting recommendations
            </div>
          </>
        )}
      </div>
      <Composer agent />
    </>
  );
}
function PersonalChat({ empty = false, onModel }: { empty?: boolean; onModel?: () => void }) {
  return (
    <>
      {empty ? (
        <div className="empty-chat">
          <OverlayMark size={36} />
          <h1>What’s on your mind?</h1>
          <div className="suggestions">
            <B secondary>Make a plan</B>
            <B secondary>Explore an idea</B>
          </div>
        </div>
      ) : (
        <div className="content chat-body">
          <div className="user-bubble">Help me plan a focused launch week.</div>
          <p>
            Start with one clear outcome: a small group of people using the
            product and telling you what matters.
          </p>
          <h3 style={{ margin: "22px 0 12px" }}>Three priorities</h3>
          <p>
            <strong>1. Make the first minute feel effortless.</strong>
            <br />
            Test sign in and the first conversation on a real phone.
          </p>
          <p>
            <strong>2. Invite a small, thoughtful group.</strong>
            <br />
            Choose people who will give specific feedback.
          </p>
          <p>
            <strong>3. Keep a short feedback loop.</strong>
            <br />
            Review what you learn at the end of each day.
          </p>
          <div className="response-mark">
            <OverlayMark size={24} motion="look" />
          </div>
        </div>
      )}
      <Composer onModel={onModel} />
    </>
  );
}
function Room({ thread = false, recipient = "#product" }: { thread?: boolean; recipient?: string }) {
  return (
    <>
      <div className="content chat-body">
        <div className="row" style={{marginBottom:18,fontSize:13}}>{thread ? <MessageSquare size={15}/> : recipient.startsWith('#') ? <Hash size={15}/> : <Avatar name={recipient} size={18}/>}<strong>{thread ? 'Thread' : recipient.replace(/^#/, '')}</strong>{thread && <small>in #product</small>}</div>
        <div className="muted" style={{ textAlign: "center", fontSize: 11 }}>
          Today
        </div>
        <div className="room-message">
          <Avatar name="Divyansh" />
          <div>
            <div className="room-name">Divyansh Lalwani · 10:32</div>
            <div className="bubble">
              The mobile beta is ready for a final pass. Can we check onboarding
              today?
            </div>
            <div className="reactions">
              <span className="pill">
                <ThumbsUp size={12} />2
              </span>
              <span className="pill">
                <Check size={12} />1
              </span>
            </div>
            {!thread && (
              <div className="thread-link">
                3 replies · Last reply 2 min ago
              </div>
            )}
          </div>
        </div>
        <div className="room-message self">
          <Avatar name="Builder" />
          <div>
            <div className="room-name">Builder · 10:34</div>
            <div className="bubble">
              I’ll test the flow and share a short checklist here.
            </div>
          </div>
        </div>
        <div className="room-message">
          <Avatar name="Scout" />
          <div>
            <div className="room-name">Scout · 10:35</div>
            <div className="bubble">
              I can review the welcome email and first run copy.
            </div>
          </div>
        </div>
      </div>
      <Composer recipient={recipient} />
    </>
  );
}
function AgentDetails() {
  const [tab, set] = React.useState("Details");
  return (
    <>
      <div className="row" style={{ gap: 14, margin: "10px 0 18px" }}>
        <Avatar size={52} />
        <div>
          <h1>Overlay</h1>
          <small>Your AI Chief of Staff.</small>
        </div>
      </div>
      <Tabs items={["Details", "Library", "Computer"]} onChange={set} />
      {tab === "Details" ? (
        <>
          <p className="muted copy" style={{ margin: "20px 0" }}>
            Keeps work moving, connects the dots, and brings you in when it
            matters.
          </p>
          <div className="meta-row">
            <span>Model</span>
            <span>Auto</span>
          </div>
          <div className="meta-row">
            <span>Access</span>
            <span>Workspace</span>
          </div>
          <div className="meta-row">
            <span>Tools</span>
            <span>8 enabled</span>
          </div>
        </>
      ) : tab === "Library" ? (
        <>
          <Row icon={FileText} title="Pricing notes" sub="Updated today" />
          <Row
            icon={FileText}
            title="Launch checklist"
            sub="Updated yesterday"
          />
        </>
      ) : null}
      <div className="sheet-card">
        <div className="row">
          <Circle size={10} className="success" />
          <h3>Computer ready</h3>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "10px 0" }}>
          Open on web to view the desktop
        </p>
        <B secondary icon={ExternalLink}>
          Open on web
        </B>
      </div>
    </>
  );
}
function ModelPicker() {
  const [q, setQ] = React.useState("");
  return (
    <>
      <Tabs items={["Text", "Image", "Video"]} />
      <div className="search-field">
        <Search size={15} />
        <Input
          className="field"
          placeholder="Search models"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="model-row" style={{ margin: "12px 0" }}>
        <Sparkles size={15} />
        <span className="grow">Auto</span>
        <Check size={14} />
      </div>
      <div className="model-list">
        <div className="provider-rail">
          <Star size={16} />
          <ProviderLogo provider="anthropic" size={16} />
          <ProviderLogo provider="openai" size={16} />
          <ProviderLogo provider="google" size={16} />
        </div>
        <div className="models">
          {[
            ["Favorites", "Claude Opus 4.6", "GPT-5.4"],
            ["Anthropic", "Claude Opus 4.6", "Claude Sonnet 4.6"],
            ["OpenAI", "GPT-5.4", "GPT-5.4 mini"],
            ["Google", "Gemini 3.1 Pro"],
          ].map(([provider, ...models]) => (
            <div key={provider}>
              <div className="label row">{provider !== "Favorites" && <ProviderLogo provider={provider.toLowerCase()} size={14} />}{provider}</div>
              {models
                .filter((m) => m.toLowerCase().includes(q.toLowerCase()))
                .map((m) => (
                  <div className="model-row" key={m}>
                    <Star
                      size={12}
                      fill={provider === "Favorites" ? "currentColor" : "none"}
                      className="muted"
                    />
                    <span className="grow">{m}</span>
                    <span className="cap">
                      <ScanEye size={11} />
                    </span>
                    <span className="cap">
                      <Sparkles size={11} />
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
function SettingsContent({ screen, navigate }: { screen: string; navigate: (screen: string) => void }) {
  return (
    <div className="content">
      <h1 style={{ marginBottom: 24 }}>
        {screens.find((s) => s[0] === screen)?.[1]}
      </h1>
      {screen === "settings" ? (
        <div className="settings-nav">
          {settingPages.map(([title, icon, id]) => (
            <Row
              key={id}
              title={title}
              icon={icon}
              onClick={() => navigate(id)}
            />
          ))}
        </div>
      ) : screen === "memories" ? (
        <>
          <p className="muted copy">What Overlay remembers about you.</p>
          <div className="label">Personal</div>
          {[
            "Keep updates concise and actionable.",
            "Use British English in customer emails.",
            "I prefer focused work in the morning.",
          ].map((t) => (
            <Row
              key={t}
              title={t}
              right={<I icon={MoreHorizontal} label="Memory options" />}
            />
          ))}
          <B secondary icon={Plus}>
            Add memory
          </B>
        </>
      ) : screen === "members" ? (
        <>
          <div className="row spaced">
            <small>LayerNorm · 3 members</small>
            <B secondary icon={Plus}>
              Invite
            </B>
          </div>
          <Row
            title="Divyansh Lalwani"
            sub="divyansh@layernorm.com"
            right={<span className="pill">Owner</span>}
          >
            <Avatar name="Divyansh" />
          </Row>
          <Row
            title="Anika Shah"
            sub="anika@layernorm.com"
            right={<span className="pill">Member</span>}
          />
          <Row
            title="Alex Chen"
            sub="alex@layernorm.com"
            right={<span className="pill">Member</span>}
          />
          <div className="label">Invitations</div>
          <Row
            icon={Mail}
            title="sam@layernorm.com"
            sub="Invited today"
            right={<B>Resend</B>}
          />
        </>
      ) : screen === "models" ? (
        <>
          <Field label="Default model" value="Auto" />
          <div className="label">Subscription connections</div>
          <Row
            icon={Bot}
            title="Claude"
            sub="Connected"
            right={<span className="pill">Active</span>}
          />
          <Row
            icon={Zap}
            title="ChatGPT"
            sub="Not connected"
            right={<B secondary>Connect</B>}
          />
          <div className="label">API connections</div>
          <Row icon={KeyIcon} title="Anthropic" sub="Workspace key" />
          <B secondary icon={Plus}>
            Add connection
          </B>
        </>
      ) : screen === "billing" ? (
        <>
          <div className="sheet-card">
            <small>Current plan</small>
            <h1 style={{ margin: "10px 0" }}>Pro</h1>
            <small>LayerNorm workspace</small>
          </div>
          <div className="meta-row">
            <span>Available balance</span>
            <strong>$42.80</strong>
          </div>
          <div className="meta-row">
            <span>Renews</span>
            <span>November 15</span>
          </div>
          <p className="muted copy" style={{ margin: "24px 0" }}>
            Manage your plan and payment details on the web.
          </p>
          <B secondary icon={ExternalLink}>
            Manage on getoverlay.io
          </B>
        </>
      ) : screen === "notifications" ? (
        <>
          <p className="muted copy">Choose what brings you back.</p>
          {[
            ["Needs your input", "Approvals and questions"],
            ["Task completions", "When your agents finish"],
            ["Mentions and replies", "Your conversations"],
            ["Daily summary", "A quiet recap"],
          ].map(([a, b], i) => (
            <Row
              key={a}
              title={a}
              sub={b}
              right={<Toggle initial={i !== 3} />}
            />
          ))}
        </>
      ) : screen === "voice" ? (
        <>
          <Row
            icon={Mic}
            title="Voice input"
            sub="Transcribe messages"
            right={<Toggle />}
          />
          <div className="label">Transcription</div>
          <div className="meta-row">
            <span>Language</span>
            <span>Auto detect</span>
          </div>
          <div className="meta-row">
            <span>Keep recordings</span>
            <span>7 days</span>
          </div>
          <Row
            icon={Volume2}
            title="Read responses aloud"
            right={<Toggle initial={false} />}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 24 }}>
            Microphone access is requested when you start recording.
          </p>
        </>
      ) : screen === "account" ? (
        <>
          <div className="account-hero">
            <Avatar name="Divyansh" />
            <h2>Divyansh Lalwani</h2>
            <small>divyansh@layernorm.com</small>
            <div>
              <B>Change photo</B>
            </div>
          </div>
          <div className="stack">
            <Field label="Name" value="Divyansh Lalwani" />
            <Field label="Email" value="divyansh@layernorm.com" />
            <B secondary>Save changes</B>
          </div>
          <div style={{ marginTop: 30 }}>
            <Row title="Sign out" icon={ArrowLeft} />
            <Row
              title="Delete account"
              icon={Trash2}
              right={<ChevronRight size={14} />}
            />
          </div>
        </>
      ) : (
        <>
          <Row icon={CircleHelp} title="Help centre" sub="Guides and answers" />
          <Row icon={Mail} title="Contact support" sub="We’re here to help" />
          <div className="label">Report a bug</div>
          <div className="stack">
            <Field
              label="What happened?"
              multiline
              placeholder="Tell us what went wrong"
            />
            <B secondary icon={Paperclip}>
              Attach screenshot
            </B>
            <B secondary>Send report</B>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 30 }}>
            Overlay for iOS · 1.0.0
          </p>
        </>
      )}
    </div>
  );
}
const KeyIcon = Shield;
function OtherContent({ screen, navigate }: { screen: string; navigate: (screen: string) => void }) {
  if (screen === "task-detail")
    return (
      <div className="content">
        <div className="row muted" style={{ fontSize: 12, marginBottom: 16 }}>
          <TaskStatus status="review" />
          Ready for review
        </div>
        <h1>Review subscription pricing</h1>
        <p className="muted copy" style={{ margin: "18px 0" }}>
          Compare our plans with the market and recommend a simpler structure.
        </p>
        {[
          [
            "Assignee",
            <span key="assignee" className="row">
              <Avatar />
              Overlay
            </span>,
          ],
          ["Due", "Today"],
          ["Started", "October 16"],
          ["Blocked by", "Nothing"],
        ].map(([a, b], i) => (
          <div className="meta-row" key={i}>
            <span>{a}</span>
            <span>{b}</span>
          </div>
        ))}
        <div className="row" style={{ marginTop: 18 }}>
          <B secondary icon={Check}>
            Mark done
          </B>
          <B icon={MessageSquare} onClick={() => navigate("agent-stream")}>
            View thread
          </B>
        </div>
        <div className="label">Activity</div>
        <div className="event">
          <Avatar />
          <div>
            <p>Overlay submitted this task for review.</p>
            <small>8 minutes ago</small>
          </div>
        </div>
        <div className="event">
          <Avatar name="Divyansh" />
          <div>
            <p>You assigned this to Overlay.</p>
            <small>Today at 10:12</small>
          </div>
        </div>
      </div>
    );
  if (screen === "agent-editor")
    return (
      <div className="content">
        <h1 style={{ marginBottom: 24 }}>Edit agent</h1>
        <div className="stack">
          <div className="row">
            <Avatar name="Scout" size={48} />
            <B secondary>Change appearance</B>
          </div>
          <Field label="Name" value="Scout" />
          <Field
            label="Description"
            value="Research and thoughtful recommendations."
            multiline
          />
          <div>
            <label className="field-label">Model</label>
            <B
              className="full"
              secondary
              onClick={() => navigate("model-picker")}
            >
              Claude Sonnet 4.6
              <ChevronDown size={14} />
            </B>
          </div>
        </div>
        <div className="label">Tools and permissions</div>
        {([
          ["Web search", Search],
          ["Files", Folder],
          ["Run commands", Shield],
        ] as [string, LucideIcon][]).map(([t, Icon]) => (
          <Row title={t} key={t} icon={Icon} right={<Toggle />} />
        ))}
        <B secondary className="full" style={{ marginTop: 24 }}>
          Save changes
        </B>
      </div>
    );
  if (screen === "activity")
    return (
      <div className="content">
        <h1 style={{ marginBottom: 22 }}>Activity</h1>
        <Tabs items={["All", "Unread", "Mentions", "Threads"]} />
        <div className="label">Today</div>
        {[
          ["Overlay", "Pricing review is ready", "8 min ago"],
          ["Scout", "Needs your input", "12 min ago"],
          ["Divyansh", "Mentioned you in # product", "24 min ago"],
          ["Builder", "Replied to your thread", "1 hour ago"],
        ].map(([name, title, time], i) => (
          <div
            key={title}
            className={"event notification " + (i < 2 ? "unread" : "")}
          >
            <Avatar name={name} />
            <div className="grow">
              <h3>{title}</h3>
              <small>
                {name} · {time}
              </small>
            </div>
            {i < 2 && <span className="unread-dot" />}
          </div>
        ))}
      </div>
    );
  if (screen === "files")
    return (
      <div className="content">
        <div className="row spaced" style={{ marginBottom: 20 }}>
          <h1>Files</h1>
          <I icon={Plus} label="Add file" />
        </div>
        <div className="search-field">
          <Search size={15} />
          <Input className="field" placeholder="Search files" />
        </div>
        <div className="label">Folders</div>
        <div className="file-grid">
          {["Launch", "Brand"].map((n) => (
            <div className="folder-card" key={n}>
              <Folder size={23} className="muted" />
              <h3>{n}</h3>
              <small>4 files</small>
            </div>
          ))}
        </div>
        <div className="label">Recent</div>
        <Row
          icon={FileText}
          title="Launch checklist"
          sub="Note · Edited 2 hours ago"
          onClick={() => navigate("note")}
        />
        <Row
          icon={File}
          title="Pricing research.pdf"
          sub="PDF · 1.4 MB"
          onClick={() => navigate("file-preview")}
        />
        <Row icon={Image} title="Mobile preview.png" sub="Image · 842 KB" />
      </div>
    );
  if (screen === "note")
    return (
      <div className="content note">
        <div className="row spaced" style={{ marginBottom: 24 }}>
          <small>Saved just now</small>
          <I icon={MoreHorizontal} label="Note options" />
        </div>
        <div
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Note content"
        >
          <h1 className="note-title">Launch checklist</h1>
          <p className="muted">A focused plan for the mobile beta.</p>
          <h3>Before we invite anyone</h3>
          <p>
            Check the first conversation on a real phone. Keep the path from
            sign in to value short.
          </p>
          <ul>
            <li>Test sign in and workspace access</li>
            <li>Review push notification copy</li>
            <li>Prepare a short feedback form</li>
          </ul>
          <h3>Launch day</h3>
          <p>Invite ten people. Be available. Watch where they hesitate.</p>
        </div>
      </div>
    );
  if (screen === "file-preview")
    return (
      <div className="content">
        <div className="row spaced">
          <div>
            <h2>Pricing research.pdf</h2>
            <small>1.4 MB · 6 pages</small>
          </div>
          <I icon={Download} label="Download file" />
        </div>
        <div className="file-paper">
          <small>LAYERNORM / RESEARCH</small>
          <h2 style={{ marginTop: 24 }}>A simpler starting point</h2>
          <p>
            Pricing should make it easy to begin. The best plans connect a clear
            outcome with predictable usage.
          </p>
          <h3>What customers told us</h3>
          <p>
            “I want to know what I can accomplish, not how many features are
            included.”
          </p>
          <p>
            Our recommendation is to keep the first plan focused and move the
            details into a concise comparison.
          </p>
          <small>1 / 6</small>
        </div>
      </div>
    );
  if (screen === "automations")
    return (
      <div className="content">
        <div className="row spaced">
          <h1>Automations</h1>
          <I icon={Plus} label="New automation" />
        </div>
        <div className="label">Active</div>
        <Row
          icon={Workflow}
          title="Morning briefing"
          sub="Weekdays at 8:00 AM"
          onClick={() => navigate("automation-detail")}
          right={<span className="pill">Active</span>}
        />
        <Row
          icon={Workflow}
          title="Weekly feedback digest"
          sub="Fridays at 4:00 PM"
        />
        <div className="label">Paused</div>
        <Row
          icon={Workflow}
          title="Release notes"
          sub="On demand"
          right={<span className="pill">Paused</span>}
        />
      </div>
    );
  if (screen === "automation-detail")
    return (
      <div className="content">
        <h1>Morning briefing</h1>
        <p className="muted copy" style={{ margin: "14px 0 20px" }}>
          The essentials for your day, prepared by Overlay.
        </p>
        <div className="meta-row">
          <span>Schedule</span>
          <span>Weekdays · 8:00 AM</span>
        </div>
        <div className="meta-row">
          <span>Agent</span>
          <span className="row">
            <Avatar />
            Overlay
          </span>
        </div>
        <div className="sheet-card">
          <div className="row">
            <LoaderCircle size={14} className="spin" />
            <h3>Preparing today’s briefing</h3>
          </div>
          <div className="live-track" />
          <small>Reviewing your calendar and active work</small>
        </div>
        <div className="row">
          <B secondary icon={ArrowUp}>
            Run now
          </B>
          <B>Pause</B>
        </div>
        <div className="label">Run history</div>
        {["Today, 8:00 AM", "Yesterday, 8:00 AM", "Oct 14, 8:00 AM"].map(
          (t) => (
            <Row key={t} icon={Check} title={t} sub="Completed · 42 seconds" />
          ),
        )}
      </div>
    );
  if (screen === "search")
    return (
      <div className="content">
        <div className="search-field">
          <Search size={15} />
          <Input
            className="field"
            defaultValue="launch"
            aria-label="Search workspace"
          />
        </div>
        <div style={{ marginTop: 18 }}>
          <Tabs items={["All", "Work", "Chats", "Files"]} />
        </div>
        <div className="label">Work</div>
        <Row
          icon={ListChecks}
          title="Ship the mobile beta"
          sub="Builder · In progress"
        />
        <div className="label">Files</div>
        <Row
          icon={FileText}
          title="Launch checklist"
          sub="Edited 2 hours ago"
        />
        <div className="label">Messages</div>
        <Row
          icon={Hash}
          title="product"
          sub="The mobile beta is ready for a final pass."
        />
        <div className="label">Mention someone</div>
        <Row title="Scout" sub="Agent">
          <Avatar name="Scout" />
        </Row>
        <Row title="Divyansh Lalwani" sub="Member">
          <Avatar name="Divyansh" />
        </Row>
      </div>
    );
  return <WorkList navigate={navigate} />;
}
function Phone({ initial, dark }: { initial: string; dark: boolean }) {
  const [screen, setScreen] = React.useState(initial);
  const [recipient, setRecipient] = React.useState("#product");
  const [drawer, setDrawer] = React.useState(initial.endsWith("drawer"));
  const [panel, setPanel] = React.useState(
    initial === "chats-drawer" ? "Chats" : "Agents",
  );
  const [scope, setScope] = React.useState("workspace");
  const navigate = (s: string) => {
    setScreen(s);
    setDrawer(s.endsWith("drawer"));
  };
  const openRoom = (name: string) => {
    setRecipient(name);
    navigate("channel");
  };
  const settings =
    settingPages.some((p) => p[2] === screen) || screen === "settings";
  const title = settings
    ? "Settings"
    : screen.includes("agent")
      ? "Agents"
      : screen.includes("chat") ||
          screen === "channel" ||
          screen === "model-picker" ||
          screen === "message-thread"
        ? "Chats"
        : ["files", "note", "file-preview"].includes(screen)
          ? "Files"
          : screen.includes("automation")
            ? "Automations"
            : screen === "activity"
              ? "Activity"
              : screen === "search"
                ? "Search"
                : "Work";
  const sheet = [
    "account-sheet",
    "new-task",
    "agent-details",
    "model-picker",
    "message-thread",
    "push-permission",
  ].includes(screen);
  const entry = ["boot", "sign-in", "workspace-gate"].includes(screen);
  return (
    <div className={"phone mobile-sidebar-layout" + (dark ? " dark" : "")} data-theme={dark ? "dark" : "light"}>
      <div className="status-bar">
        <span>9:41</span>
        <div className="status-icons">
          <Signal size={15} />
          <Wifi size={15} />
          <BatteryFull size={21} />
        </div>
      </div>
      {entry ? (
        <>
          {screen === "boot" ? (
            <div className="auth boot">
              <BrandLockup />
              <p className="tagline">Your AI Chief of Staff.</p>
              <div className="opening">
                <LoaderCircle size={14} className="spin" />
                Opening Workspace…
              </div>
            </div>
          ) : screen === "sign-in" ? (
            <div className="auth">
              <BrandLockup />
              <div>
                <h1>Welcome back</h1>
                <p className="muted" style={{ marginTop: 8 }}>
                  Sign in to your workspace.
                </p>
              </div>
              <div className="stack">
                <Field label="Email" value="divyansh@layernorm.com" />
                <Field
                  label="Password"
                  type="password"
                  placeholder="Enter your password"
                />
                <B
                  secondary
                  className="full"
                  onClick={() => navigate("work-list")}
                >
                  Sign in
                </B>
                <B>Forgot password?</B>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <B secondary className="full">
                  Continue with Google
                </B>
                <B secondary className="full">
                  Continue with Apple
                </B>
                <B className="full">Sign in with SSO</B>
              </div>
            </div>
          ) : (
            <div className="auth">
              <OverlayMark size={36} />
              <h1>
                Bring your workspace
                <br />
                with you.
              </h1>
              <p className="muted copy">
                Set up your workspace on getoverlay.io, then come back and sign
                in.
              </p>
              <B secondary icon={ExternalLink}>
                Open getoverlay.io
              </B>
              <B onClick={() => navigate("sign-in")}>Use another account</B>
            </div>
          )}
        </>
      ) : (
        <div className={"mobile-shell " + (drawer ? "drawer-open" : "")}>
          <div className="workspace-navigation">
            <DoubleSidebar
              brand={<OverlayMark size={24} />}
              railBrand={<OverlayMark size={24} />}
              title={panel}
              themePreset={dark ? "default-dark" : "default-light"}
              collapsed={false}
              onCollapsedChange={() => setDrawer(false)}
              panelKind={panel === "Agents" ? "agents" : "chat"}
              scope={scope as React.ComponentProps<typeof DoubleSidebar>["scope"]}
              onSearch={() => navigate("search")}
              panelAction={{
                label: panel === "Agents" ? "New agent" : "New chat",
                onClick: () =>
                  navigate(panel === "Agents" ? "agent-editor" : "new-chat"),
              }}
              panelNav={{
                activeId: scope,
                onSelect: (id) => setScope(id),
                items: [
                  { id: "personal", label: "Personal" },
                  { id: "workspace", label: "Workspace" },
                ],
              }}
              items={([
                ["Work", ListChecks, "work-list"],
                ["Agents", Bot, "agents-drawer"],
                ["Chats", MessageSquare, "chats-drawer"],
                ["Files", Folder, "files"],
                ["Automations", Workflow, "automations"],
              ] as [string, LucideIcon, string][]).map(([label, icon, target]) => ({
                id: label,
                label,
                icon,
                active: panel === label,
                onSelect: () => {
                  setPanel(label);
                  if (label === "Agents" || label === "Chats") setDrawer(true);
                  else navigate(target);
                },
              }))}
              footerItems={[
                {
                  id: "activity",
                  label: "Activity",
                  icon: Activity,
                  onSelect: () => navigate("activity"),
                },
                {
                  id: "settings",
                  label: "Settings",
                  icon: Settings,
                  onSelect: () => navigate("settings"),
                },
              ]}
              account={
                <B
                  secondary
                  className="drawer-account"
                  aria-label="Workspace and account"
                  onClick={() => navigate("account-sheet")}
                >
                  DL
                </B>
              }
            >
              {panel === "Agents" ? (
                <>
                  {["Overlay", "Scout", "Builder"].map((name, i) => (
                    <React.Fragment key={name}>
                      <div className="agent-line">
                        <Avatar name={name} size={25} />
                        <div className="grow">
                          {name}
                          <small>
                            {i === 0
                              ? "2 working · 1 ready"
                              : i === 1
                                ? "Needs you"
                                : "1 working"}
                          </small>
                        </div>
                        <I icon={Plus} label={"New " + name + " thread"} />
                        <ChevronDown size={12} />
                      </div>
                      <div className="thread-list">
                        {(i === 0
                          ? [
                              ["Review subscription pricing", "working"],
                              ["Test the onboarding flow", "working"],
                              ["Research customer feedback", "ready"],
                              ["Draft release notes", "done"],
                            ]
                          : i === 1
                            ? [["Confirm research scope", "question"]]
                            : [["Build the mobile beta", "working"]]
                        ).map(([text, state]) => (
                          <B
                            key={text}
                            className="thread-row"
                            onClick={() =>
                              navigate(
                                state === "question"
                                  ? "agent-approval"
                                  : "agent-stream",
                              )
                            }
                          >
                            {state === "working" ? (
                              <LoaderCircle
                                size={13}
                                className="thread-status spin"
                              />
                            ) : state === "question" ? (
                              <MessageCircleQuestion
                                size={13}
                                className="thread-status question"
                              />
                            ) : (
                              <Check
                                size={13}
                                className={
                                  "thread-status " +
                                  (state === "ready" ? "ready" : "")
                                }
                              />
                            )}
                            <span>{text}</span>
                          </B>
                        ))}
                      </div>
                    </React.Fragment>
                  ))}
                </>
              ) : (
                <>
                  <div className="panel-label">Personal chats</div>
                  {[
                    "Launch week plan",
                    "A better morning routine",
                    "Naming ideas",
                  ].map((t) => (
                    <B
                      key={t}
                      className="thread-row"
                      onClick={() => navigate("chat-stream")}
                    >
                      <MessageSquare size={14} />
                      <span>{t}</span>
                    </B>
                  ))}
                  <div className="panel-label">Channels</div>
                  {["product", "general", "design"].map((t, i) => (
                    <B
                      key={t}
                      className="thread-row"
                      onClick={() => openRoom("#" + t)}
                    >
                      <Hash size={14} />
                      <span>{t}</span>
                      {i === 0 && <span className="badge">3</span>}
                    </B>
                  ))}
                  <div className="panel-label">Direct messages</div>
                  <B className="thread-row" onClick={() => openRoom("Scout")}>
                    <Avatar name="Scout" size={18} />
                    Scout<span className="badge">1</span>
                  </B>
                  <B className="thread-row" onClick={() => openRoom("Divyansh Lalwani")}>
                    <Avatar name="Divyansh" size={18} />
                    Divyansh Lalwani
                  </B>
                </>
              )}
            </DoubleSidebar>
            <div className="drawer-close">
              <I
                icon={X}
                label="Close drawer"
                onClick={() => setDrawer(false)}
              />
            </div>
          </div>
          <main className="app-main">
            <header className="screen-header">
              <I
                icon={PanelLeft}
                label="Open sidebar"
                onClick={() => {
                  setPanel(title === "Chats" ? "Chats" : "Agents");
                  setDrawer(true);
                }}
              />
              {!settings && (
                <>
                  <span className="crumb">
                    {["new-chat", "chat-stream", "model-picker"].includes(
                      screen,
                    )
                      ? "Personal"
                      : "Workspace"}
                  </span>
                  <ChevronRight size={12} className="muted" />
                </>
              )}
              <span className="header-title">{title}</span>
              {["agent-stream", "agent-approval", "agent-details"].includes(screen) && (
                <>
                  <ChevronRight size={12} className="muted" />
                  <span className="agent-crumb"><Avatar size={16} />Overlay</span>
                  <ChevronRight size={12} className="muted" />
                  <span className="header-title thread-crumb">Review subscription pricing</span>
                </>
              )}
              {settings && screen !== "settings" && (
                <>
                  <ChevronRight size={12} className="muted" />
                  <span className="header-title">
                    {screens.find((s) => s[0] === screen)?.[1]}
                  </span>
                </>
              )}
              <span className="grow" />
              <I
                icon={screen === "agent-stream" ? MoreHorizontal : Search}
                label="Search or options"
                onClick={() => navigate("search")}
              />
            </header>
            {screen === "offline" && (
              <div className="offline">
                <WifiOff size={13} />
                You’re offline. Changes will sync when connected.
              </div>
            )}
            {screen === "agent-stream" || screen === "agent-approval" || screen === "agent-details" ? (
              <AgentThread approval={screen === "agent-approval"} />
            ) : ["new-chat", "chat-stream", "model-picker"].includes(screen) ? (
              <PersonalChat
                empty={screen === "new-chat" || screen === "model-picker"}
                onModel={() => navigate("model-picker")}
              />
            ) : screen === "channel" || screen === "message-thread" ? (
              <Room thread={screen === "message-thread"} recipient={recipient} />
            ) : settings ? (
              <SettingsContent screen={screen} navigate={navigate} />
            ) : (
              <OtherContent screen={screen} navigate={navigate} />
            )}
          </main>
        </div>
      )}
      {sheet && !drawer && (
        <Sheet
          title={
            screen === "account-sheet"
              ? "Workspace and account"
              : screen === "new-task"
                ? "New task"
                : screen === "agent-details"
                  ? ""
                  : screen === "model-picker"
                    ? "Choose a model"
                    : screen === "message-thread"
                      ? "Message actions"
                      : "Stay in the loop"
          }
          onClose={() =>
            navigate(
              screen === "model-picker"
                ? "new-chat"
                : screen === "message-thread"
                  ? "channel"
                  : "work-list",
            )
          }
        >
          {screen === "account-sheet" ? (
            <>
              <div className="row" style={{ marginBottom: 22 }}>
                <Avatar name="Divyansh" />
                <div>
                  <h3>Divyansh Lalwani</h3>
                  <small>divyansh@layernorm.com</small>
                </div>
              </div>
              <div className="label">Workspaces</div>
              <Row
                title="LayerNorm"
                sub="Pro workspace"
                right={<Check size={16} />}
              />
              <Row title="Personal" sub="Your private workspace" />
              <div className="label">Account</div>
              <Row
                icon={Settings}
                title="Settings"
                onClick={() => navigate("settings")}
              />
              <Row
                icon={ArrowLeft}
                title="Sign out"
                onClick={() => navigate("sign-in")}
              />
            </>
          ) : screen === "new-task" ? (
            <>
              <Tabs items={["Task", "Details"]} />
              <div className="sheet-card">
                <div
                  className="row"
                  style={{ gap: 5, flexWrap: "wrap", marginBottom: 12 }}
                >
                  <B icon={User}>Assignee</B>
                  <B icon={CalendarDays}>Schedule</B>
                  <B icon={GitFork}>Depends on</B>
                </div>
                <Textarea
                  className="field"
                  aria-label="Task title"
                  placeholder="What needs to be done?"
                  defaultValue="Draft the mobile launch checklist"
                />
                <div className="row" style={{ marginTop: 12 }}>
                  <Avatar />
                  <small>Overlay</small>
                  <span className="grow" />
                  <B secondary onClick={() => navigate("task-detail")}>
                    Create task
                    <ArrowUp size={14} />
                  </B>
                </div>
              </div>
              <small>Assigning does not start work.</small>
            </>
          ) : screen === "agent-details" ? (
            <AgentDetails />
          ) : screen === "model-picker" ? (
            <ModelPicker />
          ) : screen === "message-thread" ? (
            <>
              <div
                className="row"
                style={{ justifyContent: "space-around", marginBottom: 14 }}
              >
                {[ThumbsUp, Check, Smile, Star].map((Icon, i) => (
                  <I key={i} icon={Icon} label={"React " + i} />
                ))}
              </div>
              {([
                ["Reply in thread", MessageSquare],
                ["Pin message", Pin],
                ["Save message", Bookmark],
                ["Edit message", Pencil],
                ["Delete message", Trash2],
              ] as [string, LucideIcon][]).map(([t, Icon]) => (
                <Row key={t} title={t} icon={Icon} />
              ))}
            </>
          ) : (
            <>
              <Bell
                size={38}
                strokeWidth={1.25}
                style={{ margin: "4px 0 18px" }}
              />
              <p className="muted copy">
                Know when your agents need you or your work is ready.
              </p>
              <div className="stack" style={{ marginTop: 24, gap: 8 }}>
                <B
                  secondary
                  className="full"
                  onClick={() => navigate("notifications")}
                >
                  Enable notifications
                </B>
                <B className="full" onClick={() => navigate("work-list")}>
                  Not now
                </B>
              </div>
            </>
          )}
        </Sheet>
      )}
      <div className="home-area" />
    </div>
  );
}
function App() {
  const params = new URLSearchParams(location.hash.slice(1));
  const screen = params.get("screen");
  const [dark, setDark] = React.useState(params.get("theme") === "dark");
  React.useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  if (screen) return <Phone initial={screen} dark={dark} />;
  let n = 0;
  return (
    <div className="gallery">
      <header className="gallery-head">
        <div>
          <h1>Overlay mobile</h1>
          <p>The workspace you know. Made for your phone.</p>
        </div>
        <div className="tabs gallery-theme">
          <B secondary={!dark} onClick={() => setDark(false)}>
            Light
          </B>
          <B secondary={dark} onClick={() => setDark(true)}>
            Dark
          </B>
        </div>
      </header>
      {groups.map(([group, ...items]) => (
        <section key={group as string}>
          <h2>{group as string}</h2>
          <div className="frames">
            {(items as unknown as [string, string][]).map(([id, caption]) => (
              <figure key={id} className="frame" data-screen={id}>
                <Phone initial={id} dark={dark} />
                <figcaption>
                  <span>{String(++n).padStart(2, "0")}</span>
                  {caption}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
