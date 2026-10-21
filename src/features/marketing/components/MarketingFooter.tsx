"use client";
import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { MoonStar, SunMedium } from "lucide-react";
import { BrandLockup } from "@/components/brand/BrandLockup";
import Link from "next/link";
import { useLandingThemeOptional } from "@/contexts/LandingThemeContext";
import {
  MARKETING_DOCS_URL,
  MARKETING_GITHUB_URL,
  MARKETING_SALES_URL,
} from "@/shared/marketing/marketing";

const linkClass =
  "py-1 text-[13px] text-(--muted) hover:text-(--foreground) transition-colors";

const colClass = "mb-3.5 text-xs font-semibold text-(--foreground)";

type FootLink = { label: string; href: string; external?: boolean };

const FOOTER_COLUMNS: Array<{ title: string; links: FootLink[] }> = [
  {
    title: "Product",
    links: [
      { label: "Agents", href: "/home#control-plane" },
      { label: "Platforms", href: "/home#get-overlay" },
      { label: "Computers", href: "/home#ai-employees" },
      { label: "Automations", href: "/home#deploy" },
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
    <footer className="border-t border-(--border) px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Link href="/home" className="inline-flex text-(--foreground)">
              <BrandLockup style={{ fontSize: 18 }} />
            </Link>
            <p className="mt-3 text-xs leading-5 text-(--muted)">
              The control plane for AI employees.

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
                    className={`block ${linkClass}`}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.label} href={link.href} className={`block ${linkClass}`}>
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 flex items-center justify-between text-xs text-(--muted-light)">
          <span>© LayerNorm</span>
          <div className="flex items-center gap-4">
            <span>Built for the agent era.</span>
            {landing ? (
              <Button variant="ghost"
                type="button"
                onClick={landing.toggleLandingTheme}
                className={unstyledButton(`inline-flex items-center gap-2 ${linkClass} py-0!`)}
              >
                {landing.landingTheme === "light" ? (
                  <MoonStar className="h-4 w-4" />
                ) : (
                  <SunMedium className="h-4 w-4" />
                )}
                <span>
                  {landing.landingTheme === "light" ? "Dark" : "Light"}
                </span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
