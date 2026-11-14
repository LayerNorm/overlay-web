import React, { useEffect, useRef, useState } from 'react'
import { Linking, TextInput, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import type { Theme } from '../../constants/theme'
import { Button, T } from '../shell/primitives'
import { ResourceSheet, ResourceState } from '../knowledge/ResourceViews'
import {
  subscriptionRequest,
  type SubscriptionAvailability,
  type SubscriptionAuthorization,
  type SubscriptionProgress,
} from '../../services/settingsNativeService'
import { appJson } from '../../services/appApi'

export function SubscriptionSheet({
  theme,
  workspaceId,
  connectionId,
  providerId,
  onClose,
}: {
  theme: Theme
  workspaceId: string
  connectionId?: string
  providerId?: string
  onClose: () => void
}) {
  const [availability, setAvailability] = useState<SubscriptionAvailability | null>(null)
  const [login, setLogin] = useState<SubscriptionAuthorization | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [callback, setCallback] = useState('')
  const [scope, setScope] = useState<'personal' | 'workspace'>('personal')
  const active = useRef(true)
  const pendingId = useRef<string | null>(null)
  const connected = useRef(false)
  const working = useRef(false)
  const authorizationRequest = useRef<{ signature: string; key: string } | null>(null)
  useEffect(() => {
    active.current = true
    void subscriptionRequest<SubscriptionAvailability>(workspaceId)
      .then((value) => {
        if (active.current) setAvailability(value)
      })
      .catch((value) => {
        if (active.current)
          setError(value instanceof Error ? value.message : 'Connections unavailable.')
      })
    return () => {
      active.current = false
      if (pendingId.current && !connected.current)
        void appJson('/api/v1/providers/connections', {
          method: 'DELETE',
          workspaceId,
          query: { connectionId: pendingId.current },
        }).catch(() => undefined)
    }
  }, [workspaceId])
  const accept = (result: SubscriptionProgress) => {
    if (result.status === 'connected') {
      connected.current = true
      onClose()
    } else if (result.status === 'expired' || (result.status === 'error' && !result.retryable)) {
      setStopped(true)
      setError(result.error ?? 'Sign-in expired. Close and try again.')
    } else if (result.status === 'error')
      setError(result.error ?? 'Could not check sign-in. Retrying.')
  }
  useEffect(() => {
    if (!login || stopped || login.authorization.callbackRequired) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (abort.signal.aborted || !active.current) return
      if (Date.now() >= login.authorization.expiresAt) {
        setError('Sign-in expired. Close and try again.')
        setStopped(true)
        return
      }
      try {
        const result = await subscriptionRequest<SubscriptionProgress>(
          workspaceId,
          { connectionId: login.connectionId, action: 'poll' },
          'PATCH',
          abort.signal,
        )
        if (!abort.signal.aborted && active.current) accept(result)
        if (result.status !== 'pending' && !(result.status === 'error' && result.retryable)) return
      } catch (value) {
        if (!abort.signal.aborted && active.current)
          setError(value instanceof Error ? value.message : 'Could not check sign-in.')
      }
      if (!abort.signal.aborted)
        timer = setTimeout(() => void poll(), Math.max(2, login.authorization.interval) * 1000)
    }
    timer = setTimeout(() => void poll(), Math.max(2, login.authorization.interval) * 1000)
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login, stopped, workspaceId])
  const start = async (provider: string) => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      const body =
        providerId && connectionId
          ? { providerId: provider, connectionId }
          : { providerId: provider, scope }
      const signature = JSON.stringify(body)
      if (authorizationRequest.current?.signature !== signature)
        authorizationRequest.current = { signature, key: Crypto.randomUUID() }
      const result = await subscriptionRequest<SubscriptionAuthorization>(
        workspaceId,
        body,
        'POST',
        undefined,
        authorizationRequest.current.key,
      )
      if (!active.current) {
        void appJson('/api/v1/providers/connections', {
          method: 'DELETE',
          workspaceId,
          query: { connectionId: result.connectionId },
        }).catch(() => undefined)
        return
      }
      pendingId.current = result.connectionId
      authorizationRequest.current = null
      setLogin(result)
    } catch (value) {
      if (active.current)
        setError(value instanceof Error ? value.message : 'Could not start sign-in.')
    } finally {
      working.current = false
      if (active.current) setBusy(false)
    }
  }
  return (
    <ResourceSheet theme={theme} visible title="Connect subscription" onClose={onClose}>
      <View style={{ gap: 14 }}>
        <T style={{ color: theme.muted, fontSize: 12, lineHeight: 19 }}>
          Connect an existing provider account. Availability is determined by this deployment.
        </T>
        {error ? <ResourceState theme={theme} error={error} /> : null}
        {!availability && !error ? <ResourceState theme={theme} loading /> : null}
        {!login ? (
          <>
            {!connectionId ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['personal', 'workspace'] as const).map((value) => (
                  <Button
                    key={value}
                    theme={theme}
                    secondary={value === scope}
                    disabled={busy}
                    onPress={() => setScope(value)}
                  >
                    {value === 'personal' ? 'Just me' : 'Workspace'}
                  </Button>
                ))}
              </View>
            ) : null}
            {availability?.available ? (
              availability.providers
                .filter((provider) => !providerId || provider.id === providerId)
                .map((provider) => (
                  <Button
                    key={provider.id}
                    theme={theme}
                    secondary
                    disabled={!provider.enabled || busy}
                    onPress={() => void start(provider.id)}
                  >
                    {provider.label}
                    {provider.enabled ? '' : ' · unavailable'}
                  </Button>
                ))
            ) : (
              <T style={{ color: theme.muted, fontSize: 13 }}>
                {availability?.reason ??
                  'Subscription connections are not available on this deployment.'}
              </T>
            )}
          </>
        ) : (
          <>
            <T style={{ color: theme.muted, fontSize: 12 }}>
              {login.authorization.userCode
                ? `Enter this code: ${login.authorization.userCode}`
                : 'Complete sign-in in your browser.'}
            </T>
            <Button
              theme={theme}
              secondary
              disabled={stopped}
              onPress={() => {
                const url = new URL(login.authorization.url)
                if (url.protocol !== 'https:') {
                  setError('Unexpected authorization URL.')
                  return
                }
                void Linking.openURL(url.href).catch(() => setError('Could not open sign-in.'))
              }}
            >
              Open sign-in
            </Button>
            {login.authorization.callbackRequired ? (
              <>
                <T style={{ color: theme.muted, fontSize: 12 }}>
                  After signing in, paste the full callback URL here. A localhost error in the
                  browser is expected.
                </T>
                <TextInput
                  accessibilityLabel="Authorization callback URL"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={callback}
                  onChangeText={setCallback}
                  placeholder="Callback URL"
                  placeholderTextColor={theme.muted}
                  style={{
                    color: theme.foreground,
                    borderColor: theme.border,
                    borderWidth: 1,
                    borderRadius: 8,
                    padding: 12,
                    fontFamily: 'Geist',
                  }}
                />
                <Button
                  theme={theme}
                  secondary
                  disabled={!callback.trim() || busy || stopped}
                  onPress={() => {
                    setBusy(true)
                    void subscriptionRequest<SubscriptionProgress>(workspaceId, {
                      connectionId: login.connectionId,
                      action: 'callback',
                      callbackUrl: callback.trim(),
                    })
                      .then((value) => {
                        if (active.current) accept(value)
                      })
                      .catch((value) => {
                        if (active.current)
                          setError(
                            value instanceof Error ? value.message : 'Could not complete sign-in.',
                          )
                      })
                      .finally(() => {
                        if (active.current) setBusy(false)
                      })
                  }}
                >
                  Complete connection
                </Button>
              </>
            ) : (
              <T style={{ color: theme.muted, fontSize: 12 }}>Waiting for authorization…</T>
            )}
          </>
        )}
      </View>
    </ResourceSheet>
  )
}
