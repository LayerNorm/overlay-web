'use dom'

/* eslint-disable @next/next/no-img-element -- safe native-prepared preview bytes render in the bundled DOM surface */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DOMProps } from 'expo/dom'
import { getDraftFromToolBlock } from '../../../packages/overlay-chat-core/src/messages'
import { selectTranscriptResponse } from '../../../packages/overlay-chat-core/src/transcript-view'
import type { ChatTranscriptExchangeView } from '../../../packages/overlay-chat-core/src/transcript-view'
import type { DraftModalState } from '../../../packages/overlay-chat-core/src/types'
import { MessageScroller, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport, useMessageScroller } from '../../../packages/overlay-ui/src/ai'
import { Button } from '../../../packages/overlay-ui/src/primitives'
import { PlatformActionsProvider } from '../../../packages/overlay-ui/src/platform-actions'
import { ChevronLeft, ChevronRight, Eye, Reply } from 'lucide-react'
import { ChatExchange } from '../../../packages/overlay-chat-react/src/components/transcript/ChatExchange'
import { ChatTranscript } from '../../../packages/overlay-chat-react/src/components/transcript/ChatTranscript'
import type { ChatTranscriptPresentation } from '../../../packages/overlay-chat-react/src/components/transcript/ChatTranscript'
import { MediaExchange } from '../../../packages/overlay-chat-react/src/components/transcript/MediaExchange'
import { MediaSlotOutput } from '../../../packages/overlay-chat-react/src/components/MediaSlotOutput'
import { SourcesPanel } from '../../../packages/overlay-chat-react/src/components/SourcesPanel'
import { knowledgeSourceHref, knowledgeSourcesFromCitations } from '../../../packages/overlay-chat-react/src/lib/knowledge-sources'
import type { WebSourceItem } from '../../../packages/overlay-chat-react/src/lib/web-sources'
import type { AttachmentPreviewRequest, ChatExchangeProps } from '../../../packages/overlay-chat-react/src/components/transcript/ChatExchange'
import type { NativeTranscriptActionRequest, NativeTranscriptActionRequestTarget, NativeTranscriptActionResult, NativeTranscriptActionTarget } from '../../lib/nativeChatTranscriptActions'
import type {
  NativeTranscriptDomSnapshot,
  NativeTranscriptPresentationAsset,
  NativeTranscriptPresentationMedia,
  NativeTranscriptPresentationMediaResult,
} from '../../lib/nativeChatTranscriptProjection'
import { validateNativeMarkdownLink } from '../../lib/sharedMarkdownBridge'
import { selectionNeedsReconstruction, textSelectionPoints, type SelectionNodes } from '../../lib/sharedMarkdownSelection'
import '../../assets/shared-markdown.generated.css'

interface Props {
  snapshot: NativeTranscriptDomSnapshot
  onAction: (request: NativeTranscriptActionRequest) => Promise<NativeTranscriptActionResult>
  onReady: (scope: Pick<NativeTranscriptDomSnapshot, 'workspaceId' | 'conversationId' | 'mountNonce' | 'focusNonce'>) => void | Promise<void>
  dom?: DOMProps
}

interface SourcePanelState {
  exchangeId: string
  responseId: string
}

type SourcePanelAction =
  | { kind: 'open-source'; sourceId: string }
  | { kind: 'open-citation'; citationKey: string }

function validSourceActionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function validCitationKey(value: string): boolean {
  return /^(?:0|[1-9][0-9]{0,5})$/.test(value)
}

function sourcePanelRows(
  exchangeId: string,
  response: ChatTranscriptExchangeView['responses'][number],
  assets: readonly NativeTranscriptPresentationAsset[],
  supportsSource: boolean,
  supportsCitation: boolean,
): { sources: WebSourceItem[]; actions: Map<string, SourcePanelAction> } {
  const sources: WebSourceItem[] = []
  const actions = new Map<string, SourcePanelAction>()
  for (const source of response.sources) {
    if (!validSourceActionId(source.id)) continue
    if (source.sourceKind === 'url') {
      const url = safeHref(source.url ?? '')
      if (!url) continue
      actions.set(url, { kind: 'open-source', sourceId: source.id })
      if (supportsSource) {
        sources.push({ url, title: source.title || url, origin: 'web-search' })
      }
    } else if (source.sourceKind === 'document') {
      const asset = assets.find((item) => item.exchangeId === exchangeId && item.handle === source.sourceId && item.resourceKind === 'file')
      if (!asset) continue
      const citation = { kind: 'file' as const, sourceId: asset.handle, title: source.title || asset.label, ...(source.filename ? { snippet: source.filename } : {}) }
      const href = knowledgeSourceHref(citation)
      actions.set(href, { kind: 'open-source', sourceId: source.id })
      if (supportsSource) {
        sources.push({ url: href, internalHref: href, internalKind: 'file', title: citation.title, ...(citation.snippet ? { snippet: citation.snippet } : {}), origin: 'knowledge' })
      }
    }
  }
  if (response.sourceCitations) {
    const citations = response.sourceCitations
    const sharedRows = knowledgeSourcesFromCitations(citations)
    for (const [citationKey, citation] of Object.entries(citations)) {
      if (!validCitationKey(citationKey)) continue
      const href = knowledgeSourceHref(citation)
      const row = sharedRows.find((item) => item.internalHref === href)
      if (!row) continue
      const action = { kind: 'open-citation' as const, citationKey }
      if (supportsCitation) sources.push(row)
      actions.set(href, action)
      actions.set(`#overlay-knowcite-${citationKey}`, action)
    }
  }
  return { sources, actions }
}

function assistantBlocksForDraftCapability(
  blocks: ChatTranscriptExchangeView['responses'][number]['blocks'],
  canReviewDraft: boolean,
) {
  return blocks.filter((block) => block.kind !== 'file').map((block) => {
    if (canReviewDraft || block.kind !== 'tool' || !getDraftFromToolBlock(block)) return block
    const readOnlyBlock = { ...block }
    delete readOnlyBlock.toolOutput
    return readOnlyBlock
  })
}

interface TranscriptSelectionBookmark extends SelectionNodes<Node> {
  anchorExchangeId: string
  anchorRole: 'user' | 'response' | 'media'
  anchorTargetId: string
  anchorOffset: number
  focusExchangeId: string
  focusRole: 'user' | 'response' | 'media'
  focusTargetId: string
  focusOffset: number
}

function exchangeForNode(viewport: HTMLElement, node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement
  const exchange = element?.closest<HTMLElement>('[data-native-exchange]') ?? null
  return exchange && viewport.contains(exchange) ? exchange : null
}

function textOffset(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null
  try {
    const range = document.createRange()
    range.selectNodeContents(root)
    range.setEnd(node, offset)
    return range.toString().length
  } catch {
    return null
  }
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) nodes.push(node as Text)
  return nodes
}

