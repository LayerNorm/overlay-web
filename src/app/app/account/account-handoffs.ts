'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { useRouter, useSearchParams } from 'next/navigation'
import type { useAccountBillingState } from '@/features/account/hooks/useAccountBillingState'
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

// Always use overlay:// for deep links (registered in WorkOS for both environments)
const APP_PROTOCOL = 'overlay'

export type AccountBillingState = ReturnType<typeof useAccountBillingState>
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
export function useSessionCheckOnMount(
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

export function useAccountHandoffs({
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
