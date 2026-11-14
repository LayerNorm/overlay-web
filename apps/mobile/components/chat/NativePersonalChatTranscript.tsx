import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as Clipboard from 'expo-clipboard'
import * as Crypto from 'expo-crypto'
import { useFocusEffect, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { ActivityIndicator, AppState, Keyboard, StyleSheet, Text, View } from 'react-native'
import type { ChatTranscriptView, DraftModalState } from '@overlay/chat-core'
import { useTheme } from '../../hooks/useTheme'
import {
  createNativeTranscriptActionController,
  type NativeTranscriptActionKind,
  type NativeTranscriptActionControllerOptions,
  type NativeTranscriptError,
  type NativeTranscriptActionResult,
  type NativeTranscriptCommittedContext,
  type NativeTranscriptScope as NativeTranscriptScopeContract,
  type NativeTranscriptTrustedReplyTarget,
} from '../../lib/nativeChatTranscriptActions'
import { createNativeTranscriptDomSnapshot, MAX_NATIVE_TRANSCRIPT_DELIVERY_EPOCH, type NativeTranscriptDomSnapshot, type NativeTranscriptScrollIntent as NativeTranscriptScrollIntentContract } from '../../lib/nativeChatTranscriptProjection'
import { getNativeTranscriptCitationEntries, isNativeTranscriptResourceId } from '../../lib/nativeTranscriptCitations'
import { NativeTranscriptResourceRegistry } from '../../lib/nativeTranscriptResources'
import { nativeTranscriptShareAdapters, shareNativeTranscriptText } from '../../lib/nativeTranscriptShareCache'
import { validateNativeMarkdownLink } from '../../lib/sharedMarkdownBridge'
import { DraftReviewSheet } from './DraftReviewSheet'
import NativeSharedTranscript from './NativeSharedTranscript.dom'

export type TrustedReplyTarget = NativeTranscriptTrustedReplyTarget
export type NativeTranscriptScope = NativeTranscriptScopeContract
export type NativeTranscriptScrollIntent = NativeTranscriptScrollIntentContract
export type NativeTranscriptPublicModelLabel = { id: string; name: string }

export interface NativePersonalChatTranscriptProps {
  view: ChatTranscriptView
  workspaceId: string | null
  conversationId: string
  query: string
  scrollIntent: NativeTranscriptScrollIntent | null
  authorityActive: boolean
  publicModelLabels?: readonly NativeTranscriptPublicModelLabel[]
  onReply?: (target: TrustedReplyTarget, scope: NativeTranscriptScope) => void | Promise<void>
  onJumpToReply?: (parentExchangeId: string, scope: NativeTranscriptScope) => void | Promise<void>
  onSaveDraft?: (editedDraft: DraftModalState, scope: NativeTranscriptScope) => void | Promise<void>
}

type TranscriptScopeIds = Pick<NativeTranscriptDomSnapshot, 'workspaceId' | 'conversationId' | 'mountNonce' | 'focusNonce'>

const NATIVE_TRANSCRIPT_READY_RETRY_LIMIT = 3
const NATIVE_TRANSCRIPT_READY_RETRY_DELAY_MS = 250
type NativeHostSession = {
  focusNonce: string
  controller: ReturnType<typeof createNativeTranscriptActionController>
}
type NativeDraftSession = {
  draftToken: string
  state: DraftModalState
  scope: NativeTranscriptScope
  controller: NativeHostSession['controller']
}
type InternalTranscriptRoute = { kind: 'files' } | { kind: 'file' | 'output' | 'memory'; id: string }
type InternalLinkResult = { kind: 'route'; route: InternalTranscriptRoute } | { kind: 'external'; url: string } | { kind: 'reject' }

const EMPTY_VIEW: ChatTranscriptView = { version: 1, exchanges: [] }
const FIRST_PARTY_HOSTS = new Set(['getoverlay.io', 'www.getoverlay.io'])

function opaqueId(): string {
  return Crypto.randomUUID().replace(/-/g, '_')
}

function sameScope(left: TranscriptScopeIds, right: TranscriptScopeIds): boolean {
  return left.workspaceId === right.workspaceId && left.conversationId === right.conversationId &&
    left.mountNonce === right.mountNonce && left.focusNonce === right.focusNonce
}

function canonicalHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '')
}

