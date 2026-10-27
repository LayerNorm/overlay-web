'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, LogOut } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { AccountMessageBanner } from '@overlay/modules-react/settings'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useAuth } from '@/contexts/AuthContext'
import { AccountIdentity } from '@/features/account/components/AccountIdentity'
import { AccountWorkspaces } from '@/features/account/components/AccountWorkspaces'
import { DeleteAccountSection } from '@/features/account/components/DeleteAccountSection'
import { useAccountBillingState } from '@/features/account/hooks/useAccountBillingState'
import { useAccountHandoffs, useSessionCheckOnMount } from './account-handoffs'

export function AccountPageContent() {
  const { settings } = useAppSettings()
  const { user, isLoading, isAuthenticated, signOut, refreshSession } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const billing = useAccountBillingState()
  const sessionCheckComplete = useSessionCheckOnMount(isAuthenticated, isLoading, refreshSession)
  const { accountSignInHref, handleOpenInApp } = useAccountHandoffs({ searchParams, isAuthenticated, currentUserId: user?.id ?? null, sessionCheckComplete, billing, router })
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  return <div className="min-h-dvh bg-background text-foreground">
    <header className="flex items-center justify-between px-6 py-6 sm:px-10"><BrandLockup className="text-2xl" /><Button asChild variant="ghost" size="sm"><Link href="/app/work"><ArrowLeft className="size-4" />Back to app</Link></Button></header>
    <main className="mx-auto w-full max-w-[636px] px-6 pb-20 pt-12 sm:pt-16">
      {billing.message ? <div className="mb-6"><AccountMessageBanner message={billing.message} onOpenDesktop={handleOpenInApp} onOpenWeb={() => router.push('/app/work')} onDismiss={() => billing.setMessage(null)} /></div> : null}
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1><p className="mt-2 text-sm text-muted-foreground">Your identity across Overlay.</p>
      {isLoading || !sessionCheckComplete ? <p role="status" className="py-8 text-sm text-muted-foreground">Loading your account...</p> : !isAuthenticated ? <Button asChild variant="secondary" className="mt-8"><Link href={accountSignInHref}>Sign in</Link></Button> : <>
        <AccountIdentity />
        <AccountWorkspaces />
        {signOutError ? <p role="alert" className="mt-8 text-sm text-destructive">{signOutError}</p> : null}
        <div className="mt-14 flex items-center justify-between gap-4"><Button variant="ghost" size="sm" disabled={signingOut} onClick={() => {
          setSigningOut(true)
          setSignOutError(null)
          void signOut().catch(() => { setSigningOut(false); setSignOutError('Could not sign out. Please try again.') })
        }}><LogOut className="size-4" />{signingOut ? 'Signing out...' : 'Sign out'}</Button><DeleteAccountSection isLandingDark={settings.theme === 'dark'} /></div>
      </>}
    </main>
  </div>
}

export default function AccountPage() {
  return <Suspense fallback={<div className="min-h-dvh bg-background" />}><AccountPageContent /></Suspense>
}
