"use client";

import type { ReactNode } from "react";
import { useLandingTheme } from "@/contexts/LandingThemeContext";
import { AuthBoundary } from "@/contexts/AuthContext";
import { PublicSiteRail } from '@/components/layout/PublicSiteRail'

/**
 * Token-based theme for every marketing / account / legal surface.
 *
 * Colors come from the app's CSS variables (see globals.css), scoped by the
 * `data-theme` attribute that `LandingThemeProvider` sets. Because the tokens
 * already resolve correctly for light and dark, these class strings no longer
 * need to branch on `isLandingDark` — keeping the surfaces identical to the app.
 */
export function useStaticMarketingTheme() {
  const { landingTheme, toggleLandingTheme, isLandingDark } = useLandingTheme();

  const shellClass = "bg-[var(--background)] text-[var(--foreground)]";
  const panelClass = "border-[var(--border)] bg-[var(--surface-elevated)]";
  const mutedClass = "text-[var(--muted)]";
  const subtleClass = "text-[var(--muted-light)]";
  const dividerClass = "border-[var(--border)]";
  const secondaryButtonClass =
    "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]";
  const primaryButtonClass =
    "bg-[var(--button-primary-bg)] text-[var(--button-primary-text)] hover:opacity-90";

  return {
    landingTheme,
    toggleLandingTheme,
    isDark: isLandingDark,
    shellClass,
    panelClass,
    mutedClass,
    subtleClass,
    dividerClass,
    secondaryButtonClass,
    primaryButtonClass,
  };
}

export function StaticMarketingShell({ children }: { children: ReactNode }) {
  const theme = useStaticMarketingTheme();

  return (
    <AuthBoundary>
      <div className={`flex min-h-screen ${theme.shellClass}`}>
        <PublicSiteRail />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </AuthBoundary>
  );
}
