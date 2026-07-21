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

const FOOTER_COLUMNS: Array<{
  heading: string;
  links: Array<{ label: string; href: string; external?: boolean }>;
}> = [
  {
    heading: "Product",
    links: [
      { label: "Overview", href: "/home#product" },
      { label: "Models", href: "/home#product" },
      { label: "Knowledge", href: "/home#product" },
      { label: "Integrations", href: "/home#product" },
      { label: "Automations", href: "/home#product" },
      { label: "Desktop", href: MARKETING_GITHUB_URL, external: true },
    ],
  },
  {
    heading: "Organizations",
    links: [
      { label: "Private deployment", href: "/home#organizations" },
      { label: "Education", href: "/home#education" },
      { label: "Security", href: "/home#enterprise" },
      { label: "Design partners", href: "/home#forward-deployment" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "GitHub", href: MARKETING_GITHUB_URL, external: true },
      { label: "Documentation", href: MARKETING_DOCS_URL, external: true },
      {
        label: "Model Context Protocol",
        href: MARKETING_DOCS_URL,
        external: true,
      },
      { label: "Self-hosting", href: "/home#open-source" },
      {
        label: "Contributing",
        href: `${MARKETING_GITHUB_URL}/contributing`,
        external: true,
      },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About LayerNorm", href: "/home#vision" },
      { label: "Blog", href: MARKETING_GITHUB_URL, external: true },
      { label: "Contact", href: MARKETING_SALES_URL, external: true },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export function MarketingFooter() {
  const landing = useLandingThemeOptional();

  return (
    <footer className="relative z-10 border-t border-[var(--border)] px-6 py-12 md:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div className="flex items-start gap-2">
          <Image
            src="/assets/overlay-logo.png"
            alt="Overlay"
            width={MARKETING_LOGO_SIZE}
            height={MARKETING_LOGO_SIZE}
            className="mt-1.5 shrink-0"
          />
          <div>
            <p
              className="text-xl font-medium tracking-tight text-[var(--foreground)]"
              style={marketingSerifStyle()}
            >
              overlay
            </p>
            <p className="mt-2 max-w-xs text-xs leading-5 text-[var(--muted-light)]">
              The open-source AI interface for people and organizations that
              want control over their models, knowledge, workflows, and
              infrastructure.
            </p>
          </div>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <div key={column.heading}>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted-light)]">
              {column.heading}
            </p>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={`${column.heading}-${link.label}`}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-sm ${linkClass}`}
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className={`text-sm ${linkClass}`}>
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-10 flex max-w-7xl flex-col items-start justify-between gap-4 border-t border-[var(--border)] pt-6 text-xs text-[var(--muted-light)] md:flex-row md:items-center">
        <p>
          Built by LayerNorm · Open source · Self-hostable · Model-independent
        </p>
        {landing ? (
          <button
            type="button"
            onClick={landing.toggleLandingTheme}
            className={`inline-flex items-center gap-2 ${linkClass}`}
          >
            {landing.landingTheme === "light" ? (
              <MoonStar className="h-4 w-4" />
            ) : (
              <SunMedium className="h-4 w-4" />
            )}
            <span>
              {landing.landingTheme === "light" ? "Dark theme" : "Light theme"}
            </span>
          </button>
        ) : null}
      </div>
    </footer>
  );
}
