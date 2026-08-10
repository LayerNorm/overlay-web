'use client'

// Compatibility wrapper: account and billing transport lives behind @overlay/api-client
// while this web container keeps current billing flows and redirects unchanged.
import { useState, useEffect, Suspense, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
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

function triggerDeepLink(url: string) {
  console.log('[Account] Triggering deep link:', url)
  window.location.href = url
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
  const desktopCodeChallengeFromUrl = searchParams?.get('desktop_code_challenge')?.trim() || ''
  const desktopCodeChallenge = desktopCodeChallengeFromUrl || getStoredDesktopPkceChallenge() || ''
  const extensionHandoff = searchParams?.get('extension_handoff') === '1'
  const chromeExtensionIdRaw = searchParams?.get('chrome_extension_id')?.trim() || ''
  const extensionHandoffSentRef = useRef(false)
  const desktopHandoffSentRef = useRef(false)
  const accountSignInHref = desktopCodeChallenge
    ? `/auth/sign-in?redirect=${encodeURIComponent(
        `/account?desktop_code_challenge=${encodeURIComponent(desktopCodeChallenge)}`,
      )}`
    : '/auth/sign-in'

  // Get userId from AuthContext (session-based)
  const { user, isLoading: authLoading, isAuthenticated, signOut, refreshSession } = useAuth()
  const currentUserId = user?.id || null
  const [signingOut, setSigningOut] = useState(false)
  const [sessionCheckComplete, setSessionCheckComplete] = useState(false)
  const {
    actionLoading,
    autoTopUpEnabledDraft,
    billingEnabled,
    billingSettings,
    capabilitiesLoaded,
    entitlements,
    entitlementsError,
    handleManageBilling,
    handleStartTopUp,
    handleTopUpPreferenceSave,
    loading,
    message,
    retryEntitlements,
    setActionLoading,
    setAutoTopUpEnabledDraft,
    setMessage,
    setTopUpAmountDraftCents,
    topUpAmountDraftCents,
    topUpHistory,
  } = useAccountBillingState({
    authLoading,
    currentUserId,
    isAuthenticated,
    router,
    searchParams,
  })

  useEffect(() => {
    persistMobilePkceChallengeFromUrl(searchParams)
  }, [searchParams])

  // Refresh session on mount to ensure we have the latest session state
  // This fixes the race condition when redirecting from auth callback
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

  useEffect(() => {
    if (!extensionHandoff || !chromeExtensionIdRaw || !desktopCodeChallenge) return
    if (!isAuthenticated || !currentUserId || !sessionCheckComplete) return
    if (extensionHandoffSentRef.current) return
    if (!/^[a-p]{32}$/.test(chromeExtensionIdRaw)) return

    extensionHandoffSentRef.current = true
    let cancelled = false

    void (async () => {
      try {
        const response = await overlayAppClient.account.desktopLinkResponse({
          codeChallenge: desktopCodeChallenge,
          chromeExtensionId: chromeExtensionIdRaw,
        })
        if (cancelled || !response.ok) {
          extensionHandoffSentRef.current = false
          return
        }
        const json = (await response.json()) as { deepLink?: string }
        const deepLink = typeof json.deepLink === 'string' ? json.deepLink : ''
        const tokenMatch = deepLink.match(/[?&]token=([^&]+)/)
        const rawToken = tokenMatch?.[1]
        const token = rawToken ? decodeURIComponent(rawToken) : ''
        if (!token || cancelled) {
          extensionHandoffSentRef.current = false
          return
        }

        const chromeRuntime = (
          typeof window !== 'undefined'
            ? (
                window as unknown as {
                  chrome?: {
                    runtime?: {
                      sendMessage: (extId: string, msg: unknown, cb?: () => void) => void
                      lastError?: { message: string }
                    }
                  }
                }
              ).chrome?.runtime
            : undefined
        )
        if (!chromeRuntime?.sendMessage) {
          extensionHandoffSentRef.current = false
          return
        }

        chromeRuntime.sendMessage(
          chromeExtensionIdRaw,
          { type: 'overlay.extension.auth.handoff', token },
          () => {
            void chromeRuntime.lastError
          },
        )
        setMessage({
          type: 'success',
          text: 'Chrome extension connected. You can return to the side panel and press Refresh if needed.',
        })
      } catch (e) {
        console.error('[Account] Extension handoff error:', e)
        extensionHandoffSentRef.current = false
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
    chromeExtensionIdRaw,
    currentUserId,
    desktopCodeChallenge,
    extensionHandoff,
    isAuthenticated,
    router,
    sessionCheckComplete,
    setMessage,
  ])

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
    } catch (error) {
      console.error('Sign out error:', error)
      setSigningOut(false)
    }
  }

  const performDesktopHandoff = useCallback(async (fallbackToApp: boolean): Promise<boolean> => {
    setActionLoading('openApp')
    try {
      const codeChallenge = desktopCodeChallenge.trim()
      if (!isValidDesktopCodeChallenge(codeChallenge)) {
        console.warn('[Account] Missing desktop auth handshake')
        if (fallbackToApp) triggerDeepLink(`${APP_PROTOCOL}://subscription-updated`)
        return false
      }

      const response = await overlayAppClient.account.desktopLinkResponse({ codeChallenge })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        console.error('[Account] Failed to generate desktop link', {
          status: response.status,
          error: errorBody,
        })
        if (fallbackToApp) triggerDeepLink(`${APP_PROTOCOL}://subscription-updated`)
        return false
      }

      const { deepLink } = await response.json()
      const tokenMatch = deepLink.match(/[?&]token=([^&]+)/)
      const token = tokenMatch?.[1]

      // In dev mode, the Electron app runs a local HTTP server because macOS deep links
      // are unreliable for child processes (electron-vite spawns Electron as a subprocess,
      // so Launch Services never fires open-url on the running instance).
      if (token) {
        try {
          const localUrl = new URL('http://localhost:45738/auth')
          localUrl.searchParams.set('token', token)
          localUrl.searchParams.set('server', window.location.origin)
          const localRes = await fetch(localUrl.toString(), {
            signal: AbortSignal.timeout(1500),
          })
          if (localRes.ok) {
            console.log('[Account] Auth handled via local dev server')
            clearStoredDesktopPkceChallenge()
            return true
          }
        } catch {
          // Dev server not available — fall through to deep link (production path)
        }
      }

      console.log('[Account] Opening desktop app via deep link')
      clearStoredDesktopPkceChallenge()
      triggerDeepLink(deepLink)
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
    if (desktopHandoffSentRef.current) return

    desktopHandoffSentRef.current = true
    void performDesktopHandoff(false).then((completed) => {
      if (!completed) desktopHandoffSentRef.current = false
    })
  }, [
    currentUserId,
    desktopCodeChallengeFromUrl,
    isAuthenticated,
    performDesktopHandoff,
    sessionCheckComplete,
  ])

  const handleOpenInApp = useCallback(() => {
    void performDesktopHandoff(true)
  }, [performDesktopHandoff])

  const Content = embedded ? 'div' : 'main'

  return (
    <Content className={embedded ? 'space-y-5' : minimalSectionSm()}>
      <div className={embedded ? 'w-full' : 'mx-auto max-w-3xl'}>
        {message ? (
          <AccountMessageBanner
            message={message}
            onOpenDesktop={handleOpenInApp}
            onOpenWeb={() => router.push('/app/chat')}
            onDismiss={() => setMessage(null)}
          />
        ) : null}

        {!embedded ? (
          <div className="mb-12">
            <p className={minimalLabel()}>Account</p>
            <h1 className={`mt-4 ${minimalDisplaySm()}`} style={minimalSerif()}>
              Your Overlay control center.
            </h1>
            <p className={`mt-5 max-w-xl ${minimalBody()}`}>
              Manage plan status, usage, top-ups, desktop handoff, and account access.
            </p>
          </div>
        ) : null}

        {loading || authLoading || !sessionCheckComplete || !capabilitiesLoaded ? (
          <AccountLoadingState mutedClass={t.muted} dark={isLandingDark} />
        ) : !isAuthenticated ? (
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
        ) : (
          <div className="space-y-5">
            <AccountProfileCard
              panelClass={panel}
              headingClass={t.h}
              mutedClass={t.muted}
              dark={isLandingDark}
              name={user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.email}
              email={user?.email}
              actions={
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="rounded-md px-2 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:opacity-50"
                  >
                    {signingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                  <DeleteAccountSection isLandingDark={isLandingDark} />
                </div>
              }
            />

            <section className={`${panel} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <MonitorDown size={16} strokeWidth={1.8} />
                  Desktop app
                </div>
                <p className={`mt-1 text-sm ${t.muted}`}>Open your existing desktop session, or download the macOS app.</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  onClick={handleOpenInApp}
                  disabled={actionLoading === 'openApp'}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-secondary-text)] transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-50"
                >
                  {actionLoading === 'openApp' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {actionLoading === 'openApp' ? 'Opening…' : 'Open app'}
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

            <AccountBillingPanel
              actionLoading={actionLoading}
              autoTopUpEnabledDraft={autoTopUpEnabledDraft}
              billingEnabled={billingEnabled}
              billingSettings={billingSettings}
              dark={isLandingDark}
              entitlements={entitlements}
              entitlementsError={entitlementsError}
              headingClass={t.h}
              mutedClass={t.muted}
              onManageBilling={handleManageBilling}
              onRetryEntitlements={retryEntitlements}
              onSaveTopUpPreference={handleTopUpPreferenceSave}
              onStartTopUp={handleStartTopUp}
              panelClass={panel}
              setAutoTopUpEnabledDraft={setAutoTopUpEnabledDraft}
              setTopUpAmountDraftCents={setTopUpAmountDraftCents}
              topUpAmountDraftCents={topUpAmountDraftCents}
              topUpHistory={topUpHistory}
            />
          </div>
        )}
      </div>
    </Content>
  )
}

function AccountPageRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('section', 'account')
    router.replace(`/app/settings?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

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
