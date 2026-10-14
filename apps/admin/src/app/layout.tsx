import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: 'Overlay Admin',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="bg-(--background) text-(--foreground) antialiased">
        {children}
      </body>
    </html>
  )
}
