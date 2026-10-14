'use client'

import { Suspense, type ReactNode } from 'react'
import { useLandingTheme } from '@/contexts/LandingThemeContext'
import { MarketingNavbar } from '@/features/marketing/components/MarketingNavbar'

/**
 * Token-based theme for every marketing / legal surface.
 *
 * Colors come from the app's CSS variables (see globals.css), scoped by the
 * `data-theme` attribute that `LandingThemeProvider` sets. Because the tokens
 * already resolve correctly for light and dark, these class strings no longer
 * need to branch on `isLandingDark` — keeping the surfaces identical to the app.
 */
export function useStaticMarketingTheme() {
  const { landingTheme, toggleLandingTheme, isLandingDark } = useLandingTheme()

  const shellClass = 'bg-(--background) text-(--foreground)'
  const panelClass = 'border-(--border) bg-(--surface-elevated)'
  const mutedClass = 'text-(--muted)'
  const subtleClass = 'text-(--muted-light)'
  const dividerClass = 'border-(--border)'
  const secondaryButtonClass =
    'border-(--border) text-(--foreground) hover:bg-(--surface-muted)'
  const primaryButtonClass =
    'bg-(--button-primary-bg) text-(--button-primary-text) hover:opacity-90'

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
  }
}

/**
 * Standalone marketing frame: navbar on top, page content below. Pages render
 * their own footer. This shell deliberately lives outside the application
 * sidebar shell — marketing pages are public surfaces, not demo tabs.
 */
export function StaticMarketingShell({ children }: { children: ReactNode }) {
  const theme = useStaticMarketingTheme()

  return (
    <div className={`min-h-screen ${theme.shellClass}`}>
      <Suspense fallback={null}>
        <MarketingNavbar />
      </Suspense>
      {children}
    </div>
  )
}
