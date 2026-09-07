import type { Metadata } from 'next'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

/**
 * Standalone auth frame. Sign-in, sign-up, and recovery pages bring their own
 * boundary, theme, and chrome (`AuthPageChrome`); this layout only guarantees
 * a full-height surface outside the application shell.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {children}
    </div>
  )
}
