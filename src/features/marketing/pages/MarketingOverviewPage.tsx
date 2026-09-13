'use client'

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AuthBoundary, useAuth } from "@/contexts/AuthContext";
import { LandingThemeProvider } from "@/contexts/LandingThemeContext";
import { MarketingButton } from "@/features/marketing/components/MarketingButton";
import { MarketingFooter } from "@/features/marketing/components/MarketingFooter";
import { ProductAgentsDemo } from "@/features/marketing/components/MarketingShowcase";
import { Reveal } from "@/features/marketing/components/Reveal";
import { StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";
import {
  minimalBody,
  minimalContainer,
  minimalDisplay,
  minimalLabel,
  minimalSection,
  minimalSectionSm,
  minimalSerif,
  minimalTextLink,
} from "@/features/marketing/lib/minimalLayout";
import {
  MARKETING_DEPLOY_URL,
  MARKETING_SALES_URL,
  getMarketingAppHref,
} from "@/shared/marketing/marketing";

const AGENT_LOOP = [
  {
    step: "01",
    title: "Create",
    body: "Describe the agent, pick its model, attach tools and knowledge. A working agent in seconds — no ceremony.",
  },
  {
    step: "02",
    title: "Deploy",
    body: "Run agents on Overlay's cloud or machines you own. They stay online and reachable from anywhere.",
  },
  {
    step: "03",
    title: "Manage",
    body: "Permissions, memory, run history, and spend — one roster for every agent you operate.",
  },
];

const BYO_AGENTS = ["Codex", "Claude Code", "Hermes", "OpenClaw", "Any ACP agent"];

const PLATFORMS = ["Slack", "Telegram", "iMessage", "Discord", "The web"];

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--foreground)]">
      {children}
    </span>
  );
}

