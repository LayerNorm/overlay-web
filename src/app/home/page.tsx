"use client";

import {
  ArrowRight,
  Eye,
  GraduationCap,
  Lock,
  Plug,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { AuthBoundary, useAuth } from "@/contexts/AuthContext";
import { LandingThemeProvider } from "@/contexts/LandingThemeContext";
import { MarketingButton } from "@/features/marketing/components/MarketingButton";
import { MarketingFooter } from "@/features/marketing/components/MarketingFooter";
import {
  EditorialIntro,
  MarketingBand,
  MarketingCtaRow,
} from "@/features/marketing/components/MarketingShowcase";
import {
  FeatureMiniScene,
  MiniSceneAgents,
  MiniSceneData,
  MiniSceneInfra,
  MiniSceneKnowledge,
  MiniSceneModels,
  MiniSceneWorkflows,
  ProductAppDemo,
} from "@/features/marketing/components/ProductAppDemo";
import { StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";
import {
  marketingDarkBand,
  marketingEyebrow,
  marketingHeadingLg,
  marketingSerifStyle,
  marketingTint,
  type MarketingTint,
} from "@/features/marketing/lib/marketingLayout";
import {
  MARKETING_DEPLOY_URL,
  MARKETING_DOCS_URL,
  MARKETING_GITHUB_URL,
  MARKETING_SALES_URL,
  getMarketingAppHref,
} from "@/shared/marketing/marketing";

const HERO_BULLETS = [
  "Open source",
  "Model-agnostic",
  "Self-hostable",
  "Built for private deployment",
];

const CONTROL_ITEMS = [
  "Which models people use",
  "What knowledge those models can access",
  "Which actions agents can perform",
  "Where organizational data is stored",
  "How every interaction is governed and audited",
];

const FEATURE_CARDS: Array<{
  title: string;
  body: string;
  scene: ReactNode;
}> = [
  {
    title: "Any model",
    body: "Hosted, private, local, or your own API keys—from one interface.",
    scene: <MiniSceneModels />,
  },
  {
    title: "Your knowledge",
    body: "Files, institutional resources, and memory without rebuilding context.",
    scene: <MiniSceneKnowledge />,
  },
  {
    title: "Governed tools",
    body: "Agents research and act through approved tools. People stay in control.",
    scene: <MiniSceneAgents />,
  },
  {
    title: "Workflows",
    body: "Turn repeated work into reusable, role-specific AI workflows.",
    scene: <MiniSceneWorkflows />,
  },
  {
    title: "Your infrastructure",
    body: "Hosted, private cloud, or on-premises—same product.",
    scene: <MiniSceneInfra />,
  },
  {
    title: "Your data",
    body: "Define storage, retention, access, and which providers may see it.",
    scene: <MiniSceneData />,
  },
];

const ENTERPRISE_ATTRIBUTES: Array<{
  icon: LucideIcon;
  title: string;
  body: string;
}> = [
  {
    icon: Plug,
    title: "Extensible",
    body: "Add models, tools, workflows, and integrations without a vendor roadmap.",
  },
  {
    icon: Eye,
    title: "Customizable",
    body: "Adapt the system to how your organization actually operates.",
  },
  {
    icon: ShieldCheck,
    title: "Auditable",
    body: "Inspect software, data flows, permissions, and agent activity.",
  },
  {
    icon: Lock,
    title: "Private",
    body: "Deploy on infrastructure you control. Decide where information goes.",
  },
];

const EDUCATION_CARDS: Array<{ title: string; tint: MarketingTint }> = [
  { title: "Curriculum-grounded lessons", tint: "clay" },
  { title: "Rubric-based feedback", tint: "slate" },
  { title: "Teacher assistants", tint: "olive" },
  { title: "Student revision plans", tint: "stone" },
  { title: "Admin reporting", tint: "sand" },
  { title: "Governed knowledge", tint: "mist" },
];

const FORWARD_STEPS = [
  "Identify high-value AI workflows",
  "Deploy Overlay in your environment",
  "Configure models, knowledge, and permissions",
  "Build the first governed workflows with your team",
];

const VISION_LAYERS = [
  {
    index: "01",
    title: "Interface",
    body: "A privately controlled surface for models, knowledge, tools, workflows, and agents.",
    accent: true,
  },
  {
    index: "02",
    title: "Models",
    body: "Organization-specific intelligence built on private knowledge and feedback.",
  },
  {
    index: "03",
    title: "Infrastructure",
    body: "Models and interfaces on cloud or physical infrastructure you control.",
  },
];

function SectionHeading({
  eyebrow,
  title,
  body,
  align = "left",
}: {
  eyebrow: string;
  title: ReactNode;
  body?: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <p className={marketingEyebrow()}>{eyebrow}</p>
      <h2
        className={`mt-4 ${marketingHeadingLg()}`}
        style={marketingSerifStyle()}
      >
        {title}
      </h2>
      {body ? (
        <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)]">
          {body}
        </p>
      ) : null}
    </div>
  );
}