function selectionOwner(viewport: HTMLElement, node: Node) {
  const element = node instanceof Element ? node : node.parentElement
  const exchange = exchangeForNode(viewport, node)
  if (!element || !exchange) return null
  const prompt = element.closest<HTMLElement>('[data-native-prompt-exchange="true"]')
  const userMessage = prompt?.querySelector<HTMLElement>('[data-slot="message"][data-align="end"]')
  if (prompt && userMessage?.contains(element)) {
    return { exchangeId: exchange.dataset.nativeExchange ?? '', role: 'user' as const, targetId: exchange.dataset.nativeUserId ?? '', root: userMessage }
  }
  if (exchange.dataset.nativeMedia === 'true') return { exchangeId: exchange.dataset.nativeExchange ?? '', role: 'media' as const, targetId: 'media', root: exchange }
  const assistant = element.closest<HTMLElement>('[data-native-assistant-exchange="true"]')
  const targetId = assistant?.dataset.nativeAssistantResponseId ?? ''
  const root = assistant?.querySelector<HTMLElement>('[data-slot="message"][data-align="start"]')
  return targetId && root ? { exchangeId: exchange.dataset.nativeExchange ?? '', role: 'response' as const, targetId, root } : null
}

function selectionRoot(viewport: HTMLElement, exchangeId: string, role: 'user' | 'response' | 'media', targetId: string): HTMLElement | null {
  const exchange = Array.from(viewport.querySelectorAll<HTMLElement>('[data-native-exchange]'))
    .find((item) => item.dataset.nativeExchange === exchangeId)
  if (!exchange) return null
  if (role === 'user') {
    if (exchange.dataset.nativeUserId !== targetId) return null
    return exchange.querySelector<HTMLElement>('[data-native-prompt-exchange="true"] [data-slot="message"][data-align="end"]')
  }
  if (role === 'media') return exchange.dataset.nativeMedia === 'true' ? exchange : null
  const assistant = exchange.querySelector<HTMLElement>(`[data-native-assistant-exchange="true"][data-native-assistant-response-id="${CSS.escape(targetId)}"]`)
  return assistant?.querySelector<HTMLElement>('[data-slot="message"][data-align="start"]') ?? null
}

function safeHref(value: string): string | null {
  if (value.length > 2048 || !validateNativeMarkdownLink(value)) return null
  try {
    const url = new URL(value)
    return url.username || url.password ? null : url.toString()
  } catch {
    return null
  }
}

function transcriptReplyParent(exchanges: readonly ChatTranscriptExchangeView[], exchangeId: string, userId: string): ChatTranscriptExchangeView | null {
  const source = exchanges.find((exchange) => exchange.id === exchangeId && exchange.user.id === userId)
  const replyToTurnId = source?.user.replyThread?.replyToTurnId
  if (!source || typeof replyToTurnId !== 'string' || !replyToTurnId) return null
  const parents = exchanges.filter((exchange) => exchange.id !== source.id && exchange.turnId === replyToTurnId)
  return parents.length === 1 ? parents[0]! : null
}

function actionTargetIsCurrent(request: NativeTranscriptActionRequest, snapshot: NativeTranscriptDomSnapshot, selectedIds: Record<string, string>): boolean {
  if (request.workspaceId !== snapshot.workspaceId || request.conversationId !== snapshot.conversationId ||
    request.mountNonce !== snapshot.mountNonce || request.focusNonce !== snapshot.focusNonce || !snapshot.supportedActions.includes(request.kind)) return false
  if (request.kind === 'keyboard-dismiss') return true
  const exchange = snapshot.view.exchanges.find((item) => item.id === request.exchangeId)
  if (!exchange) return false
  if (request.kind === 'open-asset') return snapshot.assets.some((asset) => asset.handle === request.assetHandle && asset.exchangeId === exchange.id)
  if (request.kind === 'jump-to-reply') return request.target.kind === 'user' && Boolean(transcriptReplyParent(snapshot.view.exchanges, exchange.id, request.target.userId))
  const target = request.target
  if (target.kind === 'user') return exchange.user.id === target.userId
  if (target.kind === 'media') return snapshot.media.find((media) => media.exchangeId === exchange.id)?.results.some((result) => result.assetHandle === target.assetHandle && result.status === 'completed') ?? false
  return selectedIds[exchange.id] === target.responseId && exchange.responses.some((response) => response.id === target.responseId)
}

const nativeActionKinds: readonly NativeTranscriptActionRequest['kind'][] = [
  'copy', 'download-text', 'open-link', 'reply', 'jump-to-reply', 'open-asset', 'open-source', 'open-citation', 'open-draft', 'keyboard-dismiss',
]

function actionTargetEpochKey(request: NativeTranscriptActionRequest, snapshot: NativeTranscriptDomSnapshot): string | null {
  const key = (...parts: string[]) => JSON.stringify(parts)
  switch (request.kind) {
    case 'keyboard-dismiss': return null
    case 'jump-to-reply': {
      const exchange = snapshot.view.exchanges.find((item) => item.id === request.exchangeId && item.user.id === request.target.userId)
      const replyToTurnId = exchange?.user.replyThread?.replyToTurnId ?? ''
      const parent = transcriptReplyParent(snapshot.view.exchanges, request.exchangeId, request.target.userId)
      return key('jump-to-reply', request.exchangeId, request.target.userId, replyToTurnId, parent?.id ?? '')
    }
    case 'open-asset': return key('asset', request.exchangeId, request.assetHandle)
    case 'open-source': return key('source', request.exchangeId, request.target.responseId, request.sourceId)
    case 'open-citation': return key('citation', request.exchangeId, request.target.responseId, request.citationKey)
    case 'open-draft': return key('tool', request.exchangeId, request.target.responseId, request.toolKey)
    default:
      if (request.target.kind === 'user') return key('user', request.exchangeId, request.target.userId)
      if (request.target.kind === 'media') return key('media', request.exchangeId, request.target.assetHandle)
      return key('response', request.exchangeId, request.target.responseId)
  }
}

function transcriptTargetEpochKeys(snapshot: NativeTranscriptDomSnapshot): Set<string> {
  const key = (...parts: string[]) => JSON.stringify(parts)
  const keys = new Set<string>()
  for (const exchange of snapshot.view.exchanges) {
    keys.add(key('user', exchange.id, exchange.user.id))
    const replyToTurnId = exchange.user.replyThread?.replyToTurnId
    if (typeof replyToTurnId === 'string' && replyToTurnId) {
      const parents = snapshot.view.exchanges.filter((item) => item.id !== exchange.id && item.turnId === replyToTurnId)
      keys.add(key('jump-to-reply', exchange.id, exchange.user.id, replyToTurnId, parents.length === 1 ? parents[0]!.id : ''))
    }
    for (const response of exchange.responses) {
      keys.add(key('response', exchange.id, response.id))
      for (const source of response.sources) keys.add(key('source', exchange.id, response.id, source.id))
      for (const citationKey of Object.keys(response.sourceCitations ?? {})) keys.add(key('citation', exchange.id, response.id, citationKey))
      for (const block of response.blocks) {
        if (block.kind === 'tool' && block.key) keys.add(key('tool', exchange.id, response.id, block.key))
      }
    }
  }
  for (const media of snapshot.media) {
    for (const result of media.results) {
      if (result.status === 'completed' && result.assetHandle) keys.add(key('media', media.exchangeId, result.assetHandle))
    }
  }
  for (const asset of snapshot.assets) keys.add(key('asset', asset.exchangeId, asset.handle))
  return keys
}

