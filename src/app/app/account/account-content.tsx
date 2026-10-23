'use client'

import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'

// Compatibility wrapper: account and billing transport lives behind @overlay/api-client
// while this web container keeps current billing flows and redirects unchanged.
import { useState, Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { redirect, useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw, ArrowRight } from 'lucide-react'
import { DeleteAccountSection } from '@/features/account/components/DeleteAccountSection'
import { useAccountBillingState } from '@/features/account/hooks/useAccountBillingState'
import { useAuth } from '@/contexts/AuthContext'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useAccountHandoffs, useSessionCheckOnMount, type AccountBillingState } from './account-handoffs'
import {
  minimalBody,
  minimalDisplaySm,
  minimalLabel,
  minimalPanel,
  minimalSectionSm,
  minimalSerif,
} from '@/features/marketing/lib/minimalLayout'
import {
  AccountLoadingState,
  AccountMessageBanner,
  AccountProfileCard,
  AccountSignInPrompt,
} from '@overlay/modules-react/settings'

function AccountIntro() {
  return (
    <div className="mb-12">
      <p className={minimalLabel()}>Account</p>
      <h1 className={`mt-4 ${minimalDisplaySm()}`} style={minimalSerif()}>
        Your Overlay control center.
      </h1>
      <p className={`mt-5 max-w-xl ${minimalBody()}`}>
        Manage plan status, usage, top-ups, and account access.
      </p>
    </div>
  )
}

function AuthenticatedAccountPanels({
  panelClass,
  headingClass,
  mutedClass,
  dark,
  name,
  email,
  signingOut,
  onSignOut,
  billing,
}: {
  panelClass: string
  headingClass: string
  mutedClass: string
  dark: boolean
  name?: string | null
  email?: string | null
  signingOut: boolean
  onSignOut: () => void
  billing: AccountBillingState
}) {
  return (
    <div className="space-y-5">
      <AccountProfileCard
        panelClass={panelClass}
        headingClass={headingClass}
        mutedClass={mutedClass}
        dark={dark}
        name={name}
        email={email}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost"
              onClick={onSignOut}
              disabled={signingOut}
              className={unstyledButton(`rounded-md px-2 py-1.5 text-xs font-medium text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground) disabled:opacity-50`)}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
            <Suspense fallback={null}>
              <DeleteAccountSection isLandingDark={dark} />
            </Suspense>
          </div>
        }
      />

      {billing.billingEnabled ? (
        <section className={panelClass}>
          <h2 className={`text-sm font-medium ${headingClass}`}>Billing</h2>
          <p className={`mt-1 text-sm ${mutedClass}`}>
            Plans belong to workspaces, not accounts. Each workspace is free or paid on its own.
          </p>
          <Link
            href="/app/settings?section=workspace&workspace_tab=billing"
            className="mt-3 inline-flex rounded-md border border-(--border) px-3 py-1.5 text-xs font-medium text-(--foreground) transition-colors hover:bg-(--surface-muted)"
          >
            Workspace billing
          </Link>
        </section>
      ) : null}
    </div>
  )
}

export function AccountPageContent({ embedded = false }: { embedded?: boolean }) {
  const { settings } = useAppSettings()
  const isLandingDark = settings.theme === 'dark'
  const panel = minimalPanel() + ' p-5'
  const panelLg = 'mx-auto max-w-md ' + minimalPanel() + ' p-8'
  const t = {
    title: 'font-serif text-(--foreground)',
    h: 'text-(--foreground)',
    muted: 'text-(--muted)',
    body: minimalBody(),
  }
  const router = useRouter()
  const searchParams = useSearchParams()

  // Get userId from AuthContext (session-based)
  const { user, isLoading: authLoading, isAuthenticated, signOut, refreshSession } = useAuth()
  const currentUserId = user?.id || null
  const [signingOut, setSigningOut] = useState(false)
  const billing = useAccountBillingState()
  const sessionCheckComplete = useSessionCheckOnMount(isAuthenticated, authLoading, refreshSession)

  const { accountSignInHref, handleOpenInApp } = useAccountHandoffs({
    searchParams,
    isAuthenticated,
    currentUserId,
    sessionCheckComplete,
    billing,
    router,
  })

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
    } catch (error) {
      console.error('Sign out error:', error)
      setSigningOut(false)
    }
  }

  const Content = embedded ? 'div' : 'main'

  return (
    <Content className={embedded ? 'space-y-5' : minimalSectionSm()}>
      <div className={embedded ? 'w-full' : 'mx-auto max-w-3xl'}>
        {billing.message ? (
          <AccountMessageBanner
            message={billing.message}
            onOpenDesktop={handleOpenInApp}
            onOpenWeb={() => router.push('/app/chat')}
            onDismiss={() => billing.setMessage(null)}
          />
        ) : null}

        {!embedded ? <AccountIntro /> : null}

        <AccountContentBody
          ready={!billing.loading && !authLoading && sessionCheckComplete && billing.capabilitiesLoaded}
          isAuthenticated={isAuthenticated}
          loadingMutedClass={t.muted}
          dark={isLandingDark}
          signInPrompt={
            <AccountSignInPrompt
              panelClass={panelLg}
              headingClass={t.h}
              mutedClass={t.muted}
              action={
                <Link
                  href={accountSignInHref}
                  className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium transition-opacity hover:opacity-90 bg-(--button-primary-bg) text-(--button-primary-text)"
                >
                  Sign in
                  <ArrowRight className="w-4 h-4" />
                </Link>
              }
            />
          }
          panels={
            <AuthenticatedAccountPanels
              panelClass={panel}
              headingClass={t.h}
              mutedClass={t.muted}
              dark={isLandingDark}
              name={user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.email}
              email={user?.email}
              signingOut={signingOut}
              onSignOut={handleSignOut}
              billing={billing}
            />
          }
        />
      </div>
    </Content>
  )
}

function AccountContentBody({
  ready,
  isAuthenticated,
  loadingMutedClass,
  dark,
  signInPrompt,
  panels,
}: {
  ready: boolean
  isAuthenticated: boolean
  loadingMutedClass: string
  dark: boolean
  signInPrompt: ReactNode
  panels: ReactNode
}) {
  if (!ready) return <AccountLoadingState mutedClass={loadingMutedClass} dark={dark} />
  if (!isAuthenticated) return <>{signInPrompt}</>
  return <>{panels}</>
}

function AccountPageRedirect() {
  const searchParams = useSearchParams()
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('section', 'account')
  redirect(`/app/settings?${params.toString()}`)

  return (
    <div className="flex min-h-screen items-center justify-center bg-(--background) text-(--foreground)">
      <div className="relative z-10 text-center">
        <RefreshCw className="mx-auto h-8 w-8 animate-spin text-(--muted)" />
        <p className="mt-4 text-(--muted)">Opening account settings…</p>
      </div>
    </div>
  )
}

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-(--background) text-(--foreground)">
          <div className="relative z-10 text-center">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-(--muted)" />
            <p className="mt-4 text-(--muted)">Loading...</p>
          </div>
        </div>
      }
    >
      <AccountPageRedirect />
    </Suspense>
  )
}
