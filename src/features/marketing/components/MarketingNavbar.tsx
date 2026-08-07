"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Menu, MoonStar, SunMedium, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
 * Primary nav items rendered before the Use Cases dropdown. Items with `hash`
 * routes scroll to anchored sections on `/home`; `Pricing` is standalone.
 * Full order: Product · Organizations · Use Cases (dropdown) · Open Source ·
 * Pricing · Docs.
 */
const PRIMARY_LINKS_BEFORE: Array<{
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
];

const PRIMARY_LINKS_AFTER: Array<{
  href: string;
  label: string;
  match: (pathname: string) => boolean;
}> = [
  {
    href: "/home#open-source",
    label: "Open Source",
    match: (p) => p === "/home",
  },
  { href: "/download", label: "Download", match: (p) => p === "/download" },
  { href: "/pricing", label: "Pricing", match: (p) => p === "/pricing" },
];

/**
 * Use case pages surfaced in the navbar dropdown. Each entry links to a
 * dedicated page under `/use-cases/<slug>`.
 */
const USE_CASE_LINKS: Array<{ href: string; label: string; description: string }> = [
  {
    href: "/use-cases/technology",
    label: "Technology",
    description: "Engineering, research, and developer workflows.",
  },
  {
    href: "/use-cases/education",
    label: "Education",
    description: "Curriculum-grounded, governed AI for schools and districts.",
  },
  {
    href: "/use-cases/healthcare",
    label: "Healthcare",
    description: "Private, auditable AI for clinical and admin workflows.",
  },
  {
    href: "/use-cases/law",
    label: "Law",
    description: "Knowledge-grounded AI for legal research and drafting.",
  },
  {
    href: "/use-cases/finance",
    label: "Finance",
    description: "Controlled AI for analysis, reporting, and compliance.",
  },
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
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAuth();
  const landing = useLandingThemeOptional();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [useCasesOpen, setUseCasesOpen] = useState(false);
  const useCasesRef = useRef<HTMLDivElement>(null);
  const appHref = getMarketingAppHref(isAuthenticated);
  const accountIsActive = pathname === "/account"
    || (pathname === "/app/settings" && searchParams?.get("section") === "account");
  const useCasesIsActive = pathname.startsWith("/use-cases");
  const serif = marketingSerifStyle();
  const navText = marketingNavText();

  // Close the Use Cases dropdown when a click lands outside it or on route change.
  useEffect(() => {
    if (!useCasesOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (useCasesRef.current && !useCasesRef.current.contains(event.target as Node)) {
        setUseCasesOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [useCasesOpen]);

  useEffect(() => {
    // Close the Use Cases dropdown on route change. This is the standard
    // pattern for closing menus on navigation — the lint rule flags it but
    // closing on pathname change cannot be done in an event handler since
    // navigation can be triggered by multiple sources.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUseCasesOpen(false);
  }, [pathname]);

  // Auth-aware account/sign-in link. Authenticated users see "Account"
  // (routes to account settings); unauthenticated users see "Sign in" (routes to the
  // sign-in page with a sanitized redirect to the app). The two are
  // interchangeable opposites — only one is rendered, in the same nav slot
  // next to Docs. The right-side CTA remains "Try Overlay", which already
  // routes authenticated users straight to the app.
  const authNavHref = isAuthenticated ? "/app/settings?section=account" : "/auth/sign-in?redirect=%2Fapp%2Fchat";
  const authNavLabel = isAuthenticated ? "Account" : "Sign in";
  const authNavActive = isAuthenticated ? accountIsActive : false;

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
            {PRIMARY_LINKS_BEFORE.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`${navText} transition-colors ${activeLinkClass(item.match(pathname))}`}
                style={serif}
              >
                {item.label}
              </Link>
            ))}

            {/* Use Cases dropdown */}
            <div
              ref={useCasesRef}
              className="relative"
              onMouseEnter={() => setUseCasesOpen(true)}
              onMouseLeave={() => setUseCasesOpen(false)}
            >
              <button
                type="button"
                aria-haspopup="true"
                aria-expanded={useCasesOpen}
                onClick={() => setUseCasesOpen((v) => !v)}
                className={`inline-flex items-center gap-1 ${navText} transition-colors ${activeLinkClass(useCasesIsActive)}`}
                style={serif}
              >
                Use Cases
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${useCasesOpen ? "rotate-180" : ""}`}
                  strokeWidth={2}
                />
              </button>
              <AnimatePresence initial={false}>
                {useCasesOpen ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1.5 shadow-[0_18px_60px_var(--overlay-scrim)]"
                  >
                    {USE_CASE_LINKS.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setUseCasesOpen(false)}
                        className="block px-4 py-2.5 transition-colors hover:bg-[var(--surface-muted)]"
                      >
                        <span
                          className={`block text-sm ${navText} text-[var(--foreground)]`}
                          style={serif}
                        >
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">
                          {item.description}
                        </span>
                      </Link>
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            {PRIMARY_LINKS_AFTER.map((item) => (
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
            <Link
              href={authNavHref}
              className={`${navText} transition-colors ${activeLinkClass(authNavActive)}`}
              style={serif}
            >
              {authNavLabel}
            </Link>
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
              {[...PRIMARY_LINKS_BEFORE, ...PRIMARY_LINKS_AFTER].map((item) => (
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
                  href="/app/settings?section=account"
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
