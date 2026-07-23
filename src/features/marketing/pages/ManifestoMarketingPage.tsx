"use client";

import { ArrowRight } from "lucide-react";
import { AuthBoundary, useAuth } from "@/contexts/AuthContext";
import { LandingThemeProvider } from "@/contexts/LandingThemeContext";
import { MarketingFooter } from "@/features/marketing/components/MarketingFooter";
import { Reveal } from "@/features/marketing/components/Reveal";
import { StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";
import {
  minimalBody,
  minimalDisplay,
  minimalLabel,
  minimalProse,
  minimalSection,
  minimalSectionSm,
  minimalSerif,
  minimalTextLink,
} from "@/features/marketing/lib/minimalLayout";
import { MARKETING_GITHUB_URL, getMarketingAppHref } from "@/shared/marketing/marketing";

const PRINCIPLES: Array<{ title: string; body: string }> = [
  {
    title: "Privacy",
    body: "The interface closest to your work should respect where that work lives. Data flows, model access, and retention should be visible and configurable — not hidden behind a vendor's roadmap.",
  },
  {
    title: "Openness",
    body: "Teams should be able to inspect, self-host, extend, and change the system they depend on. Open source is not a licensing detail; it is the architectural basis for sovereignty.",
  },
  {
    title: "Control",
    body: "Model choice, data flow, and workflow policy should be configurable, not dictated by one vendor. The organization decides what intelligence can access and where the results are stored.",
  },
  {
    title: "Simplicity",
    body: "The product should feel like a tool you use every day, not a maze of disconnected AI accounts. One workspace, one context, one interface — understandable and adaptable.",
  },
];

function ManifestoContent() {
  const { isAuthenticated } = useAuth();
  const appHref = getMarketingAppHref(isAuthenticated);

  return (
    <StaticMarketingShell>
      <main>
        {/* Title block */}
        <section className={minimalSection()}>
          <div className={minimalProse()}>
            <Reveal>
              <p className={minimalLabel()}>Manifesto</p>
              <h1
                className={`mt-6 ${minimalDisplay()}`}
                style={minimalSerif()}
              >
                AI should amplify human potential, not replace it.
              </h1>
              <p className={`mt-8 ${minimalBody()}`}>
                Overlay exists because the best models, tools, files, and
                workflows should meet in one open interface that people and
                institutions can actually control.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Principles as numbered prose */}
        <section className={minimalSection()}>
          <div className={minimalProse()}>
            <div className="space-y-20">
              {PRINCIPLES.map((principle, i) => (
                <Reveal key={principle.title}>
                  <div className="flex gap-6">
                    <span
                      className="shrink-0 pt-1 text-sm tabular-nums text-[var(--muted-light)]"
                      style={minimalSerif()}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h2
                        className="text-2xl tracking-tight md:text-3xl"
                        style={minimalSerif()}
                      >
                        {principle.title}
                      </h2>
                      <p className={`mt-4 text-lg leading-9 text-[var(--muted)]`}>
                        {principle.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Sign-off */}
        <section className={minimalSectionSm()}>
          <div className={minimalProse()}>
            <Reveal>
              <p
                className="text-lg text-[var(--foreground)]"
                style={minimalSerif()}
              >
                — LayerNorm
              </p>
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
                <a href={appHref} className={minimalTextLink()}>
                  Open app
                  <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
                </a>
                <a
                  href={MARKETING_GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={minimalTextLink()}
                >
                  View source
                  <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </StaticMarketingShell>
  );
}

export default function ManifestoPage() {
  return (
    <AuthBoundary>
      <LandingThemeProvider>
        <ManifestoContent />
      </LandingThemeProvider>
    </AuthBoundary>
  );
}
