'use client'

// Compatibility wrapper: account and billing transport lives behind @overlay/api-client
// while this web container keeps current billing flows and redirects unchanged.
import { useState, useEffect, Suspense, useRef, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { redirect, useRouter, useSearchParams } from 'next/navigation'
import { Download, MonitorDown, RefreshCw, ArrowRight } from 'lucide-react'
import { AccountBillingPanel } from '@/features/billing/components/AccountBillingPanel'
import { DeleteAccountSection } from '@/features/account/components/DeleteAccountSection'
import { useAccountBillingState } from '@/features/account/hooks/useAccountBillingState'
import { useAuth } from '@/contexts/AuthContext'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  clearStoredDesktopPkceChallenge,
  getStoredDesktopPkceChallenge,
  persistMobilePkceChallengeFromUrl,
} from '@/shared/auth/mobile-auth-client'
import {
  isValidDesktopCodeChallenge,
  shouldStartDesktopHandoff,
} from '@/shared/auth/desktop-auth-handoff'
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

// Always use overlay:// for deep links (registered in WorkOS for both environments)
const APP_PROTOCOL = 'overlay'

type AccountBillingState = ReturnType<typeof useAccountBillingState>
type AccountRouter = { replace: (href: string, options?: { scroll?: boolean }) => void }

function triggerDeepLink(url: string) {
  // Server-supplied value assigned to location: only the app's own scheme is
  // allowed, so a javascript: URL can never reach the navigation.
  if (typeof url !== 'string' || !url.startsWith(`${APP_PROTOCOL}://`)) return
  console.log('[Account] Triggering deep link:', url)
  window.location.href = url
}

function getChromeRuntime() {
  if (typeof window === 'undefined') return undefined
  return (
    window as unknown as {
      chrome?: {
        runtime?: {
          sendMessage: (extId: string, msg: unknown, cb?: () => void) => void
          lastError?: { message: string }
        }
      }
    }
  ).chrome?.runtime
}

async function deliverExtensionHandoff({
  codeChallenge,
  chromeExtensionId,
  isCancelled,
}: {
  codeChallenge: string
  chromeExtensionId: string
  isCancelled: () => boolean
}): Promise<boolean> {
  const response = await overlayAppClient.account.desktopLinkResponse({
    codeChallenge,
    chromeExtensionId,
  })
  if (isCancelled() || !response.ok) return false
  const json = (await response.json()) as { deepLink?: string }
  const deepLink = typeof json.deepLink === 'string' ? json.deepLink : ''
  const tokenMatch = deepLink.match(/[?&]token=([^&]+)/)
  const rawToken = tokenMatch?.[1]
  const token = rawToken ? decodeURIComponent(rawToken) : ''
  if (!token || isCancelled()) return false

  const chromeRuntime = getChromeRuntime()
  if (!chromeRuntime?.sendMessage) return false
  chromeRuntime.sendMessage(
    chromeExtensionId,
    { type: 'overlay.extension.auth.handoff', token },
    () => {
      void chromeRuntime.lastError
    },
  )
  return true
}

