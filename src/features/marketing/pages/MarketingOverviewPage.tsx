'use client'

/**
 * Landing page — Linear-style product narrative ported from landing-preview.html.
 * The hero recreates the real app shell (rail + secondary panel + agent DM)
 * as an interactive demo; sections use hairline figures and product visuals.
 * Styles live in ../landing.css, scoped under `.landing`.
 */

import { ArrowRight, Bot, Check, Clock, Image as ImageIcon, Globe, Settings, Workflow } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { AuthBoundary, useAuth } from "@/contexts/AuthContext";
import { LandingThemeProvider } from "@/contexts/LandingThemeContext";
import { Creature } from "@/components/orb/Creature";
import {
  BrandLogo,
  LandingAgentField,
  LandingShowcase,
  LandingToast,
  LOGO,
  landingToast,
  type LogoSpec,
} from "@/features/marketing/components/LandingShowcase";
import { MarketingFooter } from "@/features/marketing/components/MarketingFooter";
import { StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";
import {
  MARKETING_DEPLOY_URL,
  MARKETING_DOCS_URL,
  MARKETING_SALES_URL,
  getMarketingAppHref,
} from "@/shared/marketing/marketing";

const rise = (i: number) => ({ "--i": i }) as CSSProperties;

const EXTRA_LOGOS: Record<string, LogoSpec> = {
  copilot: {
    light: "https://svgl.app/library/copilot.svg",
    dark: "https://svgl.app/library/copilot_dark.svg",
  },
  gemini: { light: "https://svgl.app/library/gemini.svg" },
  ollama: {
    light: "https://svgl.app/library/ollama_light.svg",
    dark: "https://svgl.app/library/ollama_dark.svg",
  },
  anthropic: {
    light: "https://svgl.app/library/anthropic_black.svg",
    dark: "https://svgl.app/library/anthropic_white.svg",
  },
  deepseek: { light: "https://svgl.app/library/deepseek.svg" },
  xai: {
    light: "https://svgl.app/library/xai_light.svg",
    dark: "https://svgl.app/library/xai_dark.svg",
  },
  kimi: { light: "https://svgl.app/library/kimi-icon.svg" },
  qwen: {
    light: "https://svgl.app/library/qwen_light.svg",
    dark: "https://svgl.app/library/qwen_dark.svg",
  },
  openrouter: {
    light: "https://svgl.app/library/openrouter_light.svg",
    dark: "https://svgl.app/library/openrouter_dark.svg",
  },
  mistral: { light: "https://svgl.app/library/mistral-ai_logo.svg" },
};

function LearnMore({ href = MARKETING_DOCS_URL }: { href?: string }) {
  return (
    <a
      className="learn-more"
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
    >
      Learn more <ArrowRight size={12} strokeWidth={1.75} />
    </a>
  );
}

function HomeLandingContent() {
  const { isAuthenticated } = useAuth();
  const webAppHref = getMarketingAppHref(isAuthenticated);

  return (
    <StaticMarketingShell>
      <div className="landing">
        <main>
          {/* ============ HERO ============ */}
          <section className="hero">
            <div className="wrap">
              <div className="hero-grid">
                <div>
                  <h1 className="rise" style={rise(0)}>
                    The control panel for your AI workforce.
                  </h1>
                  <p className="hero-sub rise" style={rise(1)}>
                    Create, deploy, and manage your agents in one workspace — or
                    bring the ones you already trust. Then put them to work on
                    any platform.
                  </p>
                  <div className="hero-ctas rise" style={rise(2)}>
                    <Link className="btn btn-primary" href={webAppHref}>
                      Get Started <ArrowRight size={14} strokeWidth={1.75} />
                    </Link>
                    <Link className="btn btn-secondary" href="/download">
                      Download for macOS
                    </Link>
                    <a
                      className="btn btn-ghost"
                      href={MARKETING_DEPLOY_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Deploy privately ↗
                    </a>
                  </div>
                  <p className="hero-assure rise" style={rise(3)}>
                    Free tier included — no card required.
                  </p>
                  <a className="hero-new rise" style={rise(4)} href="#computers">
                    <span className="tag">New</span> Persistent computers for
                    every agent →
                  </a>
                </div>
                <LandingAgentField />
              </div>
            </div>

            <div
              className="wrap hero-shot rise"
              id="product"
              style={rise(6)}
            >
              <LandingShowcase />
            </div>
          </section>

          {/* ============ STATEMENT ============ */}
          <section className="statement">
            <div className="wrap">
              <p>
                A new species of workspace.{" "}
                <span className="dim">
                  Purpose-built for a world where software works for you —
                  Overlay is where your agents live, labor, and answer to you.
                </span>
              </p>
            </div>
          </section>

          {/* ============ FIGURES ============ */}
          <section className="band">
            <div className="wrap">
              <div className="figures">
                <div className="figure">
                  <div className="fig-label">FIG 0.1</div>
                  <div className="art">
                    <svg
                      width="200"
                      height="160"
                      viewBox="0 0 200 160"
                      fill="none"
                      stroke="var(--muted-light)"
                      strokeWidth="1"
                    >
                      <g transform="translate(100,30)">
                        <ellipse cx="0" cy="0" rx="46" ry="20" />
                        <ellipse cx="0" cy="16" rx="58" ry="26" />
                        <ellipse cx="0" cy="32" rx="70" ry="32" />
                        <ellipse cx="0" cy="48" rx="82" ry="38" />
                        <ellipse cx="0" cy="64" rx="94" ry="44" />
                        <circle cx="0" cy="0" r="3" fill="var(--muted-light)" stroke="none" />
                      </g>
                    </svg>
                  </div>
                  <h3>Purpose-built</h3>
                  <p>
                    Shaped by how agents actually work — memory, tools,
                    computers, and reach, not bolted onto a chat box.
                  </p>
                </div>
                <div className="figure">
                  <div className="fig-label">FIG 0.2</div>
                  <div className="art">
                    <svg
                      width="200"
                      height="160"
                      viewBox="0 0 200 160"
                      fill="none"
                      stroke="var(--muted-light)"
                      strokeWidth="1"
                    >
                      <g stroke="var(--muted-light)">
                        <line x1="100" y1="80" x2="45" y2="38" />
                        <line x1="100" y1="80" x2="155" y2="36" />
                        <line x1="100" y1="80" x2="38" y2="112" />
                        <line x1="100" y1="80" x2="162" y2="116" />
                        <line x1="100" y1="80" x2="100" y2="140" />
                        <line x1="45" y1="38" x2="155" y2="36" strokeDasharray="3 4" opacity=".55" />
                        <line x1="38" y1="112" x2="162" y2="116" strokeDasharray="3 4" opacity=".55" />
                      </g>
                      <circle cx="100" cy="80" r="15" fill="var(--background)" />
                      <circle cx="100" cy="80" r="6" fill="var(--muted-light)" stroke="none" />
                      <circle cx="45" cy="38" r="9" fill="var(--background)" />
                      <circle cx="155" cy="36" r="9" fill="var(--background)" />
                      <circle cx="38" cy="112" r="9" fill="var(--background)" />
                      <circle cx="162" cy="116" r="9" fill="var(--background)" />
                      <circle cx="100" cy="140" r="9" fill="var(--background)" />
                    </svg>
                  </div>
                  <h3>Powered by agents</h3>
                  <p>
                    Workflows shared by humans and agents — from answering
                    messages to running whole projects.
                  </p>
                </div>
                <div className="figure">
                  <div className="fig-label">FIG 0.3</div>
                  <div className="art">
                    <svg
                      width="200"
                      height="160"
                      viewBox="0 0 200 160"
                      fill="none"
                      stroke="var(--muted-light)"
                      strokeWidth="1"
                    >
                      <g transform="translate(30,20)">
                        <rect x="0" y="0" width="60" height="100" rx="3" />
                        <rect x="18" y="8" width="60" height="100" rx="3" />
                        <rect x="36" y="16" width="60" height="100" rx="3" />
                        <rect x="54" y="24" width="60" height="100" rx="3" />
                        <rect x="72" y="32" width="60" height="100" rx="3" fill="var(--background)" />
                        <circle cx="102" cy="82" r="3" fill="var(--muted-light)" stroke="none" />
                      </g>
                    </svg>
                  </div>
                  <h3>Designed for momentum</h3>
                  <p>
                    No dashboards for dashboards&apos; sake. The roster, the
                    thread, the work — nothing in between.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ============ AGENTS / DIRECTORY ============ */}
          <section className="band" id="agents">
            <div className="wrap">
              <div className="section-head">
                <h2>One roster for every agent you run</h2>
                <div className="desc">
                  <p>
                    Overlay agents, Codex, Claude Code, Hermes — every agent you
                    create or bring shows up in one directory with its status,
                    reach, and spend. Start work in a click, watch it happen
                    live.
                  </p>
                  <LearnMore />
                </div>
              </div>
              <div className="visual">
                <div className="visual-mask">
                  <div className="agents-visual">
                    <div className="card">
                      <div className="card-head">
                        <Bot size={13} strokeWidth={1.75} style={{ color: "var(--muted)" }} />
                        Agents <span className="right">5 running</span>
                      </div>
                      <button className="agent-row" onClick={() => landingToast("Scout — Overlay agent")}>
                        <span className="cw">
                          <Creature shape="blob" color="#8b5cf6" size={26} animated={false} />
                        </span>
                        <div className="who">
                          <div className="n">Scout</div>
                          <div className="d">Overlay agent · Cloud</div>
                        </div>
                        <span className="reach-chip">
                          <BrandLogo light={LOGO.slack.light} />
                          Slack
                        </span>
                        <span className="reach-chip">
                          <BrandLogo light={LOGO.telegram.light} />
                          Telegram
                        </span>
                        <span className="status">
                          <span className="status-dot" style={{ background: "var(--success)" }} />{" "}
                          Working
                        </span>
                      </button>
                      <button className="agent-row" onClick={() => landingToast("Brief — Overlay agent")}>
                        <span className="cw">
                          <Creature shape="droplet" color="#d97706" size={26} animated={false} />
                        </span>
                        <div className="who">
                          <div className="n">Brief</div>
                          <div className="d">Overlay agent · Cloud</div>
                        </div>
                        <span className="reach-chip">
                          <BrandLogo light={LOGO.apple.light} dark={LOGO.apple.dark} />
                          iMessage
                        </span>
                        <span className="status">
                          <span className="status-dot" style={{ background: "var(--success)" }} />{" "}
                          Running
                        </span>
                      </button>
                      <button className="agent-row" onClick={() => landingToast("Codex — external agent")}>
                        <span className="byo-logo">
                          <BrandLogo light={LOGO.openai.light} dark={LOGO.openai.dark} />
                        </span>
                        <div className="who">
                          <div className="n">Codex</div>
                          <div className="d">Your agent · This Mac</div>
                        </div>
                        <span className="status">
                          <span className="status-dot" style={{ background: "var(--foreground)" }} />{" "}
                          Connected
                        </span>
                      </button>
                      <button className="agent-row" onClick={() => landingToast("Claude Code — external agent")}>
                        <span className="byo-logo">
                          <BrandLogo light={LOGO.claude.light} />
                        </span>
                        <div className="who">
                          <div className="n">Claude Code</div>
                          <div className="d">Your agent · This Mac</div>
                        </div>
                        <span className="status">
                          <span className="status-dot" style={{ background: "var(--foreground)" }} />{" "}
                          Connected
                        </span>
                      </button>
                      <button className="agent-row" onClick={() => landingToast("Hermes — external agent")}>
                        <span className="cw">
                          <Creature shape="cloud" color="#0284c7" size={26} animated={false} />
                        </span>
                        <div className="who">
                          <div className="n">Hermes</div>
                          <div className="d">Your agent · Cloud</div>
                        </div>
                        <span className="reach-chip">
                          <BrandLogo light={LOGO.google.light} />
                          Web
                        </span>
                        <span className="status">
                          <span className="status-dot" style={{ background: "var(--muted-light)" }} />{" "}
                          Idle
                        </span>
                      </button>
                    </div>
                    <div className="card mini-panel">
                      <h4>Reachable on</h4>
                      {[
                        { name: "Slack", logo: LOGO.slack, tail: "2 agents" },
                        { name: "Telegram", logo: LOGO.telegram, tail: "1 agent" },
                        { name: "iMessage", logo: LOGO.apple, tail: "1 agent" },
                        { name: "Discord", logo: LOGO.discord, tail: "soon" },
                      ].map((r) => (
                        <button
                          key={r.name}
                          className="rowitem"
                          onClick={() => landingToast(r.name)}
                        >
                          <BrandLogo light={r.logo.light} dark={r.logo.dark} />
                          <span>{r.name}</span>
                          <span className="tail">{r.tail}</span>
                        </button>
                      ))}
                      <h4 style={{ marginTop: 14 }}>Environments</h4>
                      <button className="rowitem" onClick={() => landingToast("Overlay Cloud")}>
                        <Globe size={13} strokeWidth={1.75} style={{ color: "var(--muted)" }} />
                        <span>Overlay Cloud</span>
                        <span className="tail">3</span>
                      </button>
                      <button className="rowitem" onClick={() => landingToast("This Mac")}>
                        <BrandLogo light={LOGO.apple.light} dark={LOGO.apple.dark} />
                        <span>This Mac</span>
                        <span className="tail">2</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ============ PLATFORMS ============ */}
          <section className="band" id="platforms">
            <div className="wrap">
              <div className="section-head">
                <h2>Put agents where work already happens</h2>
                <div className="desc">
                  <p>
                    Deploy the same agents to Slack, Telegram, iMessage, and the
                    web. Overlay doesn&apos;t compete with the platforms people
                    love — it&apos;s amplified by them.
                  </p>
                  <LearnMore />
                </div>
              </div>
              <div className="visual">
                <div className="visual-mask">
                  <div className="platforms-visual">
                    <div className="card plat-card plat-slack">
                      <div className="card-head">
                        <BrandLogo light={LOGO.slack.light} /> eng-launches{" "}
                        <span className="right">Slack</span>
                      </div>
                      <div className="chat-msg">
                        <div className="av" style={{ background: "#e8b4b8" }} />
                        <div>
                          <div className="who">
                            lena <span className="t">3:35 PM</span>
                          </div>
                          <div className="txt">
                            Can someone summarize the Vektor launch before
                            standup?
                          </div>
                        </div>
                      </div>
                      <div className="chat-msg">
                        <div className="av">
                          <Creature shape="blob" color="#8b5cf6" size={28} animated={false} />
                        </div>
                        <div>
                          <div className="who">
                            Scout <span className="t">3:36 PM · agent</span>
                          </div>
                          <div className="txt">
                            On it — pulling the announcement, the pricing diff,
                            and the HN thread into a brief now.
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="card plat-card plat-imessage">
                      <div className="card-head">
                        <BrandLogo light={LOGO.apple.light} dark={LOGO.apple.dark} />{" "}
                        Brief <span className="right">iMessage</span>
                      </div>
                      <div className="bubble-col">
                        <div className="bubble in">
                          morning — what&apos;s on my calendar?
                        </div>
                        <div className="bubble out">
                          Three meetings. The 10:30 conflicts with the design
                          review — want me to move it?
                        </div>
                        <div className="bubble in">yes, move it to 2</div>
                      </div>
                    </div>
                    <div className="card plat-card plat-telegram">
                      <div className="card-head">
                        <BrandLogo light={LOGO.telegram.light} /> Ledge{" "}
                        <span className="right">Telegram</span>
                      </div>
                      <div className="chat-msg">
                        <div className="av">
                          <Creature shape="hexagon" color="#0ea5e9" size={28} animated={false} />
                        </div>
                        <div>
                          <div className="who">
                            Ledge <span className="t">agent</span>
                          </div>
                          <div className="txt">
                            March reconciliation is done — 214 invoices matched,
                            3 flagged for review in your files.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ============ COMPUTERS ============ */}
          <section className="band" id="computers">
            <div className="wrap">
              <div className="section-head">
                <h2>Every agent gets a real computer</h2>
                <div className="desc">
                  <p>
                    Persistent cloud desktops with signed-in apps, real
                    browsers, and files that stay put. Agents do the kind of
                    work a terminal can&apos;t — and you can watch the screen
                    live.
                  </p>
                  <LearnMore />
                </div>
              </div>
              <div className="visual">
                <div className="visual-mask">
                  <div className="card">
                    <div className="window-bar">
                      <span className="win-dot" />
                      <span className="win-dot" />
                      <span className="win-dot" />
                      <span className="win-title">
                        Scout&apos;s computer — Ubuntu desktop · running for 3
                        days
                      </span>
                    </div>
                    <div className="desktop-body">
                      <div className="desktop-browser">
                        <div className="browser-url">
                          <BrandLogo light={LOGO.google.light} />{" "}
                          vektor.dev/changelog — signed in as scout@yourco.com
                        </div>
                        <div className="browser-page">
                          <div className="skeleton-line" style={{ width: "55%", height: 12 }} />
                          <div className="skeleton-line" style={{ width: "90%", marginTop: 14 }} />
                          <div className="skeleton-line" style={{ width: "80%", marginTop: 8 }} />
                          <div className="skeleton-line" style={{ width: "85%", marginTop: 8 }} />
                          <div className="skeleton-line" style={{ width: "40%", marginTop: 16 }} />
                        </div>
                      </div>
                      <div className="desktop-terminal">
                        <div>
                          <span className="prompt">scout@computer:~$</span>{" "}
                          python3 reconcile.py --month march
                        </div>
                        <div>214 invoices matched · 3 flagged</div>
                        <div>
                          <span className="ok">✓</span> wrote
                          Q2/competitor-brief.md
                        </div>
                        <div>
                          <span className="prompt">scout@computer:~$</span>{" "}
                          <span style={{ opacity: 0.6 }}>▊</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ============ AUTOMATIONS ============ */}
          <section className="band" id="automations">
            <div className="wrap">
              <div className="section-head">
                <h2>Work that runs without you</h2>
                <div className="desc">
                  <p>
                    Schedules, triggers, and durable runs — agents that pick up
                    the job on their own and report back when it&apos;s done.
                  </p>
                  <LearnMore />
                </div>
              </div>
              <div className="visual">
                <div className="visual-mask">
                  <div className="auto-visual">
                    <div className="card">
                      <div className="card-head">
                        <Workflow size={13} strokeWidth={1.75} style={{ color: "var(--muted)" }} />{" "}
                        Weekly competitor digest
                      </div>
                      <div className="kv">
                        <span className="k">Agent</span>
                        <span>Scout</span>
                      </div>
                      <div className="kv">
                        <span className="k">Schedule</span>
                        <span>Mon 9:00 AM</span>
                      </div>
                      <div className="kv">
                        <span className="k">Posts to</span>
                        <span>#eng-launches · Slack</span>
                      </div>
                      <div className="kv">
                        <span className="k">Budget cap</span>
                        <span>$4 / run</span>
                      </div>
                    </div>
                    <div className="card">
                      <div className="card-head">
                        <Clock size={13} strokeWidth={1.75} style={{ color: "var(--muted)" }} />{" "}
                        Recent runs <span className="right">24 total</span>
                      </div>
                      {[
                        { icon: Check, ok: true, text: "Digest posted to Slack", t: "Mon 9:02 AM" },
                        { icon: Check, ok: true, text: "Digest posted to Slack", t: "Last Mon" },
                        {
                          icon: Check,
                          ok: true,
                          text: "3 sources added to knowledge base",
                          t: "Last Mon",
                        },
                        { icon: Clock, ok: false, text: "Next run", t: "in 4 days" },
                      ].map((r, i) => (
                        <div className="run-row" key={i}>
                          <r.icon
                            size={12}
                            strokeWidth={2}
                            style={{
                              color: r.ok ? "var(--success)" : "var(--muted-light)",
                            }}
                          />{" "}
                          {r.text} <span className="t">{r.t}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ============ BYO / LOGO CLOUD ============ */}
          <section className="band">
            <div className="wrap">
              <div className="section-head">
                <h2>Your agents, under one roof</h2>
                <div className="desc">
                  <p>
                    Anything that speaks the Agent Client Protocol plugs in.
                    Bring the harnesses you already trust — and the models you
                    already pay for.
                  </p>
                  <LearnMore />
                </div>
              </div>
              <div className="visual">
                <div className="visual-mask" style={{ paddingBottom: 44 }}>
                  <div className="logo-cloud">
                    <button className="logo-pill" onClick={() => landingToast("Codex — OpenAI")}>
                      <BrandLogo light={LOGO.openai.light} dark={LOGO.openai.dark} />
                      Codex <span className="tagline">OpenAI</span>
                    </button>
                    <button className="logo-pill" onClick={() => landingToast("Claude Code — Anthropic")}>
                      <BrandLogo light={LOGO.claude.light} />
                      Claude Code <span className="tagline">Anthropic</span>
                    </button>
                    <button className="logo-pill" onClick={() => landingToast("Cursor")}>
                      <BrandLogo light={LOGO.cursor.light} dark={LOGO.cursor.dark} />
                      Cursor
                    </button>
                    <button className="logo-pill" onClick={() => landingToast("Windsurf")}>
                      <BrandLogo light={LOGO.windsurf.light} dark={LOGO.windsurf.dark} />
                      Windsurf
                    </button>
                    <button className="logo-pill" onClick={() => landingToast("Copilot — GitHub")}>
                      <BrandLogo light={EXTRA_LOGOS.copilot.light} dark={EXTRA_LOGOS.copilot.dark} />
                      Copilot <span className="tagline">GitHub</span>
                    </button>
                    <button className="logo-pill" onClick={() => landingToast("Gemini CLI — Google")}>
                      <BrandLogo light={EXTRA_LOGOS.gemini.light} />
                      Gemini CLI <span className="tagline">Google</span>
                    </button>
                    <button className="logo-pill" onClick={() => landingToast("Ollama — local")}>
                      <BrandLogo light={EXTRA_LOGOS.ollama.light} dark={EXTRA_LOGOS.ollama.dark} />
                      Ollama <span className="tagline">local</span>
                    </button>
                    <button className="logo-pill" onClick={() => landingToast("Any ACP agent")}>
                      <Bot size={16} strokeWidth={1.75} style={{ color: "var(--muted)" }} />
                      Any ACP agent
                    </button>
                  </div>
                  <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <span
                      className="panel-section-label"
                      style={{ width: "100%", padding: "0 0 2px" }}
                    >
                      bring your own models
                    </span>
                    {(
                      [
                        { name: "OpenAI", logo: LOGO.openai },
                        { name: "Anthropic", logo: EXTRA_LOGOS.anthropic },
                        { name: "Google", logo: LOGO.google },
                        { name: "DeepSeek", logo: EXTRA_LOGOS.deepseek },
                        { name: "xAI", logo: EXTRA_LOGOS.xai },
                        { name: "Kimi", logo: EXTRA_LOGOS.kimi },
                        { name: "Qwen", logo: EXTRA_LOGOS.qwen },
                        { name: "OpenRouter", logo: EXTRA_LOGOS.openrouter },
                        { name: "Mistral", logo: EXTRA_LOGOS.mistral },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.name}
                        className="logo-pill"
                        onClick={() => landingToast(m.name)}
                      >
                        <BrandLogo light={m.logo.light} dark={m.logo.dark} />
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ============ GOVERNANCE ============ */}
          <section className="band">
            <div className="wrap">
              <div className="section-head">
                <h2>Govern the workforce, not just the chat</h2>
                <div className="desc">
                  <p>
                    Permissions, spend limits, run history, and audit trails —
                    the controls a real organization needs over software that
                    acts on its behalf.
                  </p>
                  <LearnMore />
                </div>
              </div>
              <div className="visual">
                <div className="visual-mask">
                  <div className="agents-visual">
                    <div className="card">
                      <div className="card-head">
                        <Settings size={13} strokeWidth={1.6} style={{ color: "var(--muted)" }} />{" "}
                        Workspace controls
                      </div>
                      <div className="kv">
                        <span className="k">Monthly budget</span>
                        <span>$240 · 62% used</span>
                      </div>
                      <div className="kv">
                        <span className="k">Agent spend cap</span>
                        <span>$10 / agent / day</span>
                      </div>
                      <div className="kv">
                        <span className="k">Tool approvals</span>
                        <span>Required outside workspace</span>
                      </div>
                      <div className="kv">
                        <span className="k">Model routing</span>
                        <span>Auto · premium allowed</span>
                      </div>
                      <div className="kv">
                        <span className="k">Audit log</span>
                        <span>Exported daily</span>
                      </div>
                    </div>
                    <div className="img-slot" style={{ minHeight: 230 }}>
                      <ImageIcon size={22} strokeWidth={1.5} />
                      <div>
                        <div className="label">screenshot</div>
                        Spend &amp; usage dashboard
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ============ SOLO / ORGS ============ */}
          <section className="band" id="organizations">
            <div className="wrap">
              <div className="split">
                <div>
                  <div className="label">for individuals</div>
                  <h3>A roster of your own.</h3>
                  <p>
                    Every agent you create or bring lives in a workspace you own
                    — understandable, customizable, and yours to take with you.
                    Complete alone; multiplayer is optional, never required.
                  </p>
                  <Link className="learn-more" href={webAppHref}>
                    Get Started <ArrowRight size={12} strokeWidth={1.75} />
                  </Link>
                </div>
                <div>
                  <div className="label">for organizations</div>
                  <h3>A shared command center.</h3>
                  <p>
                    Invite the team, share the agent roster, govern spend and
                    access — and deploy on infrastructure you control.
                  </p>
                  <a
                    className="learn-more"
                    href={MARKETING_SALES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Talk about private deployment{" "}
                    <ArrowRight size={12} strokeWidth={1.75} />
                  </a>
                </div>
              </div>
            </div>
          </section>

          {/* ============ CLOSE ============ */}
          <section className="band" style={{ paddingBottom: 140 }}>
            <div className="wrap center-close">
              <h2>
                Own your agents.
                <br />
                Own the work they do.
              </h2>
              <p>
                One workspace for the workforce you&apos;re building. Built by
                LayerNorm.
              </p>
              <div className="hero-ctas">
                <Link className="btn btn-primary" href={webAppHref}>
                  Get Started <ArrowRight size={14} strokeWidth={1.75} />
                </Link>
                <a
                  className="btn btn-secondary"
                  href={MARKETING_DEPLOY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Deploy for your organization ↗
                </a>
              </div>
            </div>
          </section>
        </main>
        <MarketingFooter />
        <LandingToast />
      </div>
    </StaticMarketingShell>
  );
}

export default function HomeLandingPage() {
  return (
    <AuthBoundary>
      <LandingThemeProvider>
        <HomeLandingContent />
      </LandingThemeProvider>
    </AuthBoundary>
  );
}
