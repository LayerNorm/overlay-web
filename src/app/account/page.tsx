import { Suspense } from 'react'
import type { Metadata } from 'next'
import AccountPage from '@/app/app/account/account-content'
import { AppClientProviders } from '@/components/providers/AppClientProviders'
import { getOverlaySession } from '@/server/auth/session'

export const metadata: Metadata = { title: 'Account', robots: { index: false, follow: false } }

async function AccountContent() {
  const session = await getOverlaySession()
  return <AppClientProviders initialUser={session?.user ?? null} requiresConvexClient={false}><AccountPage /></AppClientProviders>
}

export default function Page() {
  return <Suspense fallback={<div className="min-h-dvh bg-background" />}><AccountContent /></Suspense>
}
