import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Overlay · Administration',
  description: 'Overlay operator console',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The admin console is a dark-gray operations surface; the theme attribute
    // pins the shared @overlay/ui palette to its dark tokens.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-(--background) font-sans text-(--foreground) antialiased">
        {children}
      </body>
    </html>
  )
}