function textForSearch(exchange: ChatTranscriptExchangeView): string {
  const responseText = exchange.responses.flatMap((response) => response.blocks.flatMap((block) => {
    if (block.kind === 'text' || block.kind === 'reasoning') return [block.text]
    if (block.kind === 'tool') return [block.name]
    if (block.kind === 'source') return [block.title ?? '', block.filename ?? '']
    if (block.kind === 'file') return [block.mediaType ?? '']
    return [block.part.dataType]
  })).join(' ')
  return [exchange.user.text, ...exchange.user.documentNames, ...exchange.user.indexedAttachments.map((item) => item.name), responseText,
    ...exchange.responses.flatMap((response) => response.sources.map((source) => source.title ?? source.filename ?? ''))].join(' ').toLocaleLowerCase()
}

function equalDraft(left: DraftModalState, right: DraftModalState): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function NativeMediaPlaceholder({
  asset,
  supported,
  open,
}: {
  asset?: NativeTranscriptPresentationAsset
  supported: boolean
  open: (handle: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-(--border) bg-(--surface-subtle) px-3 py-2 text-sm text-(--muted)" aria-label="Media preview unavailable in transcript">
      <span>Preview unavailable in transcript</span>
      {asset && supported ? <Button variant="ghost" type="button" className="h-7" aria-label="Open native media preview" onClick={() => open(asset.handle)}><Eye size={14} />Open preview</Button> : null}
    </div>
  )
}

type SharedMediaStatusResult = {
  type: 'image' | 'video'
  status: 'generating' | 'failed'
  outputId?: string
  modelUsed?: string
}

function isNativeMediaKind(value: NativeTranscriptPresentationMedia['kind']): value is 'image' | 'video' {
  return value === 'image' || value === 'video'
}

function sharedMediaStatusResult(result: NativeTranscriptPresentationMediaResult | undefined): SharedMediaStatusResult | null {
  if (!result || (result.type !== 'image' && result.type !== 'video') || (result.status !== 'generating' && result.status !== 'failed')) return null
  return {
    type: result.type,
    status: result.status,
    ...(result.assetHandle ? { outputId: result.assetHandle } : {}),
    ...(result.modelUsed ? { modelUsed: result.modelUsed } : {}),
  }
}

function NativeMediaReplyButton({ label, onReply }: { label: string; onReply: () => void }) {
  return <Button variant="ghost" size="sm" type="button" aria-label={label} className="h-7 gap-1.5 text-xs" onClick={onReply}><Reply size={14} />Reply</Button>
}

function NativeMediaRows({
  media,
  assets,
  publicModelLabelById,
  canOpenAsset,
  canReply,
  openAsset,
  onReply,
}: {
  media: NativeTranscriptPresentationMedia
  assets: readonly NativeTranscriptPresentationAsset[]
  publicModelLabelById: ReadonlyMap<string, string>
  canOpenAsset: boolean
  canReply: boolean
  openAsset: (handle: string) => void
  onReply: (result?: NativeTranscriptPresentationMediaResult) => void
}) {
  if (!media.results.length) {
    return <div className="flex items-center justify-between gap-2" data-native-media-empty="true"><span className="text-sm text-(--muted)">No media results available</span>{canReply ? <NativeMediaReplyButton label="Reply to prompt" onReply={() => onReply()} /> : null}</div>
  }
  return (
    <div className="space-y-3" aria-label="Media results">
      {media.results.map((result, index) => {
        const asset = result.assetHandle
          ? assets.find((item) => item.exchangeId === media.exchangeId && item.resourceKind === 'output' && item.handle === result.assetHandle)
          : undefined
        const showImage = result.type === 'image' && result.status === 'completed' && Boolean(result.previewDataUrl)
        const statusSlot = sharedMediaStatusResult(result)
        return (
          <div key={`${media.exchangeId}-media-result-${index}`} className="flex flex-wrap items-center gap-2" data-native-media-result={index} data-native-media-status={result.status} data-native-media-type={result.type}>
            {showImage
              ? <img src={result.previewDataUrl} alt="Generated image preview" data-native-media-preview="image" className="max-h-60 max-w-full rounded-lg border border-(--border) object-contain" />
              : statusSlot
                ? <MediaSlotOutput genType={statusSlot.type} modelName={statusSlot.modelUsed ? publicModelLabelById.get(statusSlot.modelUsed) ?? statusSlot.modelUsed : ''} result={statusSlot} />
                : <NativeMediaPlaceholder asset={asset} supported={Boolean(asset && canOpenAsset && result.status === 'completed')} open={openAsset} />}
            {canReply ? <NativeMediaReplyButton label={result.status === 'completed' && result.assetHandle ? 'Reply to generated media' : 'Reply to prompt'} onReply={() => onReply(result)} /> : null}
          </div>
        )
      })}
      {media.omittedResultCount > 0 ? <p data-native-media-overflow={media.omittedResultCount} className="text-xs text-(--muted)">Additional media results not shown: {media.omittedResultCount}</p> : null}
    </div>
  )
}

function reconcileSelectedResponseIds(
  exchanges: readonly ChatTranscriptExchangeView[],
  previous: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const exchange of exchanges) {
    const oldId = previous[exchange.id]
    const retained = oldId && exchange.responses.find((response) => response.id === oldId)
    const selected = retained ?? selectTranscriptResponse(exchange.responses, { selectedIndex: exchange.selectedResponseIndex }).response
    if (selected) next[exchange.id] = selected.id
  }
  return next
}

type ScrollToMessage = ReturnType<typeof useMessageScroller>['scrollToMessage']

function MessageScrollerScrollBridge({ bind }: { bind: (scrollToMessage: ScrollToMessage | null) => void }) {
  const { scrollToMessage } = useMessageScroller()
  useLayoutEffect(() => {
    bind(scrollToMessage)
    return () => bind(null)
  }, [bind, scrollToMessage])
  return null
}

export default function NativeSharedTranscript(props: Props) {
  const { snapshot } = props
  const key = JSON.stringify([snapshot.workspaceId, snapshot.conversationId, snapshot.mountNonce])
  return <ScopedNativeSharedTranscript key={key} {...props} />
}

