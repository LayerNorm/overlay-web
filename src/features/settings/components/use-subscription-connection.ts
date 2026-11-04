'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import { subscriptionAuthorizationBody, subscriptionRequest, type SubscriptionAuthorization, type SubscriptionAvailability, type SubscriptionProgress, type SubscriptionScope } from './subscription-connection-client'

export function shouldStopSubscriptionFlow(progress: SubscriptionProgress): boolean {
  return progress.status === 'expired' ||
    (progress.status === 'error' && progress.retryable !== true)
}

export function shouldPollSubscriptionAuthorization(authorization: SubscriptionAuthorization['authorization']): boolean {
  return authorization.callbackRequired !== true
}

export function useSubscriptionConnection({ connection, scope = 'personal', workspaceId, onConnected, onClose }: {
  connection?: ByokConnectionRow
  scope?: SubscriptionScope
  workspaceId?: string
  onConnected(): Promise<void> | void
  onClose(): void
}) {
  const [availability, setAvailability] = useState<SubscriptionAvailability | null>(null)
  const [login, setLogin] = useState<SubscriptionAuthorization | null>(null)
  const [connected, setConnected] = useState<ByokConnectionRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stopped, setStopped] = useState(false)
  const working = useRef(false)
  const closing = useRef(false)
  const pendingId = useRef(connection?._id)
  const requestKey = useRef<string | null>(null)
  const connectedCallback = useRef(onConnected)
  useEffect(() => { connectedCallback.current = onConnected }, [onConnected])

  useEffect(() => {
    const abort = new AbortController()
    void subscriptionRequest<SubscriptionAvailability>(undefined, { signal: abort.signal, workspaceId })
      .then(setAvailability)
      .catch((value: unknown) => { if (!abort.signal.aborted) setError(value instanceof Error ? value.message : 'Could not load providers.') })
    return () => abort.abort()
  }, [workspaceId])

  const accept = useCallback(async (progress: SubscriptionProgress) => {
    if (closing.current) return
    if (progress.status === 'connected' && progress.connection) {
      setConnected(progress.connection)
      setStopped(true)
      setError(null)
      await connectedCallback.current()
    } else if (progress.status === 'expired') {
      setStopped(true)
      setError(progress.error ?? 'Sign-in expired. Start again to reconnect.')
      await connectedCallback.current()
    } else if (progress.status === 'error') {
      if (shouldStopSubscriptionFlow(progress)) {
        setStopped(true)
        await connectedCallback.current()
      }
      setError(progress.error ?? 'Could not complete sign-in.')
    }
  }, [])

  useEffect(() => {
    if (!login || stopped || connected) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    if (!shouldPollSubscriptionAuthorization(login.authorization)) {
      timer = setTimeout(() => {
        if (!abort.signal.aborted) {
          setStopped(true)
          setError('Sign-in expired. Start again to reconnect.')
        }
      }, Math.max(0, login.authorization.expiresAt - Date.now()))
      return () => { abort.abort(); clearTimeout(timer) }
    }
    const poll = async () => {
      if (closing.current || abort.signal.aborted) return
      if (Date.now() >= login.authorization.expiresAt) {
        setStopped(true)
        setError('Sign-in expired. Start again to reconnect.')
        return
      }
      try {
        const progress = await subscriptionRequest<SubscriptionProgress>({ connectionId: login.connectionId, action: 'poll' }, { signal: abort.signal, workspaceId })
        if (abort.signal.aborted) return
        await accept(progress)
        if (progress.status !== 'pending' &&
            !(progress.status === 'error' && progress.retryable === true)) return
        if (progress.status === 'pending') setError(null)
      } catch (value) {
        if (abort.signal.aborted) return
        setError(value instanceof Error ? value.message : 'Could not check sign-in. Retrying.')
      }
      if (!abort.signal.aborted) timer = setTimeout(() => { void poll() }, Math.max(2, login.authorization.interval) * 1000)
    }
    timer = setTimeout(() => { void poll() }, Math.max(2, login.authorization.interval) * 1000)
    return () => { abort.abort(); clearTimeout(timer) }
  }, [login, connected, stopped, accept, workspaceId])

  const start = async (providerId: string) => {
    if (working.current) return
    working.current = true
    setBusy(true); setError(null)
    requestKey.current ??= crypto.randomUUID()
    try {
      const next = await subscriptionRequest<SubscriptionAuthorization>(subscriptionAuthorizationBody(providerId, scope, pendingId.current), { method: 'POST', idempotencyKey: requestKey.current, workspaceId })
      pendingId.current = next.connectionId
      setLogin(next); setStopped(false); setConnected(null)
      requestKey.current = null
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not start sign-in.')
    } finally { working.current = false; setBusy(false) }
  }

  const completeCallback = async (callbackUrl: string) => {
    if (!login || working.current) return
    working.current = true; setBusy(true); setError(null)
    try {
      await accept(await subscriptionRequest<SubscriptionProgress>({ connectionId: login.connectionId, action: 'callback', callbackUrl }, { workspaceId }))
    } catch (value) { setError(value instanceof Error ? value.message : 'Could not complete sign-in.') }
    finally { working.current = false; setBusy(false) }
  }

  const close = async () => {
    if (working.current) return
    working.current = true; closing.current = true; setBusy(true)
    try {
      if (login && !connected) {
        const response = await fetch(`/api/v1/providers/connections?connectionId=${encodeURIComponent(login.connectionId)}`, { method: 'DELETE' })
        if (!response.ok) throw new Error('Could not cancel this connection. Try again before closing.')
        await connectedCallback.current()
      }
      onClose()
    } catch (value) { closing.current = false; setError(value instanceof Error ? value.message : 'Could not cancel sign-in.') }
    finally { working.current = false; setBusy(false) }
  }

  return { availability, login, connected, error, busy, stopped, selectionLocked: Boolean(pendingId.current || requestKey.current), start, completeCallback, close }
}