function HomeLandingContent() {
  const { isAuthenticated } = useAuth();
  const webAppHref = getMarketingAppHref(isAuthenticated);

  return (
    <StaticMarketingShell>
      <main className="flex-1">
        {/* Hero — copy first, one large demo below */}
        <section id="hero" className="scroll-mt-20 px-5 pb-10 pt-10 md:px-8 md:pb-16 md:pt-14">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-3xl text-center">
              <p className={marketingEyebrow()}>The open-source AI interface</p>
              <h1
                className="mt-4 text-balance text-5xl leading-[0.95] tracking-tight md:text-6xl lg:text-7xl"
                style={marketingSerifStyle()}
              >
                Own the interface to intelligence.
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-[var(--muted)] md:text-lg">
                One private workspace for models, knowledge, tools, and
                agents—without locking you into a single vendor or infrastructure
                provider.
              </p>
              <MarketingCtaRow className="justify-center">
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
                  Deploy privately
                </MarketingButton>
              </MarketingCtaRow>
              <div className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-[var(--muted)]">
                {HERO_BULLETS.map((item) => (
                  <span key={item} className="flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-[var(--muted-light)]" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-12 md:mt-16">
              <ProductAppDemo />
              <p className="mt-3 text-center text-[11px] text-[var(--muted-light)]">
                Click Chat, Files, Extensions, Projects, or Automations in the
                sidebar to play each surface.
              </p>
            </div>
          </div>
        </section>

        {/* Feature mini-scene grid */}
        <MarketingBand id="product" className="scroll-mt-20">
          <SectionHeading
            eyebrow="Start with the highest-leverage layer"
            title={<>The interface.</>}
            body="The interface determines how people access models, knowledge, tools, and agents. Overlay gives you control over that layer first."
            align="center"
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_CARDS.map((card) => (
              <article
                key={card.title}
                className="bg-[var(--surface-elevated)] p-5 md:p-6"
              >
                <FeatureMiniScene>{card.scene}</FeatureMiniScene>
                <h3
                  className="mt-5 text-lg tracking-tight"
                  style={marketingSerifStyle()}
                >
                  {card.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {card.body}
                </p>
              </article>
            ))}
          </div>
        </MarketingBand>

        {/* Stakes */}
        <MarketingBand id="problem" className="scroll-mt-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div className="max-w-2xl">
              <p className={marketingEyebrow()}>The stakes</p>
              <h2
                className={`mt-4 ${marketingHeadingLg()}`}
                style={marketingSerifStyle()}
              >
                AI is becoming the interface to your organization.
              </h2>
              <p className="mt-6 text-base leading-7 text-[var(--muted)]">
                Every prompt, document, and decision gives an AI system more
                context about how you operate. That context is institutional
                intelligence—and most organizations are putting it in interfaces
                they do not own.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 md:p-8">
              <h3
                className="text-2xl tracking-tight md:text-3xl"
                style={marketingSerifStyle()}
              >
                Own your intelligence.
              </h3>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                That means controlling:
              </p>
              <ul className="mt-4 divide-y divide-[var(--border)]">
                {CONTROL_ITEMS.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 py-3 text-sm text-[var(--foreground)]"
                  >
                    <ArrowRight
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]"
                      strokeWidth={1.8}
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm font-medium text-[var(--foreground)]">
                AI sovereignty is not a feature. It is the foundation.
              </p>
            </div>
          </div>
        </MarketingBand>

        {/* Individuals + organizations — tinted cards */}
        <MarketingBand id="organizations" className="scroll-mt-20">
          <SectionHeading
            eyebrow="One interface. Two ways to use it."
            title={<>For individuals and organizations.</>}
            align="center"
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            <div
              className={`rounded-2xl p-7 md:p-9 ${marketingTint("clay")}`}
            >
              <p className="text-xs font-medium uppercase tracking-[0.2em] opacity-70">
                For individuals
              </p>
              <h3
                className="mt-4 text-2xl tracking-tight md:text-3xl"
                style={marketingSerifStyle()}
              >
                Stop rebuilding context across AI tools.
              </h3>
              <p className="mt-4 text-sm leading-6 opacity-85">
                Models, files, memory, integrations, and generated work in one
                workspace—something you can understand, customize, and take with
                you.
              </p>
              <div className="mt-8">
                <MarketingButton
                  href={webAppHref}
                  variant="primary"
                  arrow="right"
                >
                  Try Overlay
                </MarketingButton>
              </div>
            </div>
            <div
              className={`rounded-2xl p-7 md:p-9 ${marketingTint("slate")}`}
            >
              <p className="text-xs font-medium uppercase tracking-[0.2em] opacity-70">
                For organizations
              </p>
              <h3
                className="mt-4 text-2xl tracking-tight md:text-3xl"
                style={marketingSerifStyle()}
              >
                Your own AI environment.
              </h3>
              <p className="mt-4 text-sm leading-6 opacity-85">
                Deploy a governed workspace on infrastructure you control.
                Choose models, connect private knowledge, set permissions, and
                keep ownership of the resulting intelligence.
              </p>
              <div className="mt-8">
                <MarketingButton
                  href={MARKETING_SALES_URL}
                  external
                  variant="primary"
                  arrow="up-right"
                >
                  Talk about private deployment
                </MarketingButton>
              </div>
            </div>
          </div>
        </MarketingBand>

        {/* Dark ownership + open source band */}
        <section
          id="open-source"
          className={`scroll-mt-20 px-5 py-16 md:px-8 md:py-24 ${marketingDarkBand()}`}
        >
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-white/45">
                Ownership, not access
              </p>
              <h2
                className="mt-4 text-3xl tracking-tight md:text-5xl"
                style={marketingSerifStyle()}
              >
                Most enterprise AI products offer access. Overlay is built around
                ownership.
              </h2>
            </div>
            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
              {ENTERPRISE_ATTRIBUTES.map((attr) => (
                <article key={attr.title} className="bg-[#1a1a1a] p-5 md:p-6">
                  <attr.icon className="h-5 w-5 text-white/90" strokeWidth={1.7} />
                  <h3 className="mt-4 text-sm font-medium text-white">
                    {attr.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-white/55">
                    {attr.body}
                  </p>
                </article>
              ))}
            </div>
            <div className="mt-14 grid gap-8 border-t border-white/10 pt-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-white/45">
                  Privacy you can verify
                </p>
                <h3
                  className="mt-4 text-2xl tracking-tight md:text-3xl"
                  style={marketingSerifStyle()}
                >
                  Not privacy you have to trust.
                </h3>
              </div>
              <div>
                <p className="text-base leading-7 text-white/60">
                  Overlay is open source because control requires access to the
                  software itself. Inspect it. Extend it. Self-host it. Fork it.
                  Open source is the architectural basis for sovereignty.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a
                    href={MARKETING_GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-[#0a0a0a] transition-opacity hover:opacity-90"
                  >
                    View on GitHub
                    <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
                  </a>
                  <a
                    href={MARKETING_DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/20 bg-transparent px-5 text-sm font-medium text-white transition-colors hover:bg-white/10"
                  >
                    Documentation
                    <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Education + forward deployment */}
        <MarketingBand id="education" className="scroll-mt-20">
          <div className="grid gap-14 lg:grid-cols-2">
            <div>
              <SectionHeading
                eyebrow="First institutional focus"
                title={<>Built for education.</>}
                body="Schools need more than a chatbot. They need systems that respect privacy, enforce roles, ground work in curriculum, and keep teachers as decision-makers."
              />
              <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {EDUCATION_CARDS.map((card) => (
                  <div
                    key={card.title}
                    className={`rounded-xl p-4 text-sm leading-5 ${marketingTint(card.tint)}`}
                  >
                    <GraduationCap
                      className="mb-3 h-4 w-4 opacity-70"
                      strokeWidth={1.7}
                    />
                    {card.title}
                  </div>
                ))}
              </div>
              <MarketingCtaRow>
                <MarketingButton
                  href={MARKETING_SALES_URL}
                  external
                  variant="primary"
                  arrow="up-right"
                >
                  Overlay for education
                </MarketingButton>
              </MarketingCtaRow>
            </div>
            <div>
              <SectionHeading
                eyebrow="Forward deployment"
                title={<>Software should adapt to you.</>}
                body="We work with organizations to turn highest-value workflows into governed AI systems—and feed those patterns back into the product."
              />
              <ol className="mt-6 border-t border-[var(--border)]">
                {FORWARD_STEPS.map((step, i) => (
                  <li
                    key={step}
                    className="grid gap-3 border-t border-[var(--border)] py-4 first:border-t-0 sm:grid-cols-[2.5rem_1fr]"
                  >
                    <span className="font-mono text-xs text-[var(--muted-light)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <p className="text-sm leading-6 text-[var(--foreground)]">
                      {step}
                    </p>
                  </li>
                ))}
              </ol>
              <MarketingCtaRow>
                <MarketingButton
                  href={MARKETING_SALES_URL}
                  external
                  variant="secondary"
                  arrow="up-right"
                >
                  Become a design partner
                </MarketingButton>
              </MarketingCtaRow>
            </div>
          </div>
        </MarketingBand>

        {/* Vision */}
        <MarketingBand id="vision" className="scroll-mt-20">
          <SectionHeading
            eyebrow="Overlay is the first layer"
            title={<>Toward the full sovereign AI stack.</>}
            body="LayerNorm is building the path from interface ownership to models and infrastructure organizations control end-to-end."
          />
          <div className="mt-10 grid gap-3 md:grid-cols-3">
            {VISION_LAYERS.map((layer) => (
              <div
                key={layer.index}
                className={`rounded-2xl border border-[var(--border)] p-6 ${
                  layer.accent
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "bg-[var(--surface-elevated)]"
                }`}
              >
                <span
                  className={`font-mono text-xs ${
                    layer.accent ? "text-white/50" : "text-[var(--muted-light)]"
                  }`}
                >
                  {layer.index}
                </span>
                <h3
                  className="mt-3 text-xl tracking-tight"
                  style={marketingSerifStyle()}
                >
                  {layer.title}
                </h3>
                <p
                  className={`mt-2 text-sm leading-6 ${
                    layer.accent ? "text-white/70" : "text-[var(--muted)]"
                  }`}
                >
                  {layer.body}
                </p>
                {layer.accent ? (
                  <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
                    Overlay starts here
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-10 text-center text-sm text-[var(--muted)]">
            Humans decide. Software executes—transparently, under your
            supervision.
          </p>
        </MarketingBand>

        {/* Final CTA */}
        <MarketingBand id="cta" className="scroll-mt-20">
          <div className="mx-auto max-w-3xl text-center">
            <EditorialIntro
              title={
                <>
                  Every organization should own its intelligence.
                  <br />
                  Start with the interface.
                </>
              }
            />
            <MarketingCtaRow className="justify-center">
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
            </MarketingCtaRow>
            <p className="mt-8 text-xs text-[var(--muted)]">
              Open source · Self-hostable · Model-independent · Built by
              LayerNorm
            </p>
          </div>
        </MarketingBand>
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
