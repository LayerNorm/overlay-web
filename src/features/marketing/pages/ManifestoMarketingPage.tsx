"use client";

import { AuthBoundary, useAuth } from "@/contexts/AuthContext";
import { LandingThemeProvider } from "@/contexts/LandingThemeContext";
import { MarketingFooter } from "@/features/marketing/components/MarketingFooter";
import { StaticMarketingShell } from "@/features/marketing/components/StaticMarketingShell";
import {
  EditorialIntro,
  MarketingBand,
  MarketingCtaRow,
  PrimaryMarketingLink,
  PrincipleGrid,
  ProductWorkspaceDemo,
  SecondaryMarketingLink,
} from "@/features/marketing/components/MarketingShowcase";
import { MARKETING_GITHUB_URL, getMarketingAppHref } from "@/shared/marketing/marketing";

const PRINCIPLES = [
  ["Privacy", "The interface closest to your work should respect where that work lives."],
  ["Openness", "Teams should be able to inspect, self-host, extend, and change the system they depend on."],
  ["Control", "Model choice, data flow, and workflow policy should be configurable, not dictated by one vendor."],
  ["Simplicity", "The product should feel like a tool you use every day, not a maze of disconnected AI accounts."],
];

function ManifestoContent() {
  const { isAuthenticated } = useAuth();
  const appHref = getMarketingAppHref(isAuthenticated);

  return (
    <StaticMarketingShell>
      <main>
        <section className="px-5 py-16 md:px-8 md:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
            <div>
              <EditorialIntro
                label="Manifesto"
                title="AI should amplify human potential, not replace it."
                body="Overlay exists because the best models, tools, files, and workflows should meet in one open interface that people and institutions can actually control."
              />
              <MarketingCtaRow>
                <PrimaryMarketingLink href={appHref}>Open app</PrimaryMarketingLink>
                <SecondaryMarketingLink href={MARKETING_GITHUB_URL} external>
                  View source
                </SecondaryMarketingLink>
              </MarketingCtaRow>
            </div>
            <ProductWorkspaceDemo tone="dark" compact title="Context compounds." />
          </div>
        </section>

        <MarketingBand>
          <div className="grid gap-10 lg:grid-cols-[0.42fr_1fr]">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--muted-light)]">Principles</p>
              <h2 className="mt-4 text-3xl tracking-tight md:text-5xl">The interface should be user-aligned.</h2>
            </div>
            <PrincipleGrid />
          </div>
        </MarketingBand>

        <MarketingBand>
          <div className="mx-auto max-w-4xl">
            <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {PRINCIPLES.map(([title, body]) => (
                <section key={title} className="grid gap-4 py-7 md:grid-cols-[180px_1fr]">
                  <h2 className="text-sm font-medium">{title}</h2>
                  <p className="text-base leading-8 text-[var(--muted)]">{body}</p>
                </section>
              ))}
            </div>
          </div>
        </MarketingBand>
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
