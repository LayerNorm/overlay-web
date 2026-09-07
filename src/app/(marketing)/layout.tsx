import type { Metadata } from 'next'
import { AuthBoundary } from '@/contexts/AuthContext'
import { LandingThemeProvider } from '@/contexts/LandingThemeContext'

export const metadata: Metadata = {
  robots: {
    index: true,
    follow: true,
  },
}

/**
 * Standalone marketing frame. These pages render outside the application
 * shell: no sidebar, no session resolution, no showcase demo state. Page
 * components bring their own content and footer; the shared shell below
 * provides the navbar, auth context, and landing theme.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthBoundary>
      <LandingThemeProvider>{children}</LandingThemeProvider>
    </AuthBoundary>
  )
}