function useExtensionHandoff({
  extensionHandoff,
  chromeExtensionId,
  desktopCodeChallenge,
  isAuthenticated,
  currentUserId,
  sessionCheckComplete,
  setMessage,
  router,
}: {
  extensionHandoff: boolean
  chromeExtensionId: string
  desktopCodeChallenge: string
  isAuthenticated: boolean
  currentUserId: string | null
  sessionCheckComplete: boolean
  setMessage: AccountBillingState['setMessage']
  router: AccountRouter
}) {
  const handoffSentRef = useRef(false)

  useEffect(() => {
    if (!extensionHandoff || !chromeExtensionId || !desktopCodeChallenge) return
    if (!isAuthenticated || !currentUserId || !sessionCheckComplete) return
    if (handoffSentRef.current) return
    if (!/^[a-p]{32}$/.test(chromeExtensionId)) return

    handoffSentRef.current = true
    let cancelled = false

    void (async () => {
      try {
        const sent = await deliverExtensionHandoff({
          codeChallenge: desktopCodeChallenge,
          chromeExtensionId,
          isCancelled: () => cancelled,
        })
        if (!sent) {
          handoffSentRef.current = false
          return
        }
        setMessage({
          type: 'success',
          text: 'Chrome extension connected. You can return to the side panel and press Refresh if needed.',
        })
      } catch (e) {
        console.error('[Account] Extension handoff error:', e)
        handoffSentRef.current = false
      } finally {
        if (!cancelled && typeof window !== 'undefined') {
          const next = new URL(window.location.href)
          next.searchParams.delete('extension_handoff')
          next.searchParams.delete('chrome_extension_id')
          next.searchParams.delete('desktop_code_challenge')
          router.replace(`${next.pathname}${next.search}`, { scroll: false })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    chromeExtensionId,
    currentUserId,
    desktopCodeChallenge,
    extensionHandoff,
    isAuthenticated,
    router,
    sessionCheckComplete,
    setMessage,
  ])
}

async function requestDesktopDeepLink(
  codeChallenge: string,
): Promise<{ deepLink: string; token?: string } | null> {
  const response = await overlayAppClient.account.desktopLinkResponse({ codeChallenge })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    console.error('[Account] Failed to generate desktop link', {
      status: response.status,
      error: errorBody,
    })
    return null
  }
  const { deepLink } = await response.json()
  const tokenMatch = deepLink.match(/[?&]token=([^&]+)/)
  return { deepLink, token: tokenMatch?.[1] }
}

// In dev mode, the Electron app runs a local HTTP server because macOS deep links
// are unreliable for child processes (electron-vite spawns Electron as a subprocess,
// so Launch Services never fires open-url on the running instance).
async function tryLocalDevHandoff(token: string): Promise<boolean> {
  try {
    const localUrl = new URL('http://localhost:45738/auth')
    localUrl.searchParams.set('token', token)
    localUrl.searchParams.set('server', window.location.origin)
    const localRes = await fetch(localUrl.toString(), {
      signal: AbortSignal.timeout(1500),
    })
    if (localRes.ok) {
      console.log('[Account] Auth handled via local dev server')
      return true
    }
  } catch {
    // Dev server not available — fall through to deep link (production path)
  }
  return false
}

function useDesktopHandoff({
  desktopCodeChallenge,
  desktopCodeChallengeFromUrl,
  isAuthenticated,
  currentUserId,
  sessionCheckComplete,
  setActionLoading,
}: {
  desktopCodeChallenge: string
  desktopCodeChallengeFromUrl: string
  isAuthenticated: boolean
  currentUserId: string | null
  sessionCheckComplete: boolean
  setActionLoading: AccountBillingState['setActionLoading']
}) {
  const handoffSentRef = useRef(false)

  const performDesktopHandoff = useCallback(async (fallbackToApp: boolean): Promise<boolean> => {
    setActionLoading('openApp')
    try {
      const codeChallenge = desktopCodeChallenge.trim()
      if (!isValidDesktopCodeChallenge(codeChallenge)) {
        console.warn('[Account] Missing desktop auth handshake')
        if (fallbackToApp) triggerDeepLink(`${APP_PROTOCOL}://subscription-updated`)
        return false
      }

      const link = await requestDesktopDeepLink(codeChallenge)
      if (!link) {
        if (fallbackToApp) triggerDeepLink(`${APP_PROTOCOL}://subscription-updated`)
        return false
      }

      if (link.token && (await tryLocalDevHandoff(link.token))) {
        clearStoredDesktopPkceChallenge()
        return true
      }

      console.log('[Account] Opening desktop app via deep link')
      clearStoredDesktopPkceChallenge()
      triggerDeepLink(link.deepLink)
      return true
    } catch (error) {
      console.error('[Account] Error generating desktop link:', error)
      if (fallbackToApp) triggerDeepLink(`${APP_PROTOCOL}://subscription-updated`)
      return false
    } finally {
      setActionLoading(null)
    }
  }, [desktopCodeChallenge, setActionLoading])

  // A PKCE challenge in the URL proves this tab was opened by the desktop app.
  // Once the existing web session is ready, return it to the app automatically.
  useEffect(() => {
    if (!shouldStartDesktopHandoff({
      codeChallenge: desktopCodeChallengeFromUrl,
      isAuthenticated,
      userId: currentUserId,
      sessionCheckComplete,
    })) return
    if (handoffSentRef.current) return

    handoffSentRef.current = true
    void performDesktopHandoff(false).then((completed) => {
      if (!completed) handoffSentRef.current = false
    })
  }, [
    currentUserId,
    desktopCodeChallengeFromUrl,
    isAuthenticated,
    performDesktopHandoff,
    sessionCheckComplete,
  ])

  return useCallback(() => {
    void performDesktopHandoff(true)
  }, [performDesktopHandoff])
}

// Refresh session on mount to ensure we have the latest session state
// This fixes the race condition when redirecting from auth callback
function useSessionCheckOnMount(
  isAuthenticated: boolean,
  authLoading: boolean,
  refreshSession: () => Promise<void>,
) {
  const [sessionCheckComplete, setSessionCheckComplete] = useState(false)

  useEffect(() => {
    let mounted = true
    const checkSession = async () => {
      // If already authenticated or auth is still loading, skip refresh
      if (isAuthenticated || authLoading) {
        if (mounted) {
          setSessionCheckComplete(true)
        }
        return
      }
      // Give a small delay for cookies to be fully set after redirect
      await new Promise(resolve => setTimeout(resolve, 100))
      await refreshSession()
      if (mounted) {
        setSessionCheckComplete(true)
      }
    }
    checkSession()
    return () => { mounted = false }
  }, [isAuthenticated, authLoading, refreshSession])

  return sessionCheckComplete
}

function AccountIntro() {
  return (
    <div className="mb-12">
      <p className={minimalLabel()}>Account</p>
      <h1 className={`mt-4 ${minimalDisplaySm()}`} style={minimalSerif()}>
        Your Overlay control center.
      </h1>
      <p className={`mt-5 max-w-xl ${minimalBody()}`}>
        Manage plan status, usage, top-ups, desktop handoff, and account access.
      </p>
    </div>
  )
}

function DesktopAppSection({
  panelClass,
  mutedClass,
  opening,
  onOpenInApp,
}: {
  panelClass: string
  mutedClass: string
  opening: boolean
  onOpenInApp: () => void
}) {
  return (
    <section className={`${panelClass} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
          <MonitorDown size={16} strokeWidth={1.8} />
          Desktop app
        </div>
        <p className={`mt-1 text-sm ${mutedClass}`}>Open your existing desktop session, or download the macOS app.</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          onClick={onOpenInApp}
          disabled={opening}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-secondary-text)] transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-50"
        >
          {opening ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {opening ? 'Opening…' : 'Open app'}
        </button>
        <Link
          href="/download"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-secondary-text)] transition-colors hover:bg-[var(--surface-muted)]"
        >
          <Download className="h-4 w-4" />
          Download
        </Link>
      </div>
    </section>
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
  openingApp,
  onOpenInApp,
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
  openingApp: boolean
  onOpenInApp: () => void
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
            <button
              onClick={onSignOut}
              disabled={signingOut}
              className="rounded-md px-2 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
            <Suspense fallback={null}>
              <DeleteAccountSection isLandingDark={dark} />
            </Suspense>
          </div>
        }
      />

      <DesktopAppSection
        panelClass={panelClass}
        mutedClass={mutedClass}
        opening={openingApp}
        onOpenInApp={onOpenInApp}
      />

      <AccountBillingPanel
        actionLoading={billing.actionLoading}
        autoTopUpEnabledDraft={billing.autoTopUpEnabledDraft}
        billingEnabled={billing.billingEnabled}
        billingSettings={billing.billingSettings}
        dark={dark}
        entitlements={billing.entitlements}
        entitlementsError={billing.entitlementsError}
        headingClass={headingClass}
        mutedClass={mutedClass}
        onManageBilling={billing.handleManageBilling}
        onRetryEntitlements={billing.retryEntitlements}
        onSaveTopUpPreference={billing.handleTopUpPreferenceSave}
        onStartTopUp={billing.handleStartTopUp}
        panelClass={panelClass}
        setAutoTopUpEnabledDraft={billing.setAutoTopUpEnabledDraft}
        setTopUpAmountDraftCents={billing.setTopUpAmountDraftCents}
        topUpAmountDraftCents={billing.topUpAmountDraftCents}
        topUpHistory={billing.topUpHistory}
      />
    </div>
  )
}

function useAccountHandoffs({
  searchParams,
  isAuthenticated,
  currentUserId,
  sessionCheckComplete,
  billing,
  router,
}: {
  searchParams: ReturnType<typeof useSearchParams>
  isAuthenticated: boolean
  currentUserId: string | null
  sessionCheckComplete: boolean
  billing: ReturnType<typeof useAccountBillingState>
  router: ReturnType<typeof useRouter>
}) {
  const desktopCodeChallengeFromUrl = searchParams?.get('desktop_code_challenge')?.trim() || ''
  const desktopCodeChallenge = desktopCodeChallengeFromUrl || getStoredDesktopPkceChallenge() || ''
  const extensionHandoff = searchParams?.get('extension_handoff') === '1'
  const chromeExtensionIdRaw = searchParams?.get('chrome_extension_id')?.trim() || ''
  const accountSignInHref = desktopCodeChallenge
    ? `/auth/sign-in?redirect=${encodeURIComponent(
        `/account?desktop_code_challenge=${encodeURIComponent(desktopCodeChallenge)}`,
      )}`
    : '/auth/sign-in'

  useEffect(() => {
    persistMobilePkceChallengeFromUrl(searchParams)
  }, [searchParams])

  useExtensionHandoff({
    extensionHandoff,
    chromeExtensionId: chromeExtensionIdRaw,
    desktopCodeChallenge,
    isAuthenticated,
    currentUserId,
    sessionCheckComplete,
    setMessage: billing.setMessage,
    router,
  })

  const handleOpenInApp = useDesktopHandoff({
    desktopCodeChallenge,
    desktopCodeChallengeFromUrl,
    isAuthenticated,
    currentUserId,
    sessionCheckComplete,
    setActionLoading: billing.setActionLoading,
  })

  return { accountSignInHref, handleOpenInApp }
}

export function AccountPageContent({ embedded = false }: { embedded?: boolean }) {
  const { settings } = useAppSettings()
  const isLandingDark = settings.theme === 'dark'
  const panel = minimalPanel() + ' p-5'
  const panelLg = 'mx-auto max-w-md ' + minimalPanel() + ' p-8'
  const t = {
    title: 'font-serif text-[var(--foreground)]',
    h: 'text-[var(--foreground)]',
    muted: 'text-[var(--muted)]',
    body: minimalBody(),
  }
  const router = useRouter()
  const searchParams = useSearchParams()

  // Get userId from AuthContext (session-based)
  const { user, isLoading: authLoading, isAuthenticated, signOut, refreshSession } = useAuth()
  const currentUserId = user?.id || null
  const [signingOut, setSigningOut] = useState(false)
  const billing = useAccountBillingState({
    authLoading,
    currentUserId,
    isAuthenticated,
    router,
    searchParams,
  })
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
                  className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium transition-opacity hover:opacity-90 bg-[var(--button-primary-bg)] text-[var(--button-primary-text)]"
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
              openingApp={billing.actionLoading === 'openApp'}
              onOpenInApp={handleOpenInApp}
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
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
      <div className="relative z-10 text-center">
        <RefreshCw className="mx-auto h-8 w-8 animate-spin text-[var(--muted)]" />
        <p className="mt-4 text-[var(--muted)]">Opening account settings…</p>
      </div>
    </div>
  )
}

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
          <div className="relative z-10 text-center">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-[var(--muted)]" />
            <p className="mt-4 text-[var(--muted)]">Loading...</p>
          </div>
        </div>
      }
    >
      <AccountPageRedirect />
    </Suspense>
  )
}
