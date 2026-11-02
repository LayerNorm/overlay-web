import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import type { ReactNode } from 'react'

import { ADMIN_THEME_COOKIE, parseAdminTheme } from '@/features/admin/admin-theme'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' })

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: 'Overlay Admin',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseAdminTheme((await cookies()).get(ADMIN_THEME_COOKIE)?.value)
  return (
    <html lang="en" data-theme={theme} className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="bg-(--background) font-sans text-(--foreground) antialiased">
        {children}
      </body>
    </html>
  )
}
