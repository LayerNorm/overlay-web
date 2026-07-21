import Image from "next/image";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  Code2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Lock,
  MessageSquare,
  Puzzle,
  Search,
  ShieldCheck,
  Workflow,
  Zap,
} from "lucide-react";
import { MARKETING_LOGO_SIZE, marketingSerifStyle } from "@/features/marketing/lib/marketingLayout";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function MarketingBand({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("border-t border-[var(--border)] px-5 py-16 md:px-8 md:py-24", className)}>
      <div className="mx-auto max-w-7xl">{children}</div>
    </section>
  );
}

export function EditorialIntro({
  label,
  title,
  body,
  align = "left",
  className,
}: {
  label?: string;
  title: ReactNode;
  body?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cx(align === "center" ? "mx-auto text-center" : "", "max-w-3xl", className)}>
      {label ? (
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--muted-light)]">{label}</p>
      ) : null}
      <h1
        className="mt-4 text-balance text-5xl leading-[0.95] tracking-tight md:text-7xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {title}
      </h1>
      {body ? <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-[var(--muted)] md:text-lg">{body}</p> : null}
    </div>
  );
}

export function MarketingCtaRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mt-8 flex flex-wrap items-center gap-3", className)}>{children}</div>;
}

export function PrimaryMarketingLink({
  children,
  href,
  external,
}: {
  children: ReactNode;
  href: string;
  external?: boolean;
}) {
  const className =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--button-primary-bg)] px-5 text-sm font-medium text-[var(--button-primary-text)] transition-opacity hover:opacity-90";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
        <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
      </a>
    );
  }

  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export function SecondaryMarketingLink({
  children,
  href,
  external,
}: {
  children: ReactNode;
  href: string;
  external?: boolean;
}) {
  const className =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-5 text-sm font-medium text-[var(--button-secondary-text)] transition-colors hover:bg-[var(--surface-muted)]";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
        <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
      </a>
    );
  }

  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

// Nav items mirror the real app sidebar (DEFAULT_OVERLAY_NAVIGATION in @overlay/app-core):
// Chat, Files, Extensions, Projects, Automations — same icons, same order.
const demoNavItems = [
  { label: "Chat", icon: MessageSquare },
  { label: "Files", icon: FileText },
  { label: "Extensions", icon: Puzzle },
  { label: "Projects", icon: FolderOpen },
  { label: "Automations", icon: Workflow },
];

/**
 * Token-based product workspace mockup. Mirrors the real app layout:
 * w-56 sidebar (SidebarShell), h-9 rounded-md nav items (AppSidebar),
 * rounded-xl send button, rounded-lg composer. All colors come from CSS
 * variables so it responds to light/dark automatically.
 *
 * `tone` forces a specific theme via a scoped `data-theme` wrapper — useful
 * for contrast sections (e.g. a dark demo on a light page). When omitted,
 * the demo inherits the surrounding page theme.
 */
function DemoBrandMark() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
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
  );
}

/**
 * Token-based product workspace mockup. Mirrors the real app layout:
 * w-56 sidebar (SidebarShell), h-9 rounded-md nav items (AppSidebar),
 * rounded-xl send button, rounded-lg composer. All colors come from CSS
 * variables so it responds to light/dark automatically.
 *
 * `tone` forces a specific theme via a scoped `data-theme` wrapper — useful
 * for contrast sections (e.g. a dark demo on a light page). When omitted,
 * the demo inherits the surrounding page theme.
 */
