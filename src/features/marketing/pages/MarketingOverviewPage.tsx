'use client'

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AuthBoundary, useAuth } from "@/contexts/AuthContext";
import { LandingThemeProvider } from "@/contexts/LandingThemeContext";
import { MarketingButton } from "@/features/marketing/components/MarketingButton";
import { MarketingFooter } from "@/features/marketing/components/MarketingFooter";
import { ProductWorkspaceDemo } from "@/features/marketing/components/MarketingShowcase";
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

const CAPABILITIES = [
  "Any model — hosted, private, local, or your own keys",
  "Your knowledge — files, resources, and memory in one place",
  "Governed tools — agents act through approved, audited tools",
  "Workflows — turn repeated work into reusable AI flows",
  "Your infrastructure — cloud, private, or on-premises",
  "Your data — storage, retention, and access you control",
];

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
                Own the interface to intelligence.
              </h1>
              <p className={`mx-auto mt-8 max-w-2xl ${minimalBody()}`}>
                One private workspace for models, knowledge, tools, and
                agents — without locking you into a single vendor.
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
        <section className={minimalSectionSm()}>
          <div className={minimalContainer()}>
            <Reveal>
              <ProductWorkspaceDemo title="What are we working on?" />
              <div className="mt-8 text-center">
                <Link href="/" className={minimalTextLink()}>
                  Open the live showcase
                  <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
                </Link>
              </div>
            </Reveal>
          </div>
        </section>

        {/* 3. What it is */}
        <section className={minimalSection()}>
          <div className="mx-auto max-w-4xl">
            <Reveal>
              <p className={minimalLabel()}>The interface</p>
              <h2
                className="mt-6 text-3xl leading-[1.1] tracking-tight md:text-5xl"
                style={minimalSerif()}
              >
                Control the layer between people and intelligence.
              </h2>
              <p className={`mt-8 max-w-2xl ${minimalBody()}`}>
                The interface determines how people access models, knowledge,
                tools, and agents. Overlay gives you control over that layer —
                and everything it connects.
              </p>
              <div className="mt-12 grid gap-x-12 gap-y-5 sm:grid-cols-2">
                {CAPABILITIES.map((item) => (
                  <p
                    key={item}
                    className="text-sm leading-7 text-[var(--foreground)]"
                  >
                    {item}
                  </p>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* 4. Who it's for */}
        <section className={minimalSection()}>
          <div className="mx-auto max-w-4xl">
            <Reveal>
              <div className="grid gap-16 md:grid-cols-2">
                <div>
                  <p className={minimalLabel()}>For individuals</p>
                  <h3
                    className="mt-6 text-2xl tracking-tight md:text-3xl"
                    style={minimalSerif()}
                  >
                    Stop rebuilding context.
                  </h3>
                  <p className={`mt-5 ${minimalBody()}`}>
                    Models, files, memory, and generated work in one workspace
                    you can understand, customize, and take with you.
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
                    Your own AI environment.
                  </h3>
                  <p className={`mt-5 ${minimalBody()}`}>
                    Deploy on infrastructure you control. Choose models,
                    connect private knowledge, set permissions, and keep
                    ownership of the resulting intelligence.
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

        {/* 5. Closing */}
        <section className={minimalSection()}>
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <h2
                className="text-3xl leading-[1.1] tracking-tight md:text-5xl"
                style={minimalSerif()}
              >
                Every organization should own its intelligence.
              </h2>
              <p className={`mx-auto mt-6 max-w-xl ${minimalBody()}`}>
                Start with the interface. Built by LayerNorm.
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