function ScopedNativeSharedTranscript({ snapshot, onAction, onReady }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const scrollToMessageRef = useRef<ScrollToMessage | null>(null)
  const processedIntents = useRef<string[]>([])
  const pointerDrag = useRef<{ id: number; y: number; fired: boolean } | null>(null)
  const scrollPosition = useRef(0)
  const selectionBookmark = useRef<TranscriptSelectionBookmark | null>(null)
  const scopeKey = JSON.stringify([snapshot.workspaceId, snapshot.conversationId, snapshot.mountNonce])
  const readyKey = JSON.stringify([scopeKey, snapshot.focusNonce])
  const bindScrollToMessage = useCallback((scrollToMessage: ScrollToMessage | null) => {
    scrollToMessageRef.current = scrollToMessage
  }, [])
  const lifecycle = useRef({ scopeKey, focusNonce: snapshot.focusNonce, generation: 0, active: false })
  const committedScopeKey = useRef(scopeKey)
  const [selectionState, setSelectionState] = useState(() => ({
    exchanges: snapshot.view.exchanges,
    byExchange: reconcileSelectedResponseIds(snapshot.view.exchanges, {}),
  }))
  if (selectionState.exchanges !== snapshot.view.exchanges) {
    setSelectionState({
      exchanges: snapshot.view.exchanges,
      byExchange: reconcileSelectedResponseIds(snapshot.view.exchanges, selectionState.byExchange),
    })
  }
  const selectedIds = selectionState.byExchange
  const committedActions = useRef({
    snapshot,
    selectedIds,
    capabilityEpochs: {} as Record<string, number>,
    selectionEpochs: {} as Record<string, number>,
    targetEpochs: {} as Record<string, number>,
    targetKeys: transcriptTargetEpochKeys(snapshot),
  })
  useLayoutEffect(() => {
    const previous = committedActions.current
    const capabilityEpochs = { ...previous.capabilityEpochs }
    for (const kind of nativeActionKinds) {
      if (previous.snapshot.supportedActions.includes(kind) !== snapshot.supportedActions.includes(kind)) {
        capabilityEpochs[kind] = (capabilityEpochs[kind] ?? 0) + 1
      }
    }
    const selectionEpochs = { ...previous.selectionEpochs }
    for (const exchangeId of new Set([...Object.keys(previous.selectedIds), ...Object.keys(selectedIds)])) {
      if (previous.selectedIds[exchangeId] !== selectedIds[exchangeId]) {
        selectionEpochs[exchangeId] = (selectionEpochs[exchangeId] ?? 0) + 1
      }
    }
    const targetKeys = transcriptTargetEpochKeys(snapshot)
    const targetEpochs = { ...previous.targetEpochs }
    for (const key of new Set([...previous.targetKeys, ...targetKeys])) {
      if (previous.targetKeys.has(key) !== targetKeys.has(key)) targetEpochs[key] = (targetEpochs[key] ?? 0) + 1
    }
    committedActions.current = {
      snapshot,
      selectedIds,
      capabilityEpochs,
      selectionEpochs,
      targetEpochs,
      targetKeys,
    }
  }, [snapshot, selectedIds])
  const [noticeState, setNoticeState] = useState({ focusNonce: snapshot.focusNonce, message: '' })
  if (noticeState.focusNonce !== snapshot.focusNonce) setNoticeState({ focusNonce: snapshot.focusNonce, message: '' })
  const notice = noticeState.focusNonce === snapshot.focusNonce ? noticeState.message : ''
  const setNotice = useCallback((message: string) => setNoticeState({ focusNonce: snapshot.focusNonce, message }), [snapshot.focusNonce])
  const [sourcePanelState, setSourcePanelState] = useState(() => ({
    focusNonce: snapshot.focusNonce,
    view: snapshot.view,
    actions: snapshot.supportedActions,
    panel: null as SourcePanelState | null,
  }))
  if (sourcePanelState.focusNonce !== snapshot.focusNonce || sourcePanelState.view !== snapshot.view || sourcePanelState.actions !== snapshot.supportedActions) {
    const panel = sourcePanelState.focusNonce === snapshot.focusNonce ? sourcePanelState.panel : null
    const responseExists = panel && snapshot.view.exchanges.some((exchange) => exchange.id === panel.exchangeId && exchange.responses.some((response) => response.id === panel.responseId))
    const sourceActionAvailable = snapshot.supportedActions.includes('open-source') || snapshot.supportedActions.includes('open-citation')
    const sourceActionRevoked = ['open-source', 'open-citation'].some((action) =>
      sourcePanelState.actions.includes(action as NativeTranscriptActionRequest['kind']) && !snapshot.supportedActions.includes(action as NativeTranscriptActionRequest['kind']))
    setSourcePanelState({ focusNonce: snapshot.focusNonce, view: snapshot.view, actions: snapshot.supportedActions, panel: responseExists && sourceActionAvailable && !sourceActionRevoked ? panel : null })
  }
  const sourcePanel = sourcePanelState.focusNonce === snapshot.focusNonce ? sourcePanelState.panel : null
  const changeSourcePanel = useCallback((panel: SourcePanelState | null) => {
    setSourcePanelState({ focusNonce: snapshot.focusNonce, view: snapshot.view, actions: snapshot.supportedActions, panel })
  }, [snapshot.focusNonce, snapshot.supportedActions, snapshot.view])
  const sourceResponse = sourcePanel && snapshot.view.exchanges.find((item) => item.id === sourcePanel.exchangeId)?.responses.find((item) => item.id === sourcePanel.responseId)
  const sourcePanelData = useMemo(() => sourcePanel && sourceResponse
    ? sourcePanelRows(sourcePanel.exchangeId, sourceResponse, snapshot.assets, snapshot.supportedActions.includes('open-source'), snapshot.supportedActions.includes('open-citation'))
    : { sources: [] as WebSourceItem[], actions: new Map<string, SourcePanelAction>() },
  [sourcePanel, sourceResponse, snapshot.assets, snapshot.supportedActions])
  const [readyScopeKey, setReadyScopeKey] = useState('')
  const onReadyRef = useRef(onReady)
  const onActionRef = useRef(onAction)
  const scope = useMemo(() => ({ workspaceId: snapshot.workspaceId, conversationId: snapshot.conversationId, mountNonce: snapshot.mountNonce, focusNonce: snapshot.focusNonce }), [snapshot.workspaceId, snapshot.conversationId, snapshot.mountNonce, snapshot.focusNonce])
  const supported = useCallback((kind: NativeTranscriptActionRequest['kind']) => snapshot.supportedActions.includes(kind), [snapshot.supportedActions])
  const publicModelLabelById = useMemo(() => new Map(snapshot.publicModelLabels.map((entry) => [entry.id, entry.name])), [snapshot.publicModelLabels])

  useLayoutEffect(() => {
    const generation = lifecycle.current.generation + 1
    lifecycle.current = { ...lifecycle.current, generation, active: true }
    return () => {
      lifecycle.current = { ...lifecycle.current, generation: lifecycle.current.generation + 1, active: false }
    }
  }, [])

  useLayoutEffect(() => {
    if (lifecycle.current.focusNonce === snapshot.focusNonce) return
    lifecycle.current = { ...lifecycle.current, focusNonce: snapshot.focusNonce, generation: lifecycle.current.generation + 1 }
  }, [snapshot.focusNonce])

  useLayoutEffect(() => { onReadyRef.current = onReady }, [onReady])
  useLayoutEffect(() => { onActionRef.current = onAction }, [onAction])
  useLayoutEffect(() => { document.documentElement.dataset.theme = snapshot.theme }, [snapshot.theme])

  useEffect(() => {
    let active = true
    const generation = lifecycle.current.generation
    const notifyReady = async () => {
      await (document.fonts?.ready ?? Promise.resolve())
      await new Promise<void>((resolve) => {
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve())
        else window.setTimeout(resolve, 0)
      })
      if (!active || !lifecycle.current.active || lifecycle.current.scopeKey !== scopeKey || lifecycle.current.focusNonce !== snapshot.focusNonce || lifecycle.current.generation !== generation) return
      await onReadyRef.current(scope)
      if (!active || !lifecycle.current.active || lifecycle.current.scopeKey !== scopeKey || lifecycle.current.focusNonce !== snapshot.focusNonce || lifecycle.current.generation !== generation) return
      setReadyScopeKey(readyKey)
    }
    void notifyReady().catch(() => {})
    return () => { active = false }
  }, [readyKey, scope, scopeKey, snapshot.focusNonce])

  const dispatch = useCallback(async (request: NativeTranscriptActionRequest) => {
    const generation = lifecycle.current.generation
    const start = committedActions.current
    const responseTarget = 'target' in request && request.target.kind === 'response'
    const selectionExchangeId = responseTarget && 'exchangeId' in request ? request.exchangeId : null
    const targetKey = actionTargetEpochKey(request, start.snapshot)
    const isCurrent = () => {
      const current = committedActions.current
      const capabilityCurrent = (current.capabilityEpochs[request.kind] ?? 0) === (start.capabilityEpochs[request.kind] ?? 0)
      const selectionCurrent = selectionExchangeId === null ||
        (current.selectionEpochs[selectionExchangeId] ?? 0) === (start.selectionEpochs[selectionExchangeId] ?? 0)
      const targetCurrent = targetKey === null || (current.targetEpochs[targetKey] ?? 0) === (start.targetEpochs[targetKey] ?? 0)
      return lifecycle.current.active && lifecycle.current.scopeKey === scopeKey && lifecycle.current.focusNonce === request.focusNonce &&
        lifecycle.current.generation === generation && capabilityCurrent && selectionCurrent && targetCurrent &&
        actionTargetIsCurrent(request, current.snapshot, current.selectedIds)
    }
    if (!isCurrent()) throw new Error('Action unavailable')
    let result: NativeTranscriptActionResult
    try { result = await onActionRef.current(request) } catch {
      if (isCurrent()) setNotice('Action unavailable')
      throw new Error('Action unavailable')
    }
    if (!isCurrent()) throw new Error('Action unavailable')
    if (!result.ok) {
      if (result.error !== 'stale-scope' && result.error !== 'unfocused') {
        setNotice(result.error === 'canceled' ? 'Action canceled' : 'Action unavailable')
      }
      throw new Error('Action unavailable')
    }
    setNotice('')
  }, [scopeKey, setNotice])

  const rememberSelection = useCallback(() => {
    const viewport = viewportRef.current
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
    if (!viewport || !selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
      const saved = selectionBookmark.current
      if (saved && (!saved.anchorNode.isConnected || !saved.focusNode.isConnected)) return
      selectionBookmark.current = null
      return
    }
    const anchor = selectionOwner(viewport, selection.anchorNode)
    const focus = selectionOwner(viewport, selection.focusNode)
    const anchorOffset = anchor && textOffset(anchor.root, selection.anchorNode, selection.anchorOffset)
    const focusOffset = focus && textOffset(focus.root, selection.focusNode, selection.focusOffset)
    if (!anchor || !focus || anchorOffset === null || anchorOffset === undefined || focusOffset === null || focusOffset === undefined) {
      selectionBookmark.current = null
      return
    }
    selectionBookmark.current = {
      anchorExchangeId: anchor.exchangeId, anchorRole: anchor.role, anchorTargetId: anchor.targetId, anchorOffset,
      focusExchangeId: focus.exchangeId, focusRole: focus.role, focusTargetId: focus.targetId, focusOffset,
      anchorNode: selection.anchorNode, focusNode: selection.focusNode,
    }
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', rememberSelection)
    return () => document.removeEventListener('selectionchange', rememberSelection)
  }, [rememberSelection])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new MutationObserver(() => {
      const saved = selectionBookmark.current
      if (!saved || !selectionNeedsReconstruction(saved, (node) => node.isConnected && viewport.contains(node))) return
      const anchorRoot = selectionRoot(viewport, saved.anchorExchangeId, saved.anchorRole, saved.anchorTargetId)
      const focusRoot = selectionRoot(viewport, saved.focusExchangeId, saved.focusRole, saved.focusTargetId)
      const points = anchorRoot && focusRoot && textSelectionPoints(textNodes(anchorRoot), saved.anchorOffset, textNodes(focusRoot), saved.focusOffset)
      const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
      if (!points || !selection) { selectionBookmark.current = null; return }
      selection.setBaseAndExtent(points.anchor.node, points.anchor.offset, points.focus.node, points.focus.offset)
      rememberSelection()
    })
    observer.observe(viewport, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [rememberSelection, scopeKey])

  const filteredView = useMemo(() => {
    const query = snapshot.query.trim().toLocaleLowerCase()
    if (!query) return snapshot.view
    return { ...snapshot.view, exchanges: snapshot.view.exchanges.filter((exchange) => textForSearch(exchange).includes(query)) }
  }, [snapshot.query, snapshot.view])

  useEffect(() => {
    const intent = snapshot.scrollIntent
    const viewport = viewportRef.current
    const intentKey = intent ? JSON.stringify([scopeKey, intent.id]) : ''
    if (!intent || !viewport || readyScopeKey !== readyKey || processedIntents.current.includes(intentKey)) return
    const markIntentProcessed = () => {
      processedIntents.current.push(intentKey)
      if (processedIntents.current.length > 64) processedIntents.current.shift()
    }
    if (intent.kind === 'initial-end' || intent.kind === 'submission') {
      if (!viewport.querySelector('[data-chat-transcript]')) return
      viewport.scrollTop = viewport.scrollHeight
      scrollPosition.current = viewport.scrollTop
    } else if (intent.kind === 'restore') {
      if (!viewport.querySelector('[data-chat-transcript]')) return
      viewport.scrollTop = intent.scrollTop
      scrollPosition.current = viewport.scrollTop
    }
    else if (intent.kind === 'reply') {
      if (!intent.exchangeId || !filteredView.exchanges.some((exchange) => exchange.id === intent.exchangeId)) return
      let attempts = 0
      let frame = 0
      const revealReply = () => {
        if (!lifecycle.current.active || lifecycle.current.scopeKey !== scopeKey || lifecycle.current.focusNonce !== snapshot.focusNonce) return
        const scrollToMessage = scrollToMessageRef.current
        if (scrollToMessage?.(intent.exchangeId, { align: 'start', behavior: 'instant' })) {
          scrollPosition.current = viewport.scrollTop
          markIntentProcessed()
          return
        }
        if (attempts++ < 2) frame = window.requestAnimationFrame(revealReply)
      }
      frame = window.requestAnimationFrame(revealReply)
      return () => window.cancelAnimationFrame(frame)
    }
    markIntentProcessed()
  }, [filteredView.exchanges, readyKey, readyScopeKey, scopeKey, snapshot.focusNonce, snapshot.scrollIntent])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (committedScopeKey.current !== scopeKey) {
      committedScopeKey.current = scopeKey
      selectionBookmark.current = null
      scrollPosition.current = 0
      viewport.scrollTop = 0
      return
    }
    viewport.scrollTop = scrollPosition.current
    const saved = selectionBookmark.current
    if (!saved || !selectionNeedsReconstruction(saved, (node) => node.isConnected && viewport.contains(node))) return
    const anchorRoot = selectionRoot(viewport, saved.anchorExchangeId, saved.anchorRole, saved.anchorTargetId)
    const focusRoot = selectionRoot(viewport, saved.focusExchangeId, saved.focusRole, saved.focusTargetId)
    const points = anchorRoot && focusRoot && textSelectionPoints(textNodes(anchorRoot), saved.anchorOffset, textNodes(focusRoot), saved.focusOffset)
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
    if (!points || !selection) { selectionBookmark.current = null; return }
    selection.setBaseAndExtent(points.anchor.node, points.anchor.offset, points.focus.node, points.focus.offset)
    rememberSelection()
  }, [filteredView, rememberSelection, scopeKey, snapshot.theme])

  const openAsset = useCallback((exchangeId: string, handle: string) => {
    void dispatch({ kind: 'open-asset', ...scope, exchangeId, assetHandle: handle }).catch(() => {})
  }, [dispatch, scope])

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport) scrollPosition.current = viewport.scrollTop
  }, [])

  const renderExchange = useCallback((exchange: ChatTranscriptExchangeView, presentation: ChatTranscriptPresentation) => {
    const mediaPresentation = snapshot.media.find((item) => item.exchangeId === exchange.id)
    const fallback = selectTranscriptResponse(exchange.responses, { selectedIndex: exchange.selectedResponseIndex })
    const savedId = selectedIds[exchange.id]
    let response = savedId ? exchange.responses.find((item) => item.id === savedId) ?? null : null
    if (!response) response = fallback.response
    const responseIndex = response ? exchange.responses.indexOf(response) : -1
    const selectedStatus = response?.status ?? exchange.status
    const mediaAssets = snapshot.assets.filter((asset) => asset.exchangeId === exchange.id && asset.resourceKind === 'output')
    const fileAssets = snapshot.assets.filter((asset) => asset.exchangeId === exchange.id && asset.resourceKind === 'file')
    const responseTarget: NativeTranscriptActionTarget | null = response ? { kind: 'response', responseId: response.id } : null
    const userTarget: Extract<NativeTranscriptActionTarget, { kind: 'user' }> = { kind: 'user', userId: exchange.user.id }
    const replyThreadMeta = exchange.user.replyThread
    const jumpToReply = (turnId: string) => {
      const replyToTurnId = exchange.user.replyThread?.replyToTurnId
      if (!replyToTurnId || turnId !== replyToTurnId) { setNotice('Reply unavailable'); return }
      const parent = transcriptReplyParent(snapshot.view.exchanges, exchange.id, exchange.user.id)
      if (!parent) { setNotice('Reply unavailable'); return }
      if (supported('jump-to-reply')) {
        void dispatch({ kind: 'jump-to-reply', ...scope, exchangeId: exchange.id, target: userTarget }).catch(() => {})
        return
      }
      if (!filteredView.exchanges.some((item) => item.id === parent.id)) {
        setNotice(snapshot.query.trim() ? 'Clear search to view this reply' : 'Reply unavailable')
        return
      }
      const scrollToMessage = scrollToMessageRef.current
      if (!scrollToMessage || !scrollToMessage(parent.id, { align: 'start', behavior: 'instant' })) {
        setNotice('Reply unavailable')
        return
      }
      const viewport = viewportRef.current
      if (viewport) scrollPosition.current = viewport.scrollTop
      setNotice('')
    }
    const panelIsOpen = sourcePanel?.exchangeId === exchange.id && sourcePanel.responseId === response?.id
    const copyPrompt = async (text: string) => {
      await dispatch({ kind: 'copy', ...scope, exchangeId: exchange.id, target: userTarget, text })
    }
    const copyResponse = async (text: string) => {
      if (!responseTarget) throw new Error('Action unavailable')
      await dispatch({ kind: 'copy', ...scope, exchangeId: exchange.id, target: responseTarget, text })
    }
    const replyMedia = (result?: NativeTranscriptPresentationMediaResult) => {
      if (!supported('reply')) return
      const target: NativeTranscriptActionRequestTarget = result?.status === 'completed' && result.assetHandle
        ? { kind: 'media', assetHandle: result.assetHandle }
        : userTarget
      void dispatch({ kind: 'reply', ...scope, exchangeId: exchange.id, target }).catch(() => {})
    }
    const platformDownload = async (filename: string, text: string) => {
      if (!responseTarget || !response) throw new Error('Action unavailable')
      await dispatch({ kind: 'download-text', ...scope, exchangeId: exchange.id, target: responseTarget, filename, text })
    }
    const openDraft = (draft: DraftModalState) => {
      if (!response) return
      if (!supported('open-draft')) { setNotice('Draft review unavailable'); return }
      const tool = response.blocks.find((block) => {
        if (block.kind !== 'tool' || !block.key) return false
        const candidate = getDraftFromToolBlock(block)
        return candidate ? equalDraft(candidate, draft) : false
      })
      if (!tool || tool.kind !== 'tool') return
      void dispatch({ kind: 'open-draft', ...scope, exchangeId: exchange.id, target: { kind: 'response', responseId: response.id }, toolKey: tool.key }).catch(() => {})
    }
    const filePreview: ChatExchangeProps['onOpenFilePreview'] = supported('open-asset') ? (_name, handles) => {
      handles.filter((handle) => fileAssets.some((asset) => asset.handle === handle)).forEach((handle) => openAsset(exchange.id, handle))
    } : undefined
    const attachmentPreview: ChatExchangeProps['onOpenAttachmentPreview'] = supported('open-link') ? (preview: AttachmentPreviewRequest) => {
      const url = safeHref(preview.url ?? '')
      if (!url || !exchange.user.images.some((image) => image.url === url)) return
      void dispatch({ kind: 'open-link', ...scope, exchangeId: exchange.id, target: userTarget, url }).catch(() => {})
    } : undefined
    const userPromptExchange = (
      <div data-native-prompt-exchange="true" data-native-copy-disabled={supported('copy') ? undefined : 'true'}>
        <PlatformActionsProvider copyText={copyPrompt}>
          <ChatExchange
            userMsgId={exchange.user.id} userBodyText={exchange.user.text} userDocumentNames={[...exchange.user.documentNames]}
            userIndexedAttachments={exchange.user.indexedAttachments.map((item) => ({ name: item.name, fileIds: [...item.fileIds] }))} userImages={[]}
            exchIdx={exchange.index} responseModelId="" assistantVisualBlocks={[]} responseSources={[]}
            isStreaming={false} isTextStreaming={false} errorMessage={null} responseInProgress={false} status="completed"
            turnIdForActions={null} modelLabel="" onDeleteTurn={() => setNotice('Delete unavailable in native transcript')}
            onReply={() => replyMedia()} actionsLocked replyThreadMeta={replyThreadMeta} onJumpToReply={jumpToReply}
            onOpenDraft={openDraft} onCreateAutomationDraft={openDraft} isSourcesOpenForThis={false}
            onOpenFilePreview={filePreview} onOpenAttachmentPreview={attachmentPreview} generatedUiReadOnly
            userMentions={exchange.user.mentions.map((mention) => ({ type: mention.type, id: mention.id, name: mention.name }))}
            presentation={{ ...presentation, showActions: false, showModelLabel: false }}
          />
        </PlatformActionsProvider>
      </div>
    )

    return (
      <div key={exchange.id} data-native-exchange={exchange.id} data-native-user-id={exchange.user.id} data-native-response-id={mediaPresentation ? '' : response?.id ?? ''} data-native-media={mediaPresentation ? 'true' : 'false'}>
        {mediaPresentation ? (() => {
          const mediaKind = isNativeMediaKind(mediaPresentation.kind) ? mediaPresentation.kind : null
          const statusResult = mediaPresentation.results.length === 1 ? sharedMediaStatusResult(mediaPresentation.results[0]) : null
          const canUseMediaExchange = Boolean(mediaKind && statusResult && statusResult.type === mediaKind && (
            statusResult.status === 'generating' || (statusResult.status === 'failed' && supported('copy') && supported('reply'))
          ))
          if (canUseMediaExchange && mediaKind && statusResult) {
            return <>
              <PlatformActionsProvider copyText={copyPrompt}>
                <div data-native-copy-disabled={supported('copy') ? undefined : 'true'} data-native-media-result={0} data-native-media-status={statusResult.status} data-native-media-type={statusResult.type}>
                  <MediaExchange exchangeIndex={exchange.index} turnId={null} kind={mediaKind} promptText={exchange.user.text} userImages={[]} replyThread={replyThreadMeta}
                    results={[statusResult]} modelIds={statusResult.modelUsed ? [statusResult.modelUsed] : []} modelLabel={statusResult.modelUsed ? publicModelLabelById.get(statusResult.modelUsed) ?? statusResult.modelUsed : ''}
                    getModelDisplayName={(id) => publicModelLabelById.get(id) ?? id} onJumpToReply={jumpToReply} onDeleteTurn={() => setNotice('Delete unavailable in native transcript')}
                    onReply={() => replyMedia()} onOpenAttachmentPreview={() => setNotice('Attachment preview unavailable')} actionVisibility={presentation?.actionVisibility} />
                </div>
              </PlatformActionsProvider>
              {statusResult.status === 'generating' && supported('reply') ? <NativeMediaReplyButton label="Reply to prompt" onReply={() => replyMedia()} /> : null}
            </>
          }
          return <>
            {userPromptExchange}
            <NativeMediaRows media={mediaPresentation} assets={mediaAssets} publicModelLabelById={publicModelLabelById} canOpenAsset={supported('open-asset')} canReply={supported('reply')}
              openAsset={(handle) => openAsset(exchange.id, handle)} onReply={replyMedia} />
          </>
        })() : (
          <div className="space-y-2">
            {exchange.responses.length > 1 ? <div className="flex items-center justify-end gap-1" aria-label="Assistant response versions">
              <Button variant="ghost" size="icon" type="button" aria-label="Previous response" disabled={responseIndex <= 0} onClick={() => { const next = exchange.responses[responseIndex - 1]; if (next) { setSelectionState((current) => ({ exchanges: snapshot.view.exchanges, byExchange: { ...reconcileSelectedResponseIds(snapshot.view.exchanges, current.byExchange), [exchange.id]: next.id } })); changeSourcePanel(null) } }} className="h-7 w-7"><ChevronLeft size={15} /></Button>
              <span className="min-w-12 text-center text-xs text-(--muted)" aria-live="polite">{responseIndex + 1} of {exchange.responses.length}</span>
              <Button variant="ghost" size="icon" type="button" aria-label="Next response" disabled={responseIndex < 0 || responseIndex >= exchange.responses.length - 1} onClick={() => { const next = exchange.responses[responseIndex + 1]; if (next) { setSelectionState((current) => ({ exchanges: snapshot.view.exchanges, byExchange: { ...reconcileSelectedResponseIds(snapshot.view.exchanges, current.byExchange), [exchange.id]: next.id } })); changeSourcePanel(null) } }} className="h-7 w-7"><ChevronRight size={15} /></Button>
            </div> : null}
            {userPromptExchange}
            {response ? <div data-native-assistant-exchange="true" data-native-assistant-response-id={response.id}
              data-native-copy-disabled={supported('copy') ? undefined : 'true'}
              data-native-download-disabled={supported('download-text') ? undefined : 'true'}
              data-native-reply-disabled={supported('reply') ? undefined : 'true'}>
              <PlatformActionsProvider copyText={copyResponse} downloadText={platformDownload}>
                <ChatExchange key={response.id}
                  userMsgId={exchange.user.id} userBodyText="" userDocumentNames={[]} userIndexedAttachments={[]} userImages={[]}
                  exchIdx={exchange.index} responseModelId={response.modelId} assistantVisualBlocks={assistantBlocksForDraftCapability(response.blocks, supported('open-draft'))}
                  responseSources={response.sources} isStreaming={selectedStatus === 'streaming'} isTextStreaming={selectedStatus === 'streaming'}
                  errorMessage={response.errorMessage} responseInProgress={['submitted', 'streaming', 'awaiting-approval', 'executing-tool'].includes(selectedStatus)} status={selectedStatus}
                  turnIdForActions={null} modelLabel={publicModelLabelById.get(response.modelId) ?? response.modelId} onDeleteTurn={() => setNotice('Delete unavailable in native transcript')}
                  onReply={() => { if (supported('reply') && responseTarget) void dispatch({ kind: 'reply', ...scope, exchangeId: exchange.id, target: responseTarget }).catch(() => {}) }}
                  actionsLocked replyThreadMeta={null} onJumpToReply={jumpToReply} onOpenDraft={openDraft} onCreateAutomationDraft={openDraft}
                  onOpenSources={supported('open-source') || supported('open-citation')
                    ? () => changeSourcePanel({ exchangeId: exchange.id, responseId: response.id })
                    : undefined}
                  isSourcesOpenForThis={panelIsOpen} onOpenFilePreview={filePreview} onOpenAttachmentPreview={attachmentPreview}
                  generatedUiReadOnly sourceCitations={response.sourceCitations} userMentions={[]}
                  presentation={{ ...presentation, showActions: supported('reply') || supported('copy') || supported('open-source') || supported('open-citation') }}
                />
              </PlatformActionsProvider>
            </div> : null}
            {snapshot.unavailablePreviews.filter((item) => item.exchangeId === exchange.id).map((item, index) => <NativeMediaPlaceholder key={`${exchange.id}-unavailable-${index}`} supported={false} open={() => {}} asset={{ handle: '', exchangeId: item.exchangeId, label: item.label, resourceKind: 'file' }} />)}
            {fileAssets.length || exchange.user.documentNames.length ? <div className="flex flex-wrap gap-2" aria-label="Attachments">
              {fileAssets.map((asset) => <span key={asset.handle} className="inline-flex items-center gap-2 rounded border border-(--border) px-2 py-1 text-xs text-(--muted)">{asset.previewDataUrl ? <img src={asset.previewDataUrl} alt="" className="h-8 w-8 object-cover" /> : null}{asset.label}{supported('open-asset') ? <Button variant="ghost" type="button" onClick={() => openAsset(exchange.id, asset.handle)}>Open preview</Button> : null}</span>)}
            </div> : null}
          </div>
        )}
      </div>
    )
  }, [changeSourcePanel, dispatch, filteredView.exchanges, openAsset, publicModelLabelById, scope, selectedIds, setNotice, snapshot.assets, snapshot.media, snapshot.query, snapshot.unavailablePreviews, snapshot.view.exchanges, sourcePanel, supported])

  const dispatchSourceAction = useCallback((action: SourcePanelAction, exchangeId: string, responseId: string) => {
    const target = { kind: 'response' as const, responseId }
    if (action.kind === 'open-citation') {
      if (supported('open-citation')) void dispatch({ kind: 'open-citation', ...scope, exchangeId, target, citationKey: action.citationKey }).catch(() => {})
      else setNotice('Source unavailable')
    } else if (supported('open-source')) {
      void dispatch({ kind: 'open-source', ...scope, exchangeId, target, sourceId: action.sourceId }).catch(() => {})
    } else setNotice('Source unavailable')
  }, [dispatch, scope, setNotice, supported])

  const onClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    if (anchor.closest('[data-native-sources]')) return
    event.preventDefault()
    event.stopPropagation()
    const href = anchor.getAttribute('href') ?? ''
    const userMessage = anchor.closest<HTMLElement>('[data-slot="message"][data-align="end"]')
    const host = anchor.closest<HTMLElement>('[data-native-exchange]')
    const exchange = host && snapshot.view.exchanges.find((item) => item.id === host.dataset.nativeExchange)
    const response = !userMessage && exchange?.responses.find((item) => item.id === host?.dataset.nativeResponseId)
    if (exchange && response) {
      const action = sourcePanelRows(exchange.id, response, snapshot.assets, supported('open-source'), supported('open-citation')).actions.get(href)
      if (action) {
        dispatchSourceAction(action, exchange.id, response.id)
        return
      }
    }
    const url = safeHref(href)
    if (!url) { setNotice('Link unavailable'); return }
    if (exchange && supported('open-link')) void dispatch({ kind: 'open-link', ...scope, exchangeId: exchange.id, target: userMessage || !response ? { kind: 'user', userId: exchange.user.id } : { kind: 'response', responseId: response.id }, url }).catch(() => {})
    else setNotice('Link opening unavailable')
  }, [dispatch, dispatchSourceAction, scope, setNotice, snapshot.assets, snapshot.view.exchanges, supported])

  const onSourcePanelClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    event.preventDefault()
    event.stopPropagation()
    const action = sourcePanelData.actions.get(anchor.getAttribute('href') ?? '')
    if (!action || !sourcePanel) { setNotice('Source unavailable'); return }
    dispatchSourceAction(action, sourcePanel.exchangeId, sourcePanel.responseId)
  }, [dispatchSourceAction, setNotice, sourcePanel, sourcePanelData.actions])

  const dragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isTrusted || !event.isPrimary) return
    pointerDrag.current = { id: event.pointerId, y: event.clientY, fired: false }
  }, [])
  const dragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDrag.current
    if (!drag || !event.isTrusted || drag.id !== event.pointerId || drag.fired || Math.abs(event.clientY - drag.y) < 12) return
    drag.fired = true
    if (supported('keyboard-dismiss')) void dispatch({ kind: 'keyboard-dismiss', ...scope, intent: 'user-drag' }).catch(() => {})
  }, [dispatch, scope, supported])
  const dragEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => { if (pointerDrag.current?.id === event.pointerId) pointerDrag.current = null }, [])

  return (
    <MessageScrollerProvider defaultScrollPosition="start" autoScroll={false}>
      <MessageScrollerScrollBridge bind={bindScrollToMessage} />
      <MessageScroller className="overlay-chat-surface relative h-full min-h-0 w-full overflow-hidden bg-(--background) text-(--foreground)" data-theme={snapshot.theme}>
        <MessageScrollerViewport ref={viewportRef} aria-label="Conversation" onClickCapture={onClickCapture} onScroll={handleScroll} onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} className="overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
          <MessageScrollerContent data-chat-transcript className="mx-auto w-full min-w-0 max-w-4xl gap-5 sm:gap-6">
            <ChatTranscript view={filteredView} actions={{ renderExchange }} presentation={{ density: 'comfortable', actionVisibility: 'always', showActions: true }} scrollItems />
            {notice ? <p className="px-2 text-xs text-(--muted)" role="status" aria-live="polite">{notice}</p> : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {sourceResponse && sourcePanel ? <div
          data-native-sources
          role="dialog"
          aria-label="Sources"
          aria-modal="true"
          onClickCapture={onSourcePanelClickCapture}
          onClick={(event) => { if (event.target === event.currentTarget) changeSourcePanel(null) }}
          className="absolute inset-2 z-40 flex justify-end rounded-lg bg-black/30 p-1"
        >
          <div className="relative max-h-full w-full max-w-[24rem] overflow-hidden rounded-xl border border-(--border) bg-(--sidebar-surface) shadow-xl">
            <SourcesPanel open variant="shell" onClose={() => changeSourcePanel(null)} sources={sourcePanelData.sources} onOpenSource={(url) => {
              const action = sourcePanelData.actions.get(safeHref(url) ?? url)
              if (action && sourcePanel) dispatchSourceAction(action, sourcePanel.exchangeId, sourcePanel.responseId)
              else setNotice('Source unavailable')
            }} />
          </div>
        </div> : null}
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
