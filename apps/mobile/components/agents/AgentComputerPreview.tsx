import React, { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ActivityIndicator, Alert, AppState, Modal, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { Monitor, X } from 'lucide-react-native'
import type { Computer } from '@overlay/workspace-contracts'
import type { Theme } from '../../constants/theme'
import { api, subscribeConvex } from '../../services/convexClient'
import { mobileOverlayAppClient } from '../../services/overlayClient'
import { Button, IconButton, T } from '../shell/primitives'

type Stream = { url: string; origin: string; expiresAt: number | null }
type PreviewState = { status: 'loading' | 'failed' } | { status: 'ready'; stream: Stream }

function previewOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null
  } catch {
    return null
  }
}

export function AgentComputerPanel({
  computer,
  theme,
  canManage,
  onChange,
}: {
  computer: Computer
  theme: Theme
  canManage: boolean
  onChange: Dispatch<SetStateAction<Computer | null>>
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<'start' | 'stop' | null>(null)
  const lock = useRef(false)
  const current = useRef(computer)
  const alive = useRef(false)
  const { id, workspaceId } = computer
  useEffect(() => {
    current.current = computer
  }, [computer])
  useEffect(() => {
    alive.current = true
    let stop: (() => void) | undefined
    try {
      stop = subscribeConvex(api.computers.browse.list, { workspaceId }, (rows) => {
        if (!alive.current) return
        const found = rows?.find((item) => item.id === id) ?? null
        onChange((old) =>
          old?.id === id && (!found || found.updatedAt >= old.updatedAt) ? found : old,
        )
      })
    } catch {
      // The initial editor snapshot remains usable while the live query reconnects.
    }
    return () => {
      alive.current = false
      stop?.()
    }
  }, [id, workspaceId, onChange])
  useEffect(() => {
    if (!open) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') setOpen(false)
    })
    return () => subscription.remove()
  }, [open])

  const ready = computer.status === 'ready'
  const canStop = ready && !computer.controlledByUserId
  const canStart = computer.status === 'stopped' || computer.status === 'error'

  async function changePower(action: 'start' | 'stop') {
    const snapshot = current.current
    if (!alive.current || lock.current || !canManage || snapshot.controlledByUserId) return
    if (
      action === 'stop'
        ? snapshot.status !== 'ready'
        : snapshot.status !== 'stopped' && snapshot.status !== 'error'
    )
      return
    if (action === 'stop') setOpen(false)
    lock.current = true
    setPending(action)
    try {
      const { computer: next } = await mobileOverlayAppClient.computers[action](workspaceId, id)
      if (next.id !== id || next.workspaceId !== workspaceId)
        throw new Error('Unexpected computer response')
      if (alive.current)
        onChange((old) => (old?.id === id && next.updatedAt >= old.updatedAt ? next : old))
    } catch {
      if (alive.current)
        Alert.alert('Computer update failed', 'Check the computer status before trying again.')
    } finally {
      lock.current = false
      if (alive.current) setPending(null)
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <T style={{ color: theme.muted }}>
        {computer.status === 'ready'
          ? 'Computer ready'
          : computer.status === 'stopped'
            ? 'Computer stopped'
            : computer.status === 'provisioning'
              ? 'Preparing computer'
              : 'Computer unavailable'}
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ready ? (
          <Button
            theme={theme}
            secondary
            icon={Monitor}
            disabled={pending !== null}
            onPress={() => setOpen(true)}
          >
            View computer
          </Button>
        ) : null}
        {canManage && canStart ? (
          <Button
            theme={theme}
            secondary
            disabled={pending !== null}
            onPress={() => void changePower('start')}
          >
            {pending === 'start' ? 'Starting…' : 'Start'}
          </Button>
        ) : null}
        {canManage && canStop ? (
          <Button
            theme={theme}
            disabled={pending !== null}
            onPress={() =>
              Alert.alert(
                'Stop computer?',
                'The agent’s desktop session will end. You can start the computer again later.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Stop', style: 'destructive', onPress: () => void changePower('stop') },
                ],
              )
            }
          >
            {pending === 'stop' ? 'Stopping…' : 'Stop'}
          </Button>
        ) : null}
      </View>
      {open ? (
        <Modal visible animationType="slide" onRequestClose={() => setOpen(false)}>
          {ready ? (
            <AgentComputerPreview
              computer={computer}
              theme={theme}
              onClose={() => setOpen(false)}
            />
          ) : (
            <SafeAreaView style={{ flex: 1, padding: 18, backgroundColor: theme.surfaceElevated }}>
              <T style={{ color: theme.foreground }}>The computer is no longer ready.</T>
              <Button theme={theme} onPress={() => setOpen(false)}>
                Close preview
              </Button>
            </SafeAreaView>
          )}
        </Modal>
      ) : null}
    </View>
  )
}

function AgentComputerPreview({
  computer,
  theme,
  onClose,
}: {
  computer: Computer
  theme: Theme
  onClose: () => void
}) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void mobileOverlayAppClient.computers
      .openDesktop(computer.workspaceId, computer.id, 'webrtc', { signal: controller.signal })
      .then((ticket) => {
        if (controller.signal.aborted) return
        const origin = previewOrigin(ticket.url)
        if (!origin || (ticket.expiresAt !== null && !(ticket.expiresAt > Date.now()))) {
          setState({ status: 'failed' })
          return
        }
        setState({
          status: 'ready',
          stream: { url: ticket.url, origin, expiresAt: ticket.expiresAt },
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'failed' })
      })
    return () => controller.abort()
  }, [computer.id, computer.workspaceId, attempt])

  const expiresAt = state.status === 'ready' ? state.stream.expiresAt : null
  useEffect(() => {
    if (expiresAt === null) return
    const timer = setTimeout(
      () => setState({ status: 'failed' }),
      Math.max(0, expiresAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [expiresAt])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.surfaceElevated }}>
      <View
        style={{
          minHeight: 52,
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderColor: theme.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <IconButton icon={X} label="Close computer preview" theme={theme} onPress={onClose} />
        <T numberOfLines={1} style={{ flex: 1, color: theme.foreground }}>
          {computer.name || 'Computer'}
        </T>
        <T style={{ color: theme.muted, fontSize: 12 }}>View only</T>
      </View>
      {state.status === 'ready' ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flex: 1, backgroundColor: theme.surfaceSubtle }}
        >
          <WebView
            incognito
            originWhitelist={['*']}
            source={{ uri: state.stream.url }}
            onShouldStartLoadWithRequest={(request) =>
              previewOrigin(request.url) === state.stream.origin
            }
            javaScriptCanOpenWindowsAutomatically={false}
            webviewDebuggingEnabled={false}
            setSupportMultipleWindows={false}
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            mixedContentMode="never"
            allowFileAccess={false}
            onError={() => setState({ status: 'failed' })}
            onHttpError={() => setState({ status: 'failed' })}
            onContentProcessDidTerminate={() => setState({ status: 'failed' })}
          />
        </View>
      ) : (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}
        >
          {state.status === 'loading' ? (
            <ActivityIndicator accessibilityLabel="Opening computer preview" color={theme.muted} />
          ) : (
            <>
              <T accessibilityRole="alert" style={{ color: theme.foreground }}>
                Could not open the computer stream.
              </T>
              <Button
                theme={theme}
                secondary
                onPress={() => {
                  setState({ status: 'loading' })
                  setAttempt((value) => value + 1)
                }}
              >
                Try again
              </Button>
            </>
          )}
        </View>
      )}
    </SafeAreaView>
  )
}
