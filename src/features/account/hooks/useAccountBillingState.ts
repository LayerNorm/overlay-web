'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_OVERLAY_CAPABILITIES,
  type AccountEntitlements,
  type BillingSettings,
  type CapabilityCheck,
  type TopUpHistoryItem,
} from '@overlay/app-core'
import { normalizeTopUpDraft } from '@overlay/app-core/settings-account'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

type AccountMessage = { type: 'success' | 'error'; text: string }

type AccountRouter = {
  replace: (href: string, options?: { scroll?: boolean }) => void
}

type AccountSearchParams = {
  get: (name: string) => string | null
  toString: () => string
} | null

export function useAccountBillingState({
  authLoading,
  currentUserId,
  isAuthenticated,
  router,
  searchParams,
}: {
  authLoading: boolean
  currentUserId: string | null
  isAuthenticated: boolean
  router: AccountRouter
  searchParams: AccountSearchParams
}) {
  const sessionId = searchParams?.get('session_id') ?? null
  const successParam = searchParams?.get('success')
  const canceledParam = searchParams?.get('canceled')
  const topUpSuccessParam = searchParams?.get('topup_success')
  const topUpSessionId = searchParams?.get('topup_session_id') ?? null

  const [loading, setLoading] = useState(true)
  const [entitlements, setEntitlements] = useState<AccountEntitlements | null>(null)
  const [entitlementsError, setEntitlementsError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<AccountMessage | null>(null)
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null)
  const [topUpHistory, setTopUpHistory] = useState<TopUpHistoryItem[]>([])
  const [topUpAmountDraftCents, setTopUpAmountDraftCents] = useState(800)
  const [autoTopUpEnabledDraft, setAutoTopUpEnabledDraft] = useState(false)
  const [capabilities, setCapabilities] = useState<CapabilityCheck>(DEFAULT_OVERLAY_CAPABILITIES)
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false)
  const billingEnabled = capabilities.billing

  useEffect(() => {
    let active = true
    void fetch('/api/v1/capabilities', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null
        return await response.json()
      })
      .then((payload) => {
        const next = payload?.capabilities
        if (!active || !next || typeof next !== 'object') return
        setCapabilities({ ...DEFAULT_OVERLAY_CAPABILITIES, ...(next as Partial<CapabilityCheck>) })
      })
      .catch(() => {})
      .finally(() => {
        if (active) setCapabilitiesLoaded(true)
      })

    return () => {
      active = false
    }
  }, [])

  const refreshBillingState = useCallback(async () => {
    if (!billingEnabled) return
    const [entitlementsResponse, settingsResponse, topUpHistoryResponse] = await Promise.all([
      overlayAppClient.account.entitlementsResponse(),
      overlayAppClient.subscription.getSettingsResponse(),
      overlayAppClient.topUps.historyResponse(),
    ])

    if (entitlementsResponse.ok) {
      setEntitlements(await entitlementsResponse.json())
      setEntitlementsError(null)
    }

    if (settingsResponse.ok) {
      const settingsData = await settingsResponse.json() as BillingSettings
      const draft = normalizeTopUpDraft(settingsData)
      setBillingSettings(settingsData)
      setTopUpAmountDraftCents(draft.topUpAmountCents)
      setAutoTopUpEnabledDraft(draft.autoTopUpEnabled)
    }

    if (topUpHistoryResponse.ok) {
      const data = await topUpHistoryResponse.json()
      setTopUpHistory(Array.isArray(data.items) ? data.items : [])
    }
  }, [billingEnabled])

  useEffect(() => {
    if (!billingEnabled) return
    const nextParams = new URLSearchParams(searchParams?.toString() ?? '')
    nextParams.delete('success')
    nextParams.delete('session_id')
    nextParams.delete('canceled')
    nextParams.delete('topup_success')
    nextParams.delete('topup_session_id')
    nextParams.delete('topup_canceled')
    const nextUrl = `/account${nextParams.toString() ? `?${nextParams.toString()}` : ''}`

    if (successParam && sessionId) {
      const checkoutSessionId = sessionId
      async function verifyCheckout() {
        try {
          const response = await overlayAppClient.billing.verifyCheckoutResponse({ sessionId: checkoutSessionId })

          if (response.ok) {
            const data = await response.json()
            const planLabel = typeof data.planAmountCents === 'number'
              ? `$${(data.planAmountCents / 100).toFixed(0)}/month`
              : 'paid'
            setMessage({ type: 'success', text: `Subscription to the ${planLabel} plan activated successfully.` })
            await refreshBillingState()
          } else {
            setMessage({ type: 'success', text: 'Subscription activated successfully!' })
          }
        } catch (error) {
          console.error('[Account] Checkout verification error:', error)
          setMessage({ type: 'success', text: 'Subscription activated successfully!' })
        } finally {
          router.replace(nextUrl)
        }
      }

      void verifyCheckout()
    } else if (topUpSuccessParam && topUpSessionId) {
      const checkoutSessionId = topUpSessionId
      async function verifyTopUp() {
        try {
          const response = await overlayAppClient.topUps.verifyResponse({ sessionId: checkoutSessionId })
          if (response.ok) {
            const data = await response.json()
            setMessage({ type: 'success', text: `Top-up applied: $${(Number(data.amountCents ?? 0) / 100).toFixed(2)}.` })
            await refreshBillingState()
          } else {
            setMessage({ type: 'error', text: 'We could not verify your top-up. Refresh and check again.' })
          }
        } catch (error) {
          console.error('[Account] Top-up verification error:', error)
          setMessage({ type: 'error', text: 'We could not verify your top-up. Refresh and check again.' })
        } finally {
          router.replace(nextUrl)
        }
      }

      void verifyTopUp()
    } else if (canceledParam) {
      setMessage({ type: 'error', text: 'Checkout was canceled.' })
      router.replace(nextUrl)
    }
  }, [
    billingEnabled,
    canceledParam,
    refreshBillingState,
    router,
    searchParams,
    sessionId,
    successParam,
    topUpSessionId,
    topUpSuccessParam,
  ])

  useEffect(() => {
    if (authLoading || !capabilitiesLoaded) return

    if (!isAuthenticated || !currentUserId) {
      setLoading(false)
      return
    }

    if (!billingEnabled) {
      setEntitlements(null)
      setEntitlementsError(null)
      setBillingSettings(null)
      setTopUpHistory([])
      setLoading(false)
      return
    }

    async function fetchEntitlements() {
      try {
        setEntitlementsError(null)
        const [entitlementsResponse, settingsResponse, topUpHistoryResponse] = await Promise.all([
          overlayAppClient.account.entitlementsResponse(),
          overlayAppClient.subscription.getSettingsResponse(),
          overlayAppClient.topUps.historyResponse(),
        ])

        if (entitlementsResponse.ok) {
          const data = await entitlementsResponse.json()
          console.log('[Account] Received entitlements:', data)
          setEntitlements(data)
        } else {
          const errBody = await entitlementsResponse.json().catch(() => ({})) as { error?: string }
          setEntitlements(null)
          setEntitlementsError(
            errBody.error ||
              (entitlementsResponse.status === 401
                ? 'We could not verify your session with the server. Sign out and sign in again, and ensure Convex has the matching auth token verification settings for this app.'
                : 'Could not load your plan. Try again in a moment.'),
          )
        }

        if (settingsResponse.ok) {
          const settingsData = await settingsResponse.json() as BillingSettings
          const draft = normalizeTopUpDraft(settingsData)
          setBillingSettings(settingsData)
          setTopUpAmountDraftCents(draft.topUpAmountCents)
          setAutoTopUpEnabledDraft(draft.autoTopUpEnabled)
        }

        if (topUpHistoryResponse.ok) {
          const data = await topUpHistoryResponse.json()
          setTopUpHistory(Array.isArray(data.items) ? data.items : [])
        }
      } catch (error) {
        console.error('Failed to fetch entitlements:', error)
        setEntitlements(null)
        setEntitlementsError('Could not load your plan. Check your connection and try again.')
      } finally {
        setLoading(false)
      }
    }

    void fetchEntitlements()
  }, [authLoading, billingEnabled, capabilitiesLoaded, currentUserId, isAuthenticated])

  const handleManageBilling = useCallback(async () => {
    if (!billingEnabled) {
      setMessage({ type: 'error', text: 'Billing is disabled for this deployment.' })
      return
    }
    setActionLoading('billing')
    try {
      const data = await overlayAppClient.billing.portal({ sessionId })
      if (data.url) {
        window.location.href = data.url
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to open billing portal' })
      }
    } catch (error) {
      console.error('Portal error:', error)
      setMessage({ type: 'error', text: 'Failed to open billing portal' })
    } finally {
      setActionLoading(null)
    }
  }, [billingEnabled, sessionId])

  const handleStartTopUp = useCallback(async (amountCents: number, autoTopUpEnabled: boolean) => {
    if (!billingEnabled) {
      setMessage({ type: 'error', text: 'Billing is disabled for this deployment.' })
      return
    }
    setActionLoading(`topup-${amountCents}`)
    try {
      const data = await overlayAppClient.topUps.checkout({
        amountCents,
        autoTopUpEnabled,
        returnPath: '/account',
      })
      if (!data.url) {
        setMessage({ type: 'error', text: data.error || 'Failed to start top-up checkout.' })
        return
      }
      window.location.href = data.url
    } catch (error) {
      console.error('[Account] Top-up checkout error:', error)
      setMessage({ type: 'error', text: 'Failed to start top-up checkout.' })
    } finally {
      setActionLoading(null)
    }
  }, [billingEnabled])

  const handleTopUpPreferenceSave = useCallback(async () => {
    if (!billingEnabled) {
      setMessage({ type: 'error', text: 'Billing is disabled for this deployment.' })
      return
    }
    setActionLoading('topup-settings')
    try {
      const response = await overlayAppClient.subscription.updateSettingsResponse({
        autoTopUpEnabled: autoTopUpEnabledDraft,
        topUpAmountCents: topUpAmountDraftCents,
        grantOffSessionConsent: autoTopUpEnabledDraft,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to update top-up settings.' })
        return
      }
      await refreshBillingState()
      setMessage({ type: 'success', text: 'Top-up preference updated.' })
    } catch (error) {
      console.error('[Account] Top-up settings error:', error)
      setMessage({ type: 'error', text: 'Failed to update top-up settings.' })
    } finally {
      setActionLoading(null)
    }
  }, [autoTopUpEnabledDraft, billingEnabled, refreshBillingState, topUpAmountDraftCents])

  const retryEntitlements = useCallback(() => {
    if (!billingEnabled) return
    setLoading(true)
    void overlayAppClient.account.entitlementsResponse()
      .then(async (res) => {
        if (res.ok) {
          setEntitlements(await res.json())
          setEntitlementsError(null)
        } else {
          const body = await res.json().catch(() => ({})) as { error?: string }
          setEntitlements(null)
          setEntitlementsError(body.error || 'Still could not load your plan.')
        }
      })
      .catch(() => {
        setEntitlementsError('Could not load your plan.')
      })
      .finally(() => setLoading(false))
  }, [billingEnabled])

  return {
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
    refreshBillingState,
    retryEntitlements,
    setActionLoading,
    setAutoTopUpEnabledDraft,
    setMessage,
    setTopUpAmountDraftCents,
    topUpAmountDraftCents,
    topUpHistory,
  }
}
