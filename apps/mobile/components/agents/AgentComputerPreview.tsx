import React, { useEffect, useState } from 'react'
import { ActivityIndicator, AppState, Modal, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { Monitor, X } from 'lucide-react-native'
import type { Computer } from '@overlay/workspace-contracts'
import type { Theme } from '../../constants/theme'
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

export function AgentComputerPreviewButton({
  computer,
  theme,
}: {
  computer: Computer
  theme: Theme
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') setOpen(false)
    })
    return () => subscription.remove()
  }, [open])

  return (
    <>
      <Button theme={theme} secondary icon={Monitor} onPress={() => setOpen(true)}>
        View computer
      </Button>
      {open ? (
        <Modal visible animationType="slide" onRequestClose={() => setOpen(false)}>
          <AgentComputerPreview computer={computer} theme={theme} onClose={() => setOpen(false)} />
        </Modal>
      ) : null}
    </>
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
