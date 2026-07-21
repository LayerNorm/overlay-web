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
import { CapabilityShowcase } from "@/features/marketing/components/CapabilityShowcase";
import { MarketingButton } from "@/features/marketing/components/MarketingButton";
import { MarketingFooter } from "@/features/marketing/components/MarketingFooter";
import {
  EditorialIntro,
  MarketingBand,
  MarketingCtaRow,
  ProductWorkspaceDemo,
} from "@/features/marketing/components/MarketingShowcase";
import { StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";
import {
  marketingEyebrow,
  marketingHeadingLg,
  marketingSerifStyle,
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

const ENTERPRISE_ATTRIBUTES: Array<{
  icon: LucideIcon;
  title: string;
  body: string;
}> = [
  {
    icon: Plug,
    title: "Extensible",
    body: "Add models, tools, workflows, and integrations without waiting on a vendor roadmap.",
  },
  {
    icon: Eye,
    title: "Customizable",
    body: "Adapt the system to how your organization actually operates.",
  },
  {
    icon: ShieldCheck,
    title: "Auditable",
    body: "Inspect software, data flows, permissions, model usage, and agent activity.",
  },
  {
    icon: Lock,
    title: "Private",
    body: "Deploy on infrastructure you control and decide where information goes.",
  },
];

const EDUCATION_WORKFLOWS = [
  "Curriculum-grounded lessons",
  "Rubric-based feedback",
  "Teacher knowledge assistants",
  "Student revision plans",
  "Administrative reporting",
  "Governed institutional knowledge",
];

const FORWARD_DEPLOYMENT_STEPS = [
  "Identify high-value AI workflows",
  "Deploy Overlay in your environment",
  "Configure models, knowledge, and permissions",
  "Build the first governed workflows with your team",
];

const VISION_LAYERS: Array<{
  index: string;
  title: string;
  body: string;
  accent?: boolean;
}> = [
  {
    index: "01",
    title: "Interface",
    body: "A privately controlled surface for models, knowledge, tools, workflows, and agents.",
    accent: true,
  },
  {
    index: "02",
    title: "Models",
    body: "Organization-specific intelligence built on private knowledge, workflows, and feedback.",
  },
  {
    index: "03",
    title: "Infrastructure",
    body: "Models and interfaces on cloud or physical infrastructure you control.",
  },
];

const AMBIENT_SURFACES = ["Web", "Desktop", "Browser", "Mobile"];

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: ReactNode;
  body?: ReactNode;
}) {
  return (
    <div className="max-w-3xl">
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

function VisionLayerRow({
  index,
  title,
  body,
  accent,
}: {
  index: string;
  title: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`grid gap-4 border-t border-[var(--border)] py-7 first:border-t-0 md:grid-cols-[4rem_1fr] ${
        accent ? "rounded-lg bg-[var(--surface-subtle)] px-5 -mx-5" : ""
      }`}
    >
      <span className="font-mono text-sm text-[var(--muted-light)]">{index}</span>
      <div>
        <h3 className="text-base font-medium">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p>
        {accent ? (
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted-light)]">
            Overlay starts here.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function HomeLandingContent() {
  const { isAuthenticated } = useAuth();
  const webAppHref = getMarketingAppHref(isAuthenticated);

  return (
    <StaticMarketingShell>
      <main className="flex-1">
        {/* Hero */}
        <section id="hero" className="scroll-mt-20 px-5 py-14 md:px-8 md:py-20">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div className="max-w-xl">
              <p className={marketingEyebrow()}>The open-source AI interface</p>
              <h1
                className="mt-4 text-balance text-5xl leading-[0.95] tracking-tight md:text-6xl lg:text-7xl"
                style={marketingSerifStyle()}
              >
                Own the interface to intelligence.
              </h1>
              <p className="mt-6 text-pretty text-base leading-7 text-[var(--muted)] md:text-lg">
                One private workspace for models, knowledge, tools, and
                agents—without locking you into a single vendor or infrastructure
                provider.
              </p>
              <MarketingCtaRow>
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
              <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--muted)]">
                {HERO_BULLETS.map((item) => (
                  <span key={item} className="flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-[var(--muted-light)]" />
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <ProductWorkspaceDemo compact title="Hi there!" />
          </div>
        </section>

        {/* Problem / stakes */}
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
                they do not own, on models and infrastructure they cannot
                inspect.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 md:p-8">
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

        {/* Product + capability showcase */}
        <MarketingBand id="product" className="scroll-mt-20">
          <SectionHeading
            eyebrow="Start with the highest-leverage layer"
            title={<>The interface.</>}
            body="The interface determines how people access models, knowledge, tools, and agents. Overlay gives you control over that layer first."
          />
          <div className="mt-10">
            <CapabilityShowcase />
          </div>
          <MarketingCtaRow>
            <MarketingButton href={webAppHref} variant="primary" arrow="right">
              Explore the product
            </MarketingButton>
          </MarketingCtaRow>
        </MarketingBand>

        {/* Individuals + organizations */}
        <MarketingBand id="organizations" className="scroll-mt-20">
          <SectionHeading
            eyebrow="One interface. Two ways to use it."
            title={<>For individuals and organizations.</>}
          />
          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 md:p-8">
              <p className={marketingEyebrow()}>For individuals</p>
              <h3
                className="mt-4 text-2xl tracking-tight"
                style={marketingSerifStyle()}
              >
                Stop rebuilding context across AI tools.
              </h3>
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                Models, files, memory, integrations, and generated work in one
                workspace—something you can understand, customize, and take with
                you.
              </p>
              <MarketingCtaRow>
                <MarketingButton
                  href={webAppHref}
                  variant="primary"
                  arrow="right"
                >
                  Try Overlay
                </MarketingButton>
              </MarketingCtaRow>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 md:p-8">
              <p className={marketingEyebrow()}>For organizations</p>
              <h3
                className="mt-4 text-2xl tracking-tight"
                style={marketingSerifStyle()}
              >
                Your own AI environment.
              </h3>
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                Deploy a governed workspace on infrastructure you control.
                Choose models, connect private knowledge, set permissions, and
                keep ownership of the resulting intelligence.
              </p>
              <MarketingCtaRow>
                <MarketingButton
                  href={MARKETING_SALES_URL}
                  external
                  variant="primary"
                  arrow="up-right"
                >
                  Talk about private deployment
                </MarketingButton>
              </MarketingCtaRow>
            </div>
          </div>
        </MarketingBand>

        {/* Sovereignty + open source */}
        <MarketingBand id="open-source" className="scroll-mt-20">
          <SectionHeading
            eyebrow="Ownership, not access"
            title={
              <>
                Most enterprise AI products offer access. Overlay is built around
                ownership.
              </>
            }
          />
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
            {ENTERPRISE_ATTRIBUTES.map((attr) => (
              <article
                key={attr.title}
                className="bg-[var(--surface-elevated)] p-5"
              >
                <attr.icon className="h-5 w-5" strokeWidth={1.7} />
                <h3 className="mt-4 text-sm font-medium">{attr.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {attr.body}
                </p>
              </article>
            ))}
          </div>
          <div className="mt-12 grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div>
              <p className={marketingEyebrow()}>Privacy you can verify</p>
              <h3
                className="mt-4 text-2xl tracking-tight md:text-3xl"
                style={marketingSerifStyle()}
              >
                Not privacy you have to trust.
              </h3>
            </div>
            <div>
              <p className="text-base leading-7 text-[var(--muted)]">
                Overlay is open source because control requires access to the
                software itself. Inspect it. Extend it. Self-host it. Fork it.
                Open source is not an add-on—it is the architectural basis for
                sovereignty.
              </p>
              <MarketingCtaRow>
                <MarketingButton
                  href={MARKETING_GITHUB_URL}
                  external
                  variant="primary"
                  arrow="up-right"
                >
                  View on GitHub
                </MarketingButton>
                <MarketingButton
                  href={MARKETING_DOCS_URL}
                  external
                  variant="secondary"
                  arrow="up-right"
                >
                  Documentation
                </MarketingButton>
              </MarketingCtaRow>
            </div>
          </div>
        </MarketingBand>

        {/* Education + forward deployment */}
        <MarketingBand id="education" className="scroll-mt-20">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <SectionHeading
                eyebrow="First institutional focus"
                title={<>Built for education.</>}
                body="Schools need more than a chatbot. They need systems that respect privacy, enforce roles, ground work in curriculum, and keep teachers as decision-makers."
              />
              <div className="mt-6 flex flex-wrap gap-2">
                {EDUCATION_WORKFLOWS.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-xs text-[var(--foreground)]"
                  >
                    <GraduationCap className="h-3.5 w-3.5 text-[var(--muted)]" strokeWidth={1.7} />
                    {item}
                  </span>
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
                {FORWARD_DEPLOYMENT_STEPS.map((step, i) => (
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
          <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_0.75fr] lg:items-start">
            <div className="border-t border-[var(--border)]">
              {VISION_LAYERS.map((layer) => (
                <VisionLayerRow
                  key={layer.index}
                  index={layer.index}
                  title={layer.title}
                  body={layer.body}
                  accent={layer.accent}
                />
              ))}
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 md:p-8">
              <p className={marketingEyebrow()}>Surfaces</p>
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                Work does not begin inside a chatbot. Overlay expands across the
                places intent already shows up.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {AMBIENT_SURFACES.map((surface) => (
                  <span
                    key={surface}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-xs text-[var(--muted)]"
                  >
                    {surface}
                  </span>
                ))}
              </div>
              <p className="mt-6 text-sm leading-6 text-[var(--muted)]">
                Humans decide. Software executes—transparently, under your
                supervision.
              </p>
            </div>
          </div>
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
