"use client";

import { MoonStar, SunMedium } from "lucide-react";
import { OverlayMark } from "@/components/orb/Orb";
import Link from "next/link";
import { useLandingThemeOptional } from "@/contexts/LandingThemeContext";
import {
  MARKETING_LOGO_SIZE,
  marketingSerifStyle,
} from "@/features/marketing/lib/marketingLayout";
import {
  MARKETING_DOCS_URL,
  MARKETING_GITHUB_URL,
  MARKETING_SALES_URL,
} from "@/shared/marketing/marketing";

const linkClass =
  "block py-1 text-[13px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors";

const colClass = "mb-3.5 text-xs font-semibold text-[var(--foreground)]";

type FootLink = { label: string; href: string; external?: boolean };

const FOOTER_COLUMNS: Array<{ title: string; links: FootLink[] }> = [
  {
    title: "Product",
    links: [
      { label: "Agents", href: "/home#agents" },
      { label: "Platforms", href: "/home#platforms" },
      { label: "Computers", href: "/home#computers" },
      { label: "Automations", href: "/home#automations" },
      { label: "Download", href: "/download" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: MARKETING_DOCS_URL, external: true },
      { label: "Blog", href: "/blog" },
      { label: "Changelog", href: "/changelog" },
      { label: "Self-hosting", href: "/self-hosting" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Manifesto", href: "/manifesto" },
      { label: "Source code", href: MARKETING_GITHUB_URL, external: true },
      { label: "Contact", href: MARKETING_SALES_URL, external: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "DPA", href: "/dpa" },
      { label: "Subprocessors", href: "/subprocessors" },
      { label: "Acceptable use", href: "/acceptable-use" },
      { label: "Cookies", href: "/cookies" },
      { label: "Refunds", href: "/refunds" },
      { label: "DMCA", href: "/dmca" },
      { label: "Commercial license", href: "/commercial-license" },
    ],
  },
];

export function MarketingFooter() {
  const landing = useLandingThemeOptional();

  return (
    <footer className="border-t border-[var(--border)] px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Link href="/home" className="flex items-center gap-2">
              <OverlayMark size={MARKETING_LOGO_SIZE} label="Overlay" />
              <span
                className="text-lg font-medium tracking-tight text-[var(--foreground)]"
                style={marketingSerifStyle()}
              >
                overlay
              </span>
            </Link>
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              The control panel for your AI workforce.
            </p>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h5 className={colClass}>{col.title}</h5>
              {col.links.map((link) =>
                link.external ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkClass}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.label} href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 flex items-center justify-between text-xs text-[var(--muted-light)]">
          <span>© LayerNorm</span>
          <div className="flex items-center gap-4">
            <span>Built for the agent era.</span>
            {landing ? (
              <button
                type="button"
                onClick={landing.toggleLandingTheme}
                className={`inline-flex items-center gap-2 ${linkClass} !py-0`}
              >
                {landing.landingTheme === "light" ? (
                  <MoonStar className="h-4 w-4" />
                ) : (
                  <SunMedium className="h-4 w-4" />
                )}
                <span>
                  {landing.landingTheme === "light" ? "Dark" : "Light"}
                </span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