function classifyInternalTranscriptLink(value: string): InternalLinkResult {
  let parsed: URL
  try {
    if (value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) return { kind: 'reject' }
    parsed = new URL(value)
  } catch {
    return { kind: 'reject' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' || parsed.username || parsed.password) return { kind: 'reject' }
  const firstPartyHost = FIRST_PARTY_HOSTS.has(canonicalHostname(parsed.hostname))
  if (!firstPartyHost) return { kind: 'external', url: parsed.toString() }
  if (parsed.port) return { kind: 'reject' }
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(parsed.pathname)
  } catch {
    return { kind: 'reject' }
  }
  if (/[\\\u0000-\u001f\u007f]/.test(decodedPath)) return { kind: 'reject' }
  const path = decodedPath.replace(/\/+$/, '') || '/'
  if (/(^|\/)(?:auth|oauth2?|callback|invite|invitation|invitations|connect|authorize|approval|approvals|approve|admin|api|billing|execute|delete|branch|retry|continue|action|actions|login|logout|sign-?in|sign-?up|register|password|reset|verify|verification|sso|consent|session|token)(?:\/|$)/i.test(path)) {
    return { kind: 'reject' }
  }
  const nativeResourcePath = path === '/files' || path.startsWith('/files/')
  if (parsed.protocol !== 'https:' && nativeResourcePath) return { kind: 'reject' }
  if (parsed.protocol === 'https:' && path === '/files') return { kind: 'route', route: { kind: 'files' } }
  const resource = /^\/files\/(file|output|memory)\/([A-Za-z0-9_-]{1,256})$/.exec(path)
  if (parsed.protocol === 'https:' && resource && isNativeTranscriptResourceId(resource[2])) {
    return { kind: 'route', route: { kind: resource[1] as 'file' | 'output' | 'memory', id: resource[2] } }
  }
  const publicUrl = new URL(parsed.toString())
  publicUrl.hostname = canonicalHostname(publicUrl.hostname)
  for (const key of [...publicUrl.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, '')
    if (['workspace', 'workspaceid', 'organization', 'organizationid', 'auth', 'authorization', 'token', 'accesstoken', 'refreshtoken', 'code', 'state', 'session'].includes(normalizedKey)) {
      publicUrl.searchParams.delete(key)
    }
  }
  publicUrl.hash = ''
  return { kind: 'external', url: publicUrl.toString() }
}

function hasCurrentCitation(view: ChatTranscriptView, kind: 'file' | 'memory', sourceId: string): boolean {
  return view.exchanges.some((exchange) => exchange.responses.some((response) =>
    getNativeTranscriptCitationEntries(response.sourceCitations)
      .some(({ citation }) => citation.kind === kind && citation.sourceId === sourceId)))
}

function emptyActionResult(error: NativeTranscriptError): NativeTranscriptActionResult {
  return { ok: false, error }
}

function safeActionError(): Error {
  return new Error('Transcript action is no longer available')
}

export const NativePersonalChatTranscript = React.memo(function NativePersonalChatTranscript(props: NativePersonalChatTranscriptProps): React.ReactElement {
  const scopeKey = JSON.stringify([props.workspaceId, props.conversationId])
  return <NativePersonalChatTranscriptScope key={scopeKey} {...props} />
})

function NativePersonalChatTranscriptScope({
  view,
  workspaceId,
  conversationId,
  query,
  scrollIntent,
  authorityActive,
  publicModelLabels,
  onReply,
  onJumpToReply,
  onSaveDraft,
}: NativePersonalChatTranscriptProps): React.ReactElement {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const [mountNonce] = useState(opaqueId)
  const [focusNonce, setFocusNonce] = useState(() => `${mountNonce}_focus_0`)
  const [session, setSession] = useState<NativeHostSession | null>(null)
  const [readyFocusNonce, setReadyFocusNonce] = useState<string | null>(null)
  const [snapshotRefreshEpoch, setSnapshotRefreshEpoch] = useState(0)
  const [sharingFocusNonce, setSharingFocusNonce] = useState<string | null>(null)
  const [resourceVersion, setResourceVersion] = useState(0)
  const [draftSession, setDraftSession] = useState<NativeDraftSession | null>(null)
  const [savingDraftToken, setSavingDraftToken] = useState<string | null>(null)
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null)
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const [navigationFocused, setNavigationFocused] = useState(false)
  const mountedRef = useRef(true)
  const focusEpochRef = useRef(0)
  const appActiveRef = useRef(AppState.currentState === 'active')
  const authorityActiveRef = useRef(authorityActive)
  const navigationFocusedRef = useRef(false)
  const readyFocusNonceRef = useRef<string | null>(null)
  const sessionRef = useRef<NativeHostSession | null>(null)
  const contextRef = useRef<NativeTranscriptCommittedContext | null>(null)
  const draftRef = useRef<NativeDraftSession | null>(null)
  const pendingDraftTokenRef = useRef<string | null>(null)
  const callbacksRef = useRef({ onReply, onJumpToReply, onSaveDraft })
  const [resourceRegistry] = useState(() => new NativeTranscriptResourceRegistry(opaqueId))

  useLayoutEffect(() => {
    authorityActiveRef.current = authorityActive
    callbacksRef.current = { onReply, onJumpToReply, onSaveDraft }
  }, [authorityActive, onJumpToReply, onReply, onSaveDraft])

  useLayoutEffect(() => {
    const changed = resourceRegistry.commitView(view)
    if (!changed) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rerender projection only after the committed resource registry changes
    setResourceVersion((value) => value + 1)
  }, [resourceRegistry, view])

  const retireSession = useCallback((target: NativeHostSession | null, updateState = true) => {
    const retiringCurrentSession = !target || sessionRef.current === target
    target?.controller.invalidate()
    if (!target || sessionRef.current === target) sessionRef.current = null
    if (!target || contextRef.current?.focusNonce === target.focusNonce) contextRef.current = null
    const draft = draftRef.current
    if (draft && (!target || draft.controller === target.controller)) {
      draft.controller.cancelDraft(draft.draftToken)
      draftRef.current = null
      pendingDraftTokenRef.current = null
      if (updateState) {
        setDraftSession(null)
        setSavingDraftToken(null)
        setDraftSaveError(null)
      }
    }
    if (updateState && retiringCurrentSession) {
      readyFocusNonceRef.current = null
      setReadyFocusNonce(null)
      setSharingFocusNonce(null)
      setSession((current) => !target || current === target ? null : current)
    }
  }, [])

  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      retireSession(sessionRef.current, false)
      contextRef.current = null
    }
  }, [retireSession])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active'
      appActiveRef.current = active
      if (!active) retireSession(sessionRef.current)
      setAppActive(active)
    })
    return () => subscription.remove()
  }, [retireSession])

  useLayoutEffect(() => {
    if (authorityActive) return
    retireSession(sessionRef.current)
    contextRef.current = null
  }, [authorityActive, retireSession])

  const navigateResource = useCallback((kind: 'file' | 'output', id: string) => {
    if (!isNativeTranscriptResourceId(id)) throw safeActionError()
    if (kind === 'file') router.push({ pathname: '/(tabs)/files/file/[id]', params: { id } })
    else router.push({ pathname: '/(tabs)/files/output/[id]', params: { id } })
  }, [router])

  const openTranscriptUrl = useCallback(async (value: string, scope: NativeTranscriptScope): Promise<void> => {
    const safeUrl = validateNativeMarkdownLink(value)
    if (!safeUrl || !scope.isCurrent()) throw safeActionError()
    const classification = classifyInternalTranscriptLink(safeUrl)
    if (classification.kind === 'reject') throw safeActionError()
    if (classification.kind === 'external') {
      if (typeof WebBrowser.openBrowserAsync !== 'function') throw safeActionError()
      await WebBrowser.openBrowserAsync(classification.url)
      return
    }
    const currentView = contextRef.current?.view
    if (!currentView) throw safeActionError()
    const { route } = classification
    if (route.kind === 'files') {
      router.push('/(tabs)/files')
      return
    }
    if (route.kind === 'file' && resourceRegistry.hasCurrent('file', route.id)) {
      navigateResource('file', route.id)
      return
    }
    if (route.kind === 'output' && resourceRegistry.hasCurrent('output', route.id)) {
      navigateResource('output', route.id)
      return
    }
    if (route.kind === 'memory' && hasCurrentCitation(currentView, 'memory', route.id)) {
      router.push({ pathname: '/(tabs)/files/memory/[id]', params: { id: route.id } })
      return
    }
    throw safeActionError()
  }, [navigateResource, resourceRegistry, router])

  const buildControllerOptions = useCallback((): NativeTranscriptActionControllerOptions => ({
    getContext: () => contextRef.current,
    createDraftToken: opaqueId,
    handlers: {
      copyText: async (text, scope) => {
        if (!scope.isCurrent() || typeof Clipboard.setStringAsync !== 'function') throw safeActionError()
        await Clipboard.setStringAsync(text)
      },
      downloadText: async (filename, text, scope) => {
        if (!scope.isCurrent()) throw safeActionError()
        await shareNativeTranscriptText({ filename, text, isCurrent: scope.isCurrent, adapters: nativeTranscriptShareAdapters })
      },
      openLink: async (url, scope) => {
        if (!scope.isCurrent()) throw safeActionError()
        await openTranscriptUrl(url, scope)
      },
      reply: async (target, scope) => {
        const callback = callbacksRef.current.onReply
        if (!scope.isCurrent() || !callback) throw safeActionError()
        await callback(target, scope)
      },
      jumpToReply: async (parentExchangeId, scope) => {
        const callback = callbacksRef.current.onJumpToReply
        if (!scope.isCurrent() || !callback) throw safeActionError()
        await callback(parentExchangeId, scope)
      },
      openAsset: async (asset, scope) => {
        if (!scope.isCurrent()) throw safeActionError()
        const current = resourceRegistry.resolveCurrent(asset.handle, asset.exchangeId)
        if (!current || current.resourceId !== asset.resourceId || current.resourceKind !== asset.resourceKind) throw safeActionError()
        navigateResource(current.resourceKind, current.resourceId)
      },
      openSource: async (source, scope) => {
        if (!scope.isCurrent()) throw safeActionError()
        if (source.sourceKind === 'url') {
          const safeUrl = validateNativeMarkdownLink(source.url)
          if (!safeUrl) throw safeActionError()
          await openTranscriptUrl(safeUrl, scope)
          return
        }
        if (!isNativeTranscriptResourceId(source.sourceId) || !resourceRegistry.hasCurrent('file', source.sourceId)) throw safeActionError()
        navigateResource('file', source.sourceId)
      },
      openCitation: async (citation, scope) => {
        if (!scope.isCurrent()) throw safeActionError()
        const currentView = contextRef.current?.view
        if (!currentView || !hasCurrentCitation(currentView, citation.kind, citation.sourceId)) throw safeActionError()
        if (citation.kind === 'file') {
          if (!resourceRegistry.hasCurrent('file', citation.sourceId)) throw safeActionError()
          navigateResource('file', citation.sourceId)
        } else {
          router.push({ pathname: '/(tabs)/files/memory/[id]', params: { id: citation.sourceId } })
        }
      },
      openDraft: async (draft, scope, draftToken) => {
        const current = sessionRef.current
        if (!scope.isCurrent() || !current) throw safeActionError()
        const nextDraft = { draftToken, state: draft, scope, controller: current.controller }
        draftRef.current = nextDraft
        setDraftSession(nextDraft)
        setDraftSaveError(null)
      },
      saveDraft: async (draft, scope) => {
        const callback = callbacksRef.current.onSaveDraft
        if (!scope.isCurrent() || !callback) throw safeActionError()
        await callback(draft, scope)
      },
      dismissKeyboard: (scope) => {
        if (!scope.isCurrent()) throw safeActionError()
        Keyboard.dismiss()
      },
    },
  }), [navigateResource, openTranscriptUrl, resourceRegistry, router])

  useFocusEffect(useCallback(() => {
    if (!authorityActiveRef.current || !appActiveRef.current) return undefined
    navigationFocusedRef.current = true
    setNavigationFocused(true)
    const nextFocusNonce = `${mountNonce}_focus_${++focusEpochRef.current}`
    const controller = createNativeTranscriptActionController(buildControllerOptions())
    const nextSession = { focusNonce: nextFocusNonce, controller }
    sessionRef.current = nextSession
    setSession(nextSession)
    setFocusNonce(nextFocusNonce)
    readyFocusNonceRef.current = null
    setReadyFocusNonce(null)
    setSharingFocusNonce(null)
    setDraftSession(null)
    setDraftSaveError(null)
    const isCurrentSession = () => sessionRef.current === nextSession && authorityActiveRef.current &&
      appActiveRef.current && navigationFocusedRef.current
    void nativeTranscriptShareAdapters.isAvailable().then((available) => {
      if (isCurrentSession() && available) setSharingFocusNonce(nextFocusNonce)
    }).catch(() => {
      if (isCurrentSession()) setSharingFocusNonce(null)
    })
    return () => {
      navigationFocusedRef.current = false
      setNavigationFocused(false)
      retireSession(nextSession)
    }
  }, [appActive, authorityActive, buildControllerOptions, mountNonce, retireSession]))

  const onAction = useCallback((request: Parameters<NativeHostSession['controller']['dispatch']>[0]) => {
    const current = sessionRef.current
    return mountedRef.current && current ? current.controller.dispatch(request) : Promise.resolve(emptyActionResult('stale-scope'))
  }, [])

  const onReady = useCallback((scope: TranscriptScopeIds) => {
    if (!mountedRef.current) return
    const context = contextRef.current
    const current = sessionRef.current
    if (!context || !current || !context.focused) return
    const currentScope = { workspaceId: context.workspaceId, conversationId: context.conversationId, mountNonce: context.mountNonce, focusNonce: context.focusNonce }
    if (!sameScope(scope, currentScope) || current.focusNonce !== scope.focusNonce) {
      const sameMountedConversation = scope.workspaceId === currentScope.workspaceId &&
        scope.conversationId === currentScope.conversationId && scope.mountNonce === currentScope.mountNonce &&
        current.focusNonce === context.focusNonce && authorityActiveRef.current && appActiveRef.current && navigationFocusedRef.current
      if (sameMountedConversation && scope.focusNonce !== currentScope.focusNonce && readyFocusNonceRef.current !== currentScope.focusNonce) {
        readyFocusNonceRef.current = null
        setReadyFocusNonce(null)
        setSnapshotRefreshEpoch(epoch => (epoch + 1) % (MAX_NATIVE_TRANSCRIPT_DELIVERY_EPOCH + 1))
      }
      return
    }
    readyFocusNonceRef.current = scope.focusNonce
    setReadyFocusNonce(scope.focusNonce)
  }, [])

  const onDraftClose = useCallback(() => {
    const current = draftRef.current
    if (current) current.controller.cancelDraft(current.draftToken)
    draftRef.current = null
    setDraftSession(null)
    setSavingDraftToken(null)
    pendingDraftTokenRef.current = null
    setDraftSaveError(null)
  }, [])

  const onDraftSave = useCallback(async (editedDraft: DraftModalState) => {
    const current = draftRef.current
    if (!current || pendingDraftTokenRef.current === current.draftToken || !current.scope.isCurrent()) return
    pendingDraftTokenRef.current = current.draftToken
    setSavingDraftToken(current.draftToken)
    setDraftSaveError(null)
    const result = await current.controller.saveDraft(current.draftToken, editedDraft)
    if (draftRef.current !== current) return
    if (result.ok) {
      draftRef.current = null
      setDraftSession(null)
      setDraftSaveError(null)
    } else if (result.error === 'stale-scope' || result.error === 'unfocused' || result.error === 'unknown-target') {
      onDraftClose()
    } else {
      setDraftSaveError('Unable to save this draft. Please try again.')
    }
    pendingDraftTokenRef.current = null
    setSavingDraftToken(null)
  }, [onDraftClose])

  const effectiveView = authorityActive ? view : EMPTY_VIEW
  const assets = useMemo(() => resourceRegistry.currentAssets(), [resourceRegistry, resourceVersion])
  const active = Boolean(authorityActive && appActive && navigationFocused && session && session.focusNonce === focusNonce)
  const supportedActions = useMemo(() => {
    if (!active) return []
    const actions: NativeTranscriptActionKind[] = []
    if (typeof Clipboard.setStringAsync === 'function') actions.push('copy')
    if (typeof WebBrowser.openBrowserAsync === 'function') actions.push('open-link')
    if (typeof Keyboard.dismiss === 'function') actions.push('keyboard-dismiss')
    if (assets.some((asset) => asset.previewable === true)) actions.push('open-asset')
    if (view.exchanges.some((exchange) => exchange.responses.some((response) => response.sources.length > 0))) actions.push('open-source')
    if (view.exchanges.some((exchange) => exchange.responses.some((response) => getNativeTranscriptCitationEntries(response.sourceCitations).length > 0))) actions.push('open-citation')
    if (onReply) actions.push('reply')
    if (onJumpToReply) actions.push('jump-to-reply')
    if (onSaveDraft) actions.push('open-draft')
    if (sharingFocusNonce === focusNonce) actions.push('download-text')
    return actions
  }, [active, assets, focusNonce, onJumpToReply, onReply, onSaveDraft, sharingFocusNonce, view])

  useLayoutEffect(() => {
    if (!active) {
      contextRef.current = null
      return
    }
    contextRef.current = {
      workspaceId,
      conversationId,
      mountNonce,
      focusNonce,
      focused: true,
      mounted: true,
      allowedActions: supportedActions,
      view,
      assets: resourceRegistry.currentAssets(),
    }
  }, [active, conversationId, focusNonce, mountNonce, resourceRegistry, resourceVersion, supportedActions, view, workspaceId])

  const snapshot = useMemo(() => ({
    ...createNativeTranscriptDomSnapshot({
      workspaceId: authorityActive ? workspaceId : null,
      conversationId,
      mountNonce,
      focusNonce,
      theme: isDark ? 'dark' : 'light',
      view: effectiveView,
      supportedActions,
      publicModelLabels: authorityActive ? publicModelLabels : [],
      query: authorityActive ? query : '',
      scrollIntent: authorityActive ? scrollIntent : null,
      assets: authorityActive ? assets : [],
      deliveryEpoch: snapshotRefreshEpoch,
    }),
  }), [assets, authorityActive, conversationId, effectiveView, focusNonce, isDark, mountNonce, publicModelLabels, query, scrollIntent, snapshotRefreshEpoch, supportedActions, workspaceId])
  const ready = active && readyFocusNonce === focusNonce
  useEffect(() => {
    if (!active || ready) return
    let retries = 0
    let timeout: ReturnType<typeof setTimeout> | null = null
    const isCurrentScope = () => {
      const context = contextRef.current
      return mountedRef.current && authorityActiveRef.current && appActiveRef.current && navigationFocusedRef.current &&
        sessionRef.current?.focusNonce === focusNonce && context?.focused === true && context.focusNonce === focusNonce &&
        readyFocusNonceRef.current !== focusNonce
    }
    const scheduleRetry = () => {
      if (retries >= NATIVE_TRANSCRIPT_READY_RETRY_LIMIT || !isCurrentScope()) return
      timeout = setTimeout(() => {
        timeout = null
        if (retries >= NATIVE_TRANSCRIPT_READY_RETRY_LIMIT || !isCurrentScope()) return
        retries += 1
        setSnapshotRefreshEpoch(epoch => (epoch + 1) % (MAX_NATIVE_TRANSCRIPT_DELIVERY_EPOCH + 1))
        scheduleRetry()
      }, NATIVE_TRANSCRIPT_READY_RETRY_DELAY_MS)
    }
    scheduleRetry()
    return () => { if (timeout !== null) clearTimeout(timeout) }
  }, [active, focusNonce, ready])
  const domOptions = useMemo(() => ({ style: { flex: 1, backgroundColor: theme.background } }), [theme.background])

  return (
    <View style={[styles.surface, { backgroundColor: theme.background }]}>
      <NativeSharedTranscript
        key={`${mountNonce}:${conversationId}`}
        dom={domOptions}
        snapshot={snapshot}
        onAction={onAction}
        onReady={onReady}
      />
      {!ready ? (
        <View pointerEvents="auto" style={[styles.cover, { backgroundColor: theme.background }]}>
          {authorityActive && appActive && navigationFocused ? <ActivityIndicator color={isDark ? '#f5f5f5' : '#0a0a0a'} /> : null}
          {authorityActive && appActive && navigationFocused ? <Text style={{ color: theme.textSecondary, marginTop: 10 }}>Loading conversation…</Text> : null}
        </View>
      ) : null}
      <DraftReviewSheet
        state={draftSession?.state ?? null}
        saving={savingDraftToken !== null}
        saveError={draftSaveError ?? undefined}
        onClose={onDraftClose}
        onSave={(state) => { void onDraftSave(state) }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  surface: { flex: 1, minHeight: 0, overflow: 'hidden' },
  cover: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
})
