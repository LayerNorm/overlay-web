"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Menu, MoonStar, SunMedium, X } from "lucide-react";
import Image from "next/image";
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
  getMarketingAppHref,
} from "@/shared/marketing/marketing";

/**
 * Primary nav items. Items with `hash` routes scroll to anchored sections on
 * `/home`; `Pricing` and `Docs` are standalone. Order matches the new copy:
 * Product · Organizations · Education · Open Source · Pricing · Docs.
 */
const PRIMARY_LINKS: Array<{
  href: string;
  label: string;
  match: (pathname: string) => boolean;
}> = [
  { href: "/home#product", label: "Product", match: (p) => p === "/home" },
  {
    href: "/home#organizations",
    label: "Organizations",
    match: (p) => p === "/home",
  },
  { href: "/home#education", label: "Education", match: (p) => p === "/home" },
  {
    href: "/home#open-source",
    label: "Open Source",
    match: (p) => p === "/home",
  },
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
 */
export function MarketingNavbar() {
  const pathname = usePathname() ?? "";
  const { isAuthenticated } = useAuth();
  const landing = useLandingThemeOptional();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const appHref = getMarketingAppHref(isAuthenticated);
  const accountIsActive = pathname === "/account";
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
            <Image
              src="/assets/overlay-logo.png"
              alt="Overlay"
              width={MARKETING_LOGO_SIZE}
              height={MARKETING_LOGO_SIZE}
              className="shrink-0"
            />
            <span
              className="truncate text-xl font-medium tracking-tight"
              style={serif}
            >
              overlay
            </span>
          </Link>

          <div className="hidden items-center gap-6 md:flex">
            {PRIMARY_LINKS.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`${navText} transition-colors ${activeLinkClass(item.match(pathname))}`}
                style={serif}
              >
                {item.label}
              </Link>
            ))}
            <a
              href={MARKETING_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${navText} transition-colors ${mutedLink}`}
              style={serif}
            >
              Docs
            </a>
            {isAuthenticated ? (
              <Link
                href="/account"
                className={`${navText} transition-colors ${activeLinkClass(accountIsActive)}`}
                style={serif}
              >
                Account
              </Link>
            ) : null}
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
            <Link
              href={
                isAuthenticated
                  ? appHref
                  : "/auth/sign-in?redirect=%2Fapp%2Fchat"
              }
              className={`inline-flex items-center rounded-full px-4 py-2 ${navText} text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]`}
              style={serif}
            >
              Sign in
            </Link>
            <Link
              href={appHref}
              className={`inline-flex items-center rounded-full bg-[var(--button-primary-bg)] px-4 py-2 ${navText} text-[var(--button-primary-text)] transition-opacity hover:opacity-90`}
              style={serif}
            >
              Try Overlay
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
              {PRIMARY_LINKS.map((item) => (
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
              ))}
              <a
                href={MARKETING_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
                className={`rounded-xl px-4 py-3 ${navText} transition-colors ${mutedLink}`}
                style={serif}
              >
                Docs
              </a>
              {isAuthenticated ? (
                <Link
                  href="/account"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`rounded-xl px-4 py-3 ${navText} transition-colors ${
                    accountIsActive
                      ? "bg-[var(--surface-subtle)] text-[var(--foreground)]"
                      : mutedLink
                  }`}
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
                  href={
                    isAuthenticated
                      ? appHref
                      : "/auth/sign-in?redirect=%2Fapp%2Fchat"
                  }
                  onClick={() => setMobileMenuOpen(false)}
                  className={`inline-flex flex-1 items-center justify-center rounded-full border border-[var(--border)] px-4 py-2.5 ${navText} text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]`}
                  style={serif}
                >
                  Sign in
                </Link>
                <Link
                  href={appHref}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`inline-flex flex-1 items-center justify-center rounded-full bg-[var(--button-primary-bg)] px-4 py-2.5 ${navText} text-[var(--button-primary-text)] transition-opacity hover:opacity-90`}
                  style={serif}
                >
                  Try Overlay
                </Link>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
