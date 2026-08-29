"use client";

import { MoonStar, SunMedium } from "lucide-react";
import Image from "next/image";
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
  "text-[var(--muted)] hover:text-[var(--foreground)] transition-colors";

const FOOTER_LINKS: Array<{ label: string; href: string; external?: boolean }> = [
  { label: "Source code", href: MARKETING_GITHUB_URL, external: true },
  { label: "Docs", href: MARKETING_DOCS_URL, external: true },
  { label: "Pricing", href: "/pricing" },
  { label: "Manifesto", href: "/manifesto" },
  { label: "Contact", href: MARKETING_SALES_URL, external: true },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Acceptable use", href: "/acceptable-use" },
  { label: "Cookies", href: "/cookies" },
];

export function MarketingFooter() {
  const landing = useLandingThemeOptional();

  return (
    <footer className="border-t border-[var(--border)] px-6 py-10 md:px-10">
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Image
            src="/assets/overlay-logo.png"
            alt="Overlay"
            width={MARKETING_LOGO_SIZE}
            height={MARKETING_LOGO_SIZE}
            className="shrink-0"
          />
          <span
            className="text-lg font-medium tracking-tight text-[var(--foreground)]"
            style={marketingSerifStyle()}
          >
            overlay
          </span>
        </div>

        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          {FOOTER_LINKS.map((link) =>
            link.external ? (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-sm ${linkClass}`}
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                href={link.href}
                className={`text-sm ${linkClass}`}
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>

        {landing ? (
          <button
            type="button"
            onClick={landing.toggleLandingTheme}
            className={`inline-flex items-center gap-2 text-sm ${linkClass}`}
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
    </footer>
  );
}