export function ProductWorkspaceDemo({
  tone,
  compact = false,
  title = "Hi there!",
}: {
  tone?: "light" | "dark";
  compact?: boolean;
  title?: string;
}) {
  const inner = (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] shadow-[0_18px_60px_var(--overlay-scrim)]">
      <div
        className={cx(
          "grid min-h-[400px]",
          compact
            ? "md:grid-cols-[180px_minmax(0,1fr)]"
            : "md:grid-cols-[224px_minmax(0,1fr)_240px]",
        )}
      >
        {/* Sidebar — mirrors SidebarShell (w-56, border-r, sidebar-surface) */}
        <aside className="hidden border-r border-[var(--border)] bg-[var(--sidebar-surface)] p-2 md:block">
          <DemoBrandMark />
          <div className="mt-4 space-y-0.5">
            {demoNavItems.map((item, index) => (
              <div
                key={item.label}
                className={cx(
                  "flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                  index === 0
                    ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                    : "text-[var(--muted)]",
                )}
              >
                <item.icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
                <span className="ml-2.5">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] p-2">
            <div className="text-[11px] text-[var(--muted-light)]">Recent work</div>
            {["Q1 planning", "Customer analysis", "Worksheet draft"].map((item) => (
              <div key={item} className="mt-2 truncate text-[11px] text-[var(--muted-light)]">
                {item}
              </div>
            ))}
          </div>
        </aside>

        {/* Main content */}
        <div className="min-w-0">
          <div className="flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-elevated)] px-4">
            <div className="text-xs font-medium">New conversation</div>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[11px]">
                GPT-5.4
              </span>
              <span className="hidden rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[11px] sm:inline-flex">
                Tools
              </span>
            </div>
          </div>
          <div className="flex min-h-[340px] flex-col items-center justify-center px-4 py-8">
            <p
              className="text-3xl tracking-tight md:text-4xl"
              style={marketingSerifStyle()}
            >
              {title}
            </p>
            <div className="mt-8 w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
              <p className="text-sm text-[var(--muted-light)]">
                Ask anything, use @ to reference files, memory, tools...
              </p>
              <div className="mt-7 flex items-center justify-between">
                <div className="flex items-center gap-4 text-sm text-[var(--muted)]">
                  <span>+</span>
                  <span>@</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden text-xs text-[var(--muted)] sm:inline">Chat</span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--button-primary-bg)] text-[var(--button-primary-text)]">
                    <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 grid w-full max-w-xl gap-2 sm:grid-cols-2">
              {[
                "Summarize this folder",
                "Create a report",
                "What changed?",
                "Build an automation",
              ].map((prompt) => (
                <div
                  key={prompt}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted)]"
                >
                  {prompt}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right rail — files, memory, connectors */}
        {!compact ? (
          <aside className="hidden border-l border-[var(--border)] bg-[var(--sidebar-surface)] p-3 md:block">
            <RailBlock title="Files" items={["Q1 plan.docx", "Financials.xlsx", "Roadmap.pdf"]} />
            <RailBlock
              title="Memory"
              items={["Project brief", "Customer prefs", "Launch plan"]}
              className="mt-5"
            />
            <div className="mt-5 flex flex-wrap gap-1.5">
              {["Drive", "Notion", "Slack"].map((item) => (
                <span
                  key={item}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-[10px] text-[var(--muted)]"
                >
                  {item}
                </span>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );

  if (tone) {
    return <div data-theme={tone}>{inner}</div>;
  }
  return inner;
}


function RailBlock({ title, items, className }: { title: string; items: string[]; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{title}</p>
        <span className="text-[10px] text-[var(--muted-light)]">View all</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {items.map((item) => (
          <div
            key={item}
            className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-[11px]"
          >
            <span className="truncate">{item}</span>
            <span className="text-[var(--muted-light)]">&gt;</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PricingControlPreview({ amount = "$24" }: { amount?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]">
      <div className="grid border-b border-[var(--border)] text-xs md:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
        {["Capability", "Free", "Paid", "Enterprise"].map((heading) => (
          <div key={heading} className="border-b border-[var(--border)] px-4 py-3 font-medium last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
            {heading}
          </div>
        ))}
      </div>
      {[
        ["AI chat + tools", "Auto", "Premium", "Curated"],
        ["File storage", "10 MB", "Budget based", "Custom"],
        ["Automations", "Basic", "Included", "Governed"],
        ["On-prem/private", "-", "-", "Available"],
      ].map((row) => (
        <div key={row[0]} className="grid border-b border-[var(--border)] text-sm last:border-b-0 md:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
          {row.map((cell, index) => (
            <div key={`${row[0]}-${index}`} className={cx("px-4 py-3 md:border-r md:last:border-r-0", index === 0 ? "text-[var(--foreground)]" : "text-[var(--muted)]")}>
              {cell}
            </div>
          ))}
        </div>
      ))}
      <div className="grid gap-4 border-t border-[var(--border)] bg-[var(--surface-muted)] p-4 md:grid-cols-[1fr_1fr]">
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--muted)]">Monthly budget</span>
            <span className="font-medium">{amount}</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--surface-subtle)]">
            <div className="h-full w-2/3 rounded-full bg-[var(--foreground)]" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-[var(--muted)]">
          {["Models", "Storage", "Runs"].map((item) => (
            <div key={item} className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-2">
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PrincipleGrid() {
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] md:grid-cols-4">
      {[
        { icon: Lock, title: "Private by default", body: "Control data flow, model access, and workspace policy." },
        { icon: Code2, title: "Open source", body: "Inspect, self-host, extend, and adapt the interface." },
        { icon: Bot, title: "Model choice", body: "Route work by quality, speed, cost, and governance." },
        { icon: Zap, title: "Context compounds", body: "Files, notes, memory, and tools stay attached to work." },
      ].map((item) => (
        <article key={item.title} className="bg-[var(--surface-elevated)] p-5">
          <item.icon className="h-5 w-5 text-[var(--foreground)]" strokeWidth={1.7} />
          <h3 className="mt-5 text-sm font-medium">{item.title}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.body}</p>
        </article>
      ))}
    </div>
  );
}

export function ScreenshotFrame({
  src,
  alt,
  label,
  className,
}: {
  src: string;
  alt: string;
  label?: string;
  className?: string;
}) {
  return (
    <figure className={cx("overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]", className)}>
      {label ? (
        <figcaption className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">{label}</figcaption>
      ) : null}
      <Image src={src} alt={alt} width={1440} height={920} className="h-auto w-full" />
    </figure>
  );
}

export function TrustStrip() {
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
      {[
        { icon: ShieldCheck, label: "Private", text: "On-prem or private deployment paths." },
        { icon: Code2, label: "Open", text: "Auditable and extensible codebase." },
        { icon: Search, label: "Grounded", text: "Files, web, and tools in one run." },
        { icon: ImageIcon, label: "Multimodal", text: "Text, image, video, browser, and code." },
      ].map((item) => (
        <div key={item.label} className="flex items-start gap-3 bg-[var(--surface-elevated)] p-4">
          <item.icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <div>
            <p className="text-sm font-medium">{item.label}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CheckList({ items }: { items: string[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <div key={item} className="flex items-start gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)]">
            <Check className="h-3 w-3" strokeWidth={1.9} />
          </span>
          <p className="text-sm leading-6 text-[var(--muted)]">{item}</p>
        </div>
      ))}
    </div>
  );
}
