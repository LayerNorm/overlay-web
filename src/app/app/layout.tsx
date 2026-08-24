import type { Metadata } from 'next'
import { AppShellLayout } from '@/app/_components/AppShellLayout'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShellLayout>{children}</AppShellLayout>
}
