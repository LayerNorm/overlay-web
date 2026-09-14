"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Github, Menu, MoonStar, SunMedium, X } from "lucide-react";
import { OverlayMark } from "@/components/orb/Orb";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLandingThemeOptional } from "@/contexts/LandingThemeContext";
import {
  MARKETING_LOGO_SIZE,
  marketingNavText,
  marketingSerifStyle,
} from "@/features/marketing/lib/marketingLayout";
import {
  MARKETING_DOCS_URL,
  MARKETING_GITHUB_URL,
  getMarketingAppHref,
} from "@/shared/marketing/marketing";

/**
 * Primary nav items — wayfinding to real surfaces, not landing-page anchors
 * (the page scrolls fine on its own). Order: Product · Docs · Blog · Pricing.
 */
const PRIMARY_LINKS: Array<{
  href: string;
  label: string;
  match: (pathname: string) => boolean;
  external?: boolean;
}> = [
  { href: "/home", label: "Product", match: (p) => p === "/home" || p === "/" },
  {
    href: MARKETING_DOCS_URL,
    label: "Docs",
    match: () => false,
    external: true,
  },
  { href: "/blog", label: "Blog", match: (p) => p === "/blog" },
  { href: "/pricing", label: "Pricing", match: (p) => p === "/pricing" },
];

const mutedLink = "text-[var(--muted)] hover:text-[var(--foreground)]";

function activeLinkClass(active: boolean) {
  return active ? "text-[var(--foreground)]" : mutedLink;
}

/**
 * Single navbar shared across all outside-the-app surfaces. Free-floating on
 * the page field (no bottom divider) with a translucent paper fill so content
 * can pass under it without a hard chrome seam.
 *
 * There is intentionally no Use Cases dropdown: those pages do not exist yet,
 * and the navbar must not link at 404s. Reintroduce it with the pages.
 */
export function MarketingNavbar() {
  const pathname = usePathname() ?? "";
  const { isAuthenticated } = useAuth();
  const landing = useLandingThemeOptional();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const appHref = getMarketingAppHref(isAuthenticated);
  const serif = marketingSerifStyle();
  const navText = marketingNavText();

  return (
    <header className="sticky top-0 z-50 bg-[color:color-mix(in_srgb,var(--background)_88%,transparent)] backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <nav className="flex h-14 items-center justify-between gap-4">
          <Link
            href="/home"
            className="flex min-w-0 items-center gap-2"
            onClick={() => setMobileMenuOpen(false)}
          >
            <OverlayMark size={MARKETING_LOGO_SIZE} label="Overlay" />
            <span
              className="truncate text-xl font-medium tracking-tight"
              style={serif}
            >
              overlay
            </span>
          </Link>

          <div className="hidden items-center gap-6 md:flex">
            {PRIMARY_LINKS.map((item) =>
              item.external ? (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${navText} transition-colors ${mutedLink}`}
                  style={serif}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`${navText} transition-colors ${activeLinkClass(item.match(pathname))}`}
                  style={serif}
                >
                  {item.label}
                </Link>
              ),
            )}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            {landing ? (
              <button
                type="button"
                onClick={landing.toggleLandingTheme}
                aria-label="Toggle theme"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
              >
                {landing.landingTheme === "dark" ? (
                  <SunMedium className="h-4 w-4" />
                ) : (
                  <MoonStar className="h-4 w-4" />
                )}
              </button>
            ) : null}
            <a
              href={MARKETING_GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            >
              <Github className="h-4 w-4" />
            </a>
            <Link
              href={appHref}
              className={`inline-flex items-center rounded-full bg-[var(--button-primary-bg)] px-4 py-2 ${navText} text-[var(--button-primary-text)] transition-opacity hover:opacity-90`}
              style={serif}
            >
              Get Started
            </Link>
          </div>

          <button
            type="button"
            aria-expanded={mobileMenuOpen}
            aria-label={
              mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"
            }
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)] md:hidden"
          >
            {mobileMenuOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )}
          </button>
        </nav>
      </div>

      <AnimatePresence initial={false}>
        {mobileMenuOpen ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden border-t border-[var(--border)] bg-[var(--sidebar-surface)] px-4 py-3 md:hidden"
          >
            <div className="grid gap-2">
              {PRIMARY_LINKS.map((item) =>
                item.external ? (
                  <a
                    key={item.label}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`rounded-xl px-4 py-3 ${navText} transition-colors ${mutedLink}`}
                    style={serif}
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`rounded-xl px-4 py-3 ${navText} transition-colors ${
                      item.match(pathname)
                        ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                        : mutedLink
                    }`}
                    style={serif}
                  >
                    {item.label}
                  </Link>
                ),
              )}
              <a
                href={MARKETING_GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
                className={`rounded-xl px-4 py-3 ${navText} transition-colors ${mutedLink}`}
                style={serif}
              >
                GitHub
              </a>
              {isAuthenticated ? (
                <Link
                  href="/app/settings?section=account"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`rounded-xl px-4 py-3 ${navText} transition-colors ${mutedLink}`}
                  style={serif}
                >
                  Account
                </Link>
              ) : null}

              <div className="mt-1 flex items-center gap-2">
                {landing ? (
                  <button
                    type="button"
                    onClick={landing.toggleLandingTheme}
                    className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[var(--border)] px-4 py-2.5 ${navText} text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]`}
                    style={serif}
                  >
                    {landing.landingTheme === "dark" ? (
                      <SunMedium className="h-4 w-4" />
                    ) : (
                      <MoonStar className="h-4 w-4" />
                    )}
                    <span>
                      {landing.landingTheme === "dark" ? "Light" : "Dark"}
                    </span>
                  </button>
                ) : null}
                <Link
                  href={appHref}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`inline-flex flex-1 items-center justify-center rounded-full bg-[var(--button-primary-bg)] px-4 py-2.5 ${navText} text-[var(--button-primary-text)] transition-opacity hover:opacity-90`}
                  style={serif}
                >
                  Get Started
                </Link>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
