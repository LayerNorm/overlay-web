import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Crypto from 'expo-crypto'
import * as Clipboard from 'expo-clipboard'
import { useFocusEffect } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { createNativeTranscriptActionController, type NativeTranscriptCommittedContext } from '../../lib/nativeChatTranscriptActions'
import { createNativeTranscriptDomSnapshot, type NativeTranscriptDomSnapshot } from '../../lib/nativeChatTranscriptProjection'
import { toNativeChatTranscriptView } from '../../lib/toNativeChatTranscriptView'
import NativeSharedTranscript from './NativeSharedTranscript.dom'

const workspaceId = 'shared-transcript-proof-workspace'
const conversationId = 'shared-transcript-proof-conversation'

const syntheticSections = (label: string) => Array.from({ length: 18 }, (_, index) =>
  `Synthetic ${label} section ${index + 1}: this content exists only to exercise transcript wrapping, selection, and scrolling in the shared proof fixture.`,
).join('\n\n')

const transcriptView = toNativeChatTranscriptView([
  {
    id: 'proof-user',
    turnId: 'proof-turn',
    role: 'user',
    content: 'Compare these synthetic answers. Keep the fixture data local to this development proof.',
    timestamp: 10,
    mode: 'ask',
  },
  {
    id: 'proof-assistant-primary',
    turnId: 'proof-turn',
    role: 'assistant',
    content: [
      'Primary synthetic response with math, a table, and code.',
      String.raw`$$\frac{1}{2} + \frac{1}{4} = \frac{3}{4}$$`,
      '| Item | Value |\n| --- | --- |\n| Fixture | Synthetic |\n| Renderer | Shared |',
      '```ts\nconst proofFixture = { local: true }\nconsole.log(proofFixture)\n```',
      syntheticSections('primary'),
    ].join('\n\n'),
    timestamp: 20,
    modelId: 'proof/primary',
    variantIndex: 0,
    status: 'completed',
  },
  {
    id: 'proof-assistant-alternate',
    turnId: 'proof-turn',
    role: 'assistant',
    content: [
      'Alternate synthetic response. Use the response controls to switch between these two local examples.',
      String.raw`$$\sqrt{2} \times \sqrt{2} = 2$$`,
      syntheticSections('alternate'),
    ].join('\n\n'),
    timestamp: 30,
    modelId: 'proof/alternate',
    variantIndex: 1,
    status: 'completed',
  },
] as never)

interface ProofSession {
  identity: object
  context: NativeTranscriptCommittedContext
  controller: ReturnType<typeof createNativeTranscriptActionController>
  snapshot: NativeTranscriptDomSnapshot
}

type ProofScope = Pick<NativeTranscriptDomSnapshot, 'workspaceId' | 'conversationId' | 'mountNonce' | 'focusNonce'>

function scopeKey(scope: ProofScope): string {
  return JSON.stringify([scope.workspaceId, scope.conversationId, scope.mountNonce, scope.focusNonce])
}

function makeSnapshot(context: NativeTranscriptCommittedContext, isDark: boolean): NativeTranscriptDomSnapshot {
  return createNativeTranscriptDomSnapshot({
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
    mountNonce: context.mountNonce,
    focusNonce: context.focusNonce,
    theme: isDark ? 'dark' : 'light',
    view: context.view,
    supportedActions: context.allowedActions,
    query: '',
    scrollIntent: null,
    assets: [],
  })
}

export function SharedTranscriptProofMode() {
  const { theme, isDark } = useTheme()
  const [mountNonce] = useState(() => `shared_transcript_proof_${Crypto.randomUUID().replace(/-/g, '_')}`)
  const focusEpoch = useRef(0)
  const activeSession = useRef<ProofSession | null>(null)
  const [session, setSession] = useState<ProofSession | null>(null)
  const [readyScopeKey, setReadyScopeKey] = useState('')
  const committedTheme = useRef(isDark)

  useLayoutEffect(() => {
    committedTheme.current = isDark
  }, [isDark])

  useFocusEffect(useCallback(() => {
    focusEpoch.current += 1
    const focusNonce = `${mountNonce}_focus_${focusEpoch.current}`
    const identity = {}
    const context: NativeTranscriptCommittedContext = {
      workspaceId,
      conversationId,
      mountNonce,
      focusNonce,
      focused: true,
      mounted: true,
      allowedActions: ['copy'],
      view: transcriptView,
      assets: [],
    }
    const controller = createNativeTranscriptActionController({
      getContext: () => {
        const current = activeSession.current
        return current?.identity === identity ? current.context : null
      },
      handlers: {
        copyText: async (text) => {
          if (typeof Clipboard.setStringAsync !== 'function') throw new Error('Clipboard unavailable')
          await Clipboard.setStringAsync(text)
        },
      },
      createDraftToken: () => `${mountNonce}:unused-proof-draft-token`,
    })
    const nextSession: ProofSession = {
      identity,
      context,
      controller,
      snapshot: makeSnapshot(context, committedTheme.current),
    }
    activeSession.current = nextSession
    setSession(nextSession)

    return () => {
      context.focused = false
      context.mounted = false
      controller.invalidate()
      if (activeSession.current?.identity === identity) {
        activeSession.current = null
        setSession((current) => current?.identity === identity ? { ...current, context } : current)
      }
    }
  }, [mountNonce]))

  useEffect(() => {
    const current = activeSession.current
    if (!current || !current.context.focused || !current.context.mounted) return
    const nextSession = { ...current, snapshot: makeSnapshot(current.context, isDark) }
    activeSession.current = nextSession
    setSession(nextSession)
  }, [isDark])

  const dispatch = useCallback((request: Parameters<ProofSession['controller']['dispatch']>[0]) => {
    const current = activeSession.current
    if (!current || !current.context.focused || !current.context.mounted) {
      return Promise.resolve({ ok: false as const, error: 'stale-scope' as const })
    }
    return current.controller.dispatch(request)
  }, [])

  const onReady = useCallback((scope: ProofScope) => {
    const current = activeSession.current
    if (!current || !current.context.focused || !current.context.mounted || scopeKey(scope) !== scopeKey(current.context)) return
    setReadyScopeKey(scopeKey(scope))
  }, [])

  const isCurrentSession = session !== null && session.context.focused && session.context.mounted
  const ready = isCurrentSession && readyScopeKey === scopeKey(session.context)
  const backgroundColor = theme.background

  return (
    <View style={[styles.container, { backgroundColor }]}>
      {session ? (
        <NativeSharedTranscript
          dom={{ style: { flex: 1, backgroundColor } }}
          snapshot={session.snapshot}
          onAction={dispatch}
          onReady={onReady}
        />
      ) : null}
      {!ready ? (
        <View pointerEvents="auto" style={[StyleSheet.absoluteFillObject, styles.loading, { backgroundColor }]}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Loading synthetic transcript</Text>
          <ActivityIndicator color={theme.textSecondary} size="large" />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  label: { fontSize: 13, fontWeight: '600' },
})
