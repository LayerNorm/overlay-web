import type { Metadata } from 'next'
import { AppShellLayout } from '@/app/_components/AppShellLayout'

// The reusable shell resolves a private session before selecting authenticated
// or showcase data. Navigations into this route group may wait for that boundary.
export const instant = false

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export default function AuthShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShellLayout publicShowcase suppressGuestPrompts>
      {children}
    </AppShellLayout>
  )
}