function HomeLandingContent() {
  const { isAuthenticated } = useAuth();
  const webAppHref = getMarketingAppHref(isAuthenticated);

  return (
    <StaticMarketingShell>
      <main className="flex-1">
        {/* 1. Hero */}
        <section className={minimalSection()}>
          <div className="mx-auto max-w-4xl text-center">
            <Reveal>
              <h1 className={minimalDisplay()} style={minimalSerif()}>
                The control panel for your AI workforce.
              </h1>
              <p className={`mx-auto mt-8 max-w-2xl ${minimalBody()}`}>
                Create, deploy, and manage your agents in one workspace — or
                bring the ones you already trust. Then put them to work on any
                platform.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <MarketingButton
                  href={webAppHref}
                  variant="primary"
                  arrow="right"
                >
                  Try Overlay
                </MarketingButton>
                <MarketingButton href="/download" variant="secondary" arrow="right">
                  Download for macOS
                </MarketingButton>
                <MarketingButton
                  href={MARKETING_DEPLOY_URL}
                  external
                  variant="ghost"
                  arrow="up-right"
                >
                  Deploy privately
                </MarketingButton>
              </div>
            </Reveal>
          </div>
        </section>

        {/* 2. Product demo */}
        <section id="product" className={`${minimalSectionSm()} scroll-mt-16`}>
          <div className={minimalContainer()}>
            <Reveal>
              <ProductAgentsDemo />
              <div className="mt-8 text-center">
                <Link href="/" className={minimalTextLink()}>
                  Open the live showcase
                  <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
                </Link>
              </div>
            </Reveal>
          </div>
        </section>

        {/* 3. The loop: create, deploy, manage */}
        <section id="agents" className={`${minimalSection()} scroll-mt-16`}>
          <div className="mx-auto max-w-4xl">
            <Reveal>
              <p className={minimalLabel()}>The command center</p>
              <h2
                className="mt-6 text-3xl leading-[1.1] tracking-tight md:text-5xl"
                style={minimalSerif()}
              >
                Agents are a workforce. Run them like one.
              </h2>
              <p className={`mt-8 max-w-2xl ${minimalBody()}`}>
                Overlay is where agents are created, deployed, and managed —
                every one of them under one roof, on infrastructure you
                control.
              </p>
              <div className="mt-14 grid gap-10 sm:grid-cols-3">
                {AGENT_LOOP.map((item) => (
                  <div key={item.step}>
                    <span
                      className="text-sm tabular-nums text-[var(--muted-light)]"
                      style={minimalSerif()}
                    >
                      {item.step}
                    </span>
                    <h3 className="mt-3 text-lg font-medium tracking-tight">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* 4. Bring your own agents */}
        <section className={minimalSection()}>
          <div className="mx-auto max-w-4xl">
            <Reveal>
              <p className={minimalLabel()}>Bring your own</p>
              <h2
                className="mt-6 text-3xl leading-[1.1] tracking-tight md:text-5xl"
                style={minimalSerif()}
              >
                Your agents. Not a subscription to someone else&apos;s.
              </h2>
              <p className={`mt-8 max-w-2xl ${minimalBody()}`}>
                Already running agents you trust? Connect them and manage them
                under the same roof — alongside anything you build in Overlay.
              </p>
              <div className="mt-10 flex flex-wrap gap-2">
                {BYO_AGENTS.map((agent) => (
                  <Chip key={agent}>{agent}</Chip>
                ))}
              </div>
              <p className="mt-6 text-sm leading-7 text-[var(--muted)]">
                Anything that speaks the Agent Client Protocol can plug in.
              </p>
            </Reveal>
          </div>
        </section>

        {/* 5. Connect anywhere */}
        <section id="platforms" className={`${minimalSection()} scroll-mt-16`}>
          <div className="mx-auto max-w-4xl">
            <Reveal>
              <p className={minimalLabel()}>Connect anywhere</p>
              <h2
                className="mt-6 text-3xl leading-[1.1] tracking-tight md:text-5xl"
                style={minimalSerif()}
              >
                Put your agents where work already happens.
              </h2>
              <p className={`mt-8 max-w-2xl ${minimalBody()}`}>
                Overlay doesn&apos;t compete with the platforms people love —
                it&apos;s amplified by them. Deploy the same agents to the
                places your team already talks, and keep one workspace as the
                source of truth.
              </p>
              <div className="mt-10 flex flex-wrap gap-2">
                {PLATFORMS.map((platform) => (
                  <Chip key={platform}>{platform}</Chip>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* 6. Personal by default, multiplayer optional */}
        <section className={minimalSection()}>
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <h2
                className="text-3xl leading-[1.1] tracking-tight md:text-5xl"
                style={minimalSerif()}
              >
                Complete alone. Better together.
              </h2>
              <p className={`mx-auto mt-8 max-w-2xl ${minimalBody()}`}>
                Overlay is a full single-player experience — your agents, your
                workspace, your rules. When you want company, invite people in
                and build agents on shared ground. Multiplayer is optional,
                never required.
              </p>
            </Reveal>
          </div>
        </section>

        {/* 7. Who it's for */}
        <section id="organizations" className={`${minimalSection()} scroll-mt-16`}>
          <div className="mx-auto max-w-4xl">
            <Reveal>
              <div className="grid gap-16 md:grid-cols-2">
                <div>
                  <p className={minimalLabel()}>For individuals</p>
                  <h3
                    className="mt-6 text-2xl tracking-tight md:text-3xl"
                    style={minimalSerif()}
                  >
                    A roster of your own.
                  </h3>
                  <p className={`mt-5 ${minimalBody()}`}>
                    Every agent you create or bring lives in a workspace you
                    own — understandable, customizable, and yours to take with
                    you.
                  </p>
                  <div className="mt-6">
                    <a href={webAppHref} className={minimalTextLink()}>
                      Try Overlay
                      <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
                    </a>
                  </div>
                </div>
                <div>
                  <p className={minimalLabel()}>For organizations</p>
                  <h3
                    className="mt-6 text-2xl tracking-tight md:text-3xl"
                    style={minimalSerif()}
                  >
                    A shared command center.
                  </h3>
                  <p className={`mt-5 ${minimalBody()}`}>
                    Invite the team, share the agent roster, govern spend and
                    access — and deploy on infrastructure you control.
                  </p>
                  <div className="mt-6">
                    <a
                      href={MARKETING_SALES_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={minimalTextLink()}
                    >
                      Talk about private deployment
                      <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
                    </a>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* 8. Closing */}
        <section className={minimalSection()}>
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <h2
                className="text-3xl leading-[1.1] tracking-tight md:text-5xl"
                style={minimalSerif()}
              >
                Own your agents. Own the work they do.
              </h2>
              <p className={`mx-auto mt-6 max-w-xl ${minimalBody()}`}>
                One workspace for the workforce you&apos;re building. Built by
                LayerNorm.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <MarketingButton
                  href={webAppHref}
                  variant="primary"
                  arrow="right"
                >
                  Try Overlay
                </MarketingButton>
                <MarketingButton
                  href={MARKETING_DEPLOY_URL}
                  external
                  variant="secondary"
                  arrow="up-right"
                >
                  Deploy for your organization
                </MarketingButton>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <MarketingFooter />
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
