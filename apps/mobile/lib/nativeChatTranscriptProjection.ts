import { getDraftFromToolBlock } from '../../packages/overlay-chat-core/src/messages'
import { generatedUiDataToPlainText, normalizeGeneratedUiData } from '../../packages/overlay-chat-core/src/generated-ui'
import type { GeneratedUiData } from '../../packages/overlay-chat-core/src/generated-ui'
import type { AssistantVisualBlock } from '../../packages/overlay-chat-core/src/types'
import type {
  ChatTranscriptExchangeView,
  ChatTranscriptResponseView,
  ChatTranscriptSourceView,
  ChatTranscriptView,
} from '../../packages/overlay-chat-core/src/transcript-view'
import type { AutomationScheduleDraft, DraftModalState } from '../../packages/overlay-chat-core/src/types'
import { MAX_TRANSCRIPT_TEXT_LENGTH, type NativeTranscriptActionKind, type NativeTranscriptAsset } from './nativeChatTranscriptActions'
import { validateNativeMarkdownLink } from './sharedMarkdownBridge'
import { MAX_AUTOMATION_GRAPH_SOURCE_LENGTH } from './nativeTranscriptLimits'
import { getNativeTranscriptCitationEntries, isNativeTranscriptResourceId } from './nativeTranscriptCitations'

const MAX_SNAPSHOT_TEXT = MAX_TRANSCRIPT_TEXT_LENGTH
const MAX_PREVIEW_BYTES = 2_000_000
const MAX_MEDIA_RESULTS = 100
const SECRET_KEY = /(?:auth|cookie|header|password|secret|token|credential|bypass|access.?token|refresh|approval|raw.?run|execution|^run$)/i
const NATIVE_ACTIONS = new Set<NativeTranscriptActionKind>([
  'copy', 'download-text', 'open-link', 'reply', 'jump-to-reply', 'open-asset', 'open-source', 'open-citation', 'open-draft', 'keyboard-dismiss',
])

export type NativeTranscriptScrollIntent =
  | { id: string; kind: 'initial-end' | 'submission' }
  | { id: string; kind: 'restore'; scrollTop: number }
  | { id: string; kind: 'reply'; exchangeId: string }

export interface NativeTranscriptProjectionAsset extends NativeTranscriptAsset {
  label?: string
  previewDataUrl?: string
}

export interface NativeTranscriptPresentationAsset {
  handle: string
  exchangeId: string
  label: string
  resourceKind: 'file' | 'output'
  previewDataUrl?: string
}

export interface NativeTranscriptUnavailablePreview {
  exchangeId: string
  label: string
}

export type NativeTranscriptMediaKind = 'image' | 'video' | 'unsupported'
export type NativeTranscriptMediaStatus = 'generating' | 'failed' | 'completed' | 'unavailable'

export interface NativeTranscriptPresentationMediaResult {
  type: NativeTranscriptMediaKind
  status: NativeTranscriptMediaStatus
  assetHandle?: string
  modelUsed?: string
  previewDataUrl?: string
}

export interface NativeTranscriptPresentationMedia {
  exchangeId: string
  kind: NativeTranscriptMediaKind
  results: readonly NativeTranscriptPresentationMediaResult[]
  omittedResultCount: number
}

export interface NativeTranscriptDomSnapshot {
  version: 1
  deliveryEpoch: number
  workspaceId: string | null
  conversationId: string
  mountNonce: string
  focusNonce: string
  theme: 'light' | 'dark'
  view: ChatTranscriptView
  supportedActions: readonly NativeTranscriptActionKind[]
  publicModelLabels: readonly { id: string; name: string }[]
  query: string
  scrollIntent: NativeTranscriptScrollIntent | null
  assets: readonly NativeTranscriptPresentationAsset[]
  media: readonly NativeTranscriptPresentationMedia[]
  unavailablePreviews: readonly NativeTranscriptUnavailablePreview[]
}

export interface NativeTranscriptProjectionInput {
  deliveryEpoch?: number
  workspaceId: string | null
  conversationId: string
  mountNonce: string
  focusNonce: string
  theme: 'light' | 'dark'
  view: ChatTranscriptView
  supportedActions: readonly NativeTranscriptActionKind[]
  publicModelLabels?: readonly { id: string; name: string }[]
  query: string
  scrollIntent: NativeTranscriptScrollIntent | null
  assets: readonly NativeTranscriptProjectionAsset[]
}

export const MAX_NATIVE_TRANSCRIPT_DELIVERY_EPOCH = 1_000_000

function boundedText(value: unknown, max = MAX_SNAPSHOT_TEXT): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function safeScopeId(value: unknown): string {
  return isNativeTranscriptResourceId(value) ? value : ''
}

function safeDisplayName(value: unknown, fallback = 'Attached file'): string {
  if (typeof value !== 'string') return fallback
  const name = value.replace(/\\/g, '/').split('/').pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 256) ?? ''
  return name && name !== '.' && name !== '..' && !name.includes('..') ? name : fallback
}

function safePreviewDataUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_PREVIEW_BYTES * 1.5) return undefined
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : undefined
}

function safePublicUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || !validateNativeMarkdownLink(value)) return undefined
  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password || /\/(?:api\/v\d+\/)?(?:files|attachments|storage)\//i.test(parsed.pathname)) return undefined
    if ([...parsed.searchParams.keys()].some((key) => SECRET_KEY.test(key) || /^(?:sig|signature|x-amz-)/i.test(key))) return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : undefined
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function boundedInteger(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined
}

const CHAT_STATUSES = new Set<ChatTranscriptExchangeView['status']>([
  'idle', 'submitted', 'streaming', 'awaiting-approval', 'executing-tool', 'completed', 'interrupted', 'error', 'cancelled',
])
const TOOL_STATES = new Set(['input-streaming', 'input-available', 'input-error', 'output-available', 'output-error', 'output-denied'])

function safeChatStatus(value: unknown, fallback: ChatTranscriptExchangeView['status'] = 'error'): ChatTranscriptExchangeView['status'] {
  return typeof value === 'string' && CHAT_STATUSES.has(value as ChatTranscriptExchangeView['status'])
    ? value as ChatTranscriptExchangeView['status']
    : fallback
}

function safeCreatedAt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000
    ? value
    : undefined
}

function safeToolState(value: unknown): string | undefined {
  return typeof value === 'string' && TOOL_STATES.has(value) ? value : undefined
}

function safeSchedule(value: unknown): AutomationScheduleDraft | undefined {
  const schedule = plainRecord(value)
  if (!schedule) return undefined
  if (schedule.kind === 'interval' && exactKeys(schedule, ['kind', 'intervalMinutes'])) {
    const intervalMinutes = boundedInteger(schedule.intervalMinutes, 1, 525_600)
    return intervalMinutes === undefined ? undefined : { kind: 'interval', intervalMinutes }
  }
  if (schedule.kind === 'daily' && exactKeys(schedule, ['kind', 'hourUTC', 'minuteUTC'])) {
    const hourUTC = boundedInteger(schedule.hourUTC, 0, 23)
    const minuteUTC = boundedInteger(schedule.minuteUTC, 0, 59)
    return hourUTC === undefined || minuteUTC === undefined ? undefined : { kind: 'daily', hourUTC, minuteUTC }
  }
  if (schedule.kind === 'weekly' && exactKeys(schedule, ['kind', 'dayOfWeekUTC', 'hourUTC', 'minuteUTC'])) {
    const dayOfWeekUTC = boundedInteger(schedule.dayOfWeekUTC, 0, 6)
    const hourUTC = boundedInteger(schedule.hourUTC, 0, 23)
    const minuteUTC = boundedInteger(schedule.minuteUTC, 0, 59)
    return dayOfWeekUTC === undefined || hourUTC === undefined || minuteUTC === undefined
      ? undefined : { kind: 'weekly', dayOfWeekUTC, hourUTC, minuteUTC }
  }
  if (schedule.kind === 'monthly' && exactKeys(schedule, ['kind', 'dayOfMonthUTC', 'hourUTC', 'minuteUTC'])) {
    const dayOfMonthUTC = boundedInteger(schedule.dayOfMonthUTC, 1, 31)
    const hourUTC = boundedInteger(schedule.hourUTC, 0, 23)
    const minuteUTC = boundedInteger(schedule.minuteUTC, 0, 59)
    return dayOfMonthUTC === undefined || hourUTC === undefined || minuteUTC === undefined
      ? undefined : { kind: 'monthly', dayOfMonthUTC, hourUTC, minuteUTC }
  }
  return undefined
}

function projectSourceCitations(
  value: unknown,
  exchangeId: string,
  registrations: readonly NativeTranscriptProjectionAsset[],
): ChatTranscriptResponseView['sourceCitations'] {
  const safe: NonNullable<ChatTranscriptResponseView['sourceCitations']> = {}
  for (const { key, citation } of getNativeTranscriptCitationEntries(value)) {
    if (citation.kind === 'file') {
      const asset = registrations.find((item) => item.exchangeId === exchangeId && item.resourceKind === 'file' && item.resourceId === citation.sourceId)
      if (!asset) continue
      safe[key] = { ...citation, sourceId: asset.handle }
    } else {
      safe[key] = citation
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined
}

type GeneratedUiProjection = { data: GeneratedUiData } | { unavailable: true } | null

function rawGeneratedBody(value: unknown): string | undefined {
  const record = plainRecord(value)
  return typeof record?.body === 'string' ? record.body : undefined
}

function generatedUiBodyExceedsLimit(value: unknown): boolean {
  const record = plainRecord(value)
  if (!record) return false
  if ((record.kind === 'draft.text' || record.kind === 'draft.email') && (rawGeneratedBody(record)?.length ?? 0) > MAX_TRANSCRIPT_TEXT_LENGTH) return true
  if (record.kind === 'draft.email' && Array.isArray(record.variants)) {
    return record.variants.slice(0, 100).some((variant) => (rawGeneratedBody(variant)?.length ?? 0) > MAX_TRANSCRIPT_TEXT_LENGTH)
  }
  return false
}

function projectGeneratedUiData(value: unknown): GeneratedUiProjection {
  if (generatedUiBodyExceedsLimit(value)) return { unavailable: true }
  const normalized = normalizeGeneratedUiData(value)
  if (!normalized) return null
  const raw = plainRecord(value)
  switch (normalized.kind) {
    case 'draft.text': {
      const data: GeneratedUiData = {
        version: 1, kind: 'draft.text', body: rawGeneratedBody(raw) ?? normalized.body,
        ...(normalized.title ? { title: boundedText(normalized.title, 512) } : {}),
        ...(normalized.format ? { format: normalized.format } : {}),
      }
      return generatedUiDataToPlainText(data).length <= MAX_TRANSCRIPT_TEXT_LENGTH ? { data } : { unavailable: true }
    }
    case 'draft.email': {
      const rawVariants = Array.isArray(raw?.variants) ? raw.variants : []
      const usedVariantIndexes = new Set<number>()
      const variants = normalized.variants?.slice(0, 6).map((variant) => {
        const match = rawVariants.findIndex((candidate, index) => {
          if (usedVariantIndexes.has(index)) return false
          const candidateRecord = plainRecord(candidate)
          if (typeof candidateRecord?.body !== 'string') return false
          const id = typeof candidateRecord.id === 'string' && candidateRecord.id.trim() ? candidateRecord.id.trim() : `variant-${index + 1}`
          const label = typeof candidateRecord.label === 'string' && candidateRecord.label.trim() ? candidateRecord.label.trim() : `Variant ${index + 1}`
          return id === variant.id && label === variant.label && candidateRecord.body.trim() === variant.body
        })
        if (match < 0) return { ...variant, body: boundedText(variant.body, MAX_TRANSCRIPT_TEXT_LENGTH) }
        usedVariantIndexes.add(match)
        return { ...variant, body: rawGeneratedBody(rawVariants[match]) ?? variant.body }
      })
      const data: GeneratedUiData = {
        version: 1, kind: 'draft.email', subject: boundedText(normalized.subject, 2_000), body: rawGeneratedBody(raw) ?? normalized.body,
        ...(normalized.to ? { to: normalized.to.slice(0, 20).map((item) => boundedText(item, 320)) } : {}),
        ...(normalized.cc ? { cc: normalized.cc.slice(0, 20).map((item) => boundedText(item, 320)) } : {}),
        ...(normalized.bcc ? { bcc: normalized.bcc.slice(0, 20).map((item) => boundedText(item, 320)) } : {}),
        ...(normalized.provider ? { provider: normalized.provider } : {}),
        ...(variants ? { variants: variants.map((variant) => ({
          id: boundedText(variant.id, 128), label: boundedText(variant.label, 128), body: boundedText(variant.body, MAX_TRANSCRIPT_TEXT_LENGTH),
          ...(variant.subject ? { subject: boundedText(variant.subject, 2_000) } : {}),
        })) } : {}),
      }
      return generatedUiDataToPlainText(data).length <= MAX_TRANSCRIPT_TEXT_LENGTH ? { data } : { unavailable: true }
    }
    case 'connector.connect': {
      const connectUrl = normalized.connectUrl ? safePublicUrl(normalized.connectUrl) : undefined
      return { data: {
        version: 1, kind: 'connector.connect', serviceName: boundedText(normalized.serviceName, 256),
        ...(normalized.slug ? { slug: boundedText(normalized.slug, 128) } : {}),
        ...(normalized.description ? { description: boundedText(normalized.description, 2_000) } : {}),
        ...(connectUrl ? { connectUrl } : {}),
        ...(typeof normalized.connected === 'boolean' ? { connected: normalized.connected } : {}),
      } }
    }
    case 'questionnaire':
      return { data: {
        version: 1, kind: 'questionnaire', prompt: boundedText(normalized.prompt, 500), multiple: normalized.multiple,
        choices: normalized.choices.slice(0, 12).map((choice) => ({ id: boundedText(choice.id, 80), label: boundedText(choice.label, 200) })),
      } }
  }
}

function safeDraft(value: unknown): DraftModalState | undefined {
  const state = plainRecord(value)
  const draft = plainRecord(state?.draft)
  if (!state || !draft || !exactKeys(state, ['kind', 'draft'])) return undefined
  const skillKeys = ['name', 'description', 'instructions', 'confidence', 'detectedIntegrations', 'reason']
  const automationKeys = [...skillKeys, 'missingFields', 'schedule', 'timezone']
  if (state.kind === 'skill' && !exactKeys(draft, skillKeys)) return undefined
  if (state.kind === 'automation' && !exactKeys(draft, [...automationKeys, ...(Object.hasOwn(draft, 'graphSource') ? ['graphSource'] : [])])) return undefined
  if (state.kind !== 'skill' && state.kind !== 'automation') return undefined
  if (state.kind === 'automation' && Object.hasOwn(draft, 'graphSource') &&
    (typeof draft.graphSource !== 'string' || draft.graphSource.length > MAX_AUTOMATION_GRAPH_SOURCE_LENGTH)) return undefined
  const common = {
    name: boundedText(draft.name, 512),
    description: boundedText(draft.description, 10_000),
    instructions: boundedText(draft.instructions, 20_000),
    confidence: draft.confidence as 'low' | 'medium' | 'high',
    detectedIntegrations: Array.isArray(draft.detectedIntegrations)
      ? draft.detectedIntegrations.filter((item): item is string => typeof item === 'string').slice(0, 100).map((item) => boundedText(item, 256))
      : [],
    reason: boundedText(draft.reason, 10_000),
  }
  if (!['low', 'medium', 'high'].includes(String(common.confidence))) return undefined
  if (state.kind === 'skill') return { kind: 'skill', draft: common as Extract<DraftModalState, { kind: 'skill' }>['draft'] }
  const schedule = safeSchedule(draft.schedule)
  if (!schedule || !Array.isArray(draft.missingFields) || typeof draft.timezone !== 'string') return undefined
  return {
    kind: 'automation',
    draft: {
      ...common,
      missingFields: draft.missingFields.filter((item): item is string => typeof item === 'string').slice(0, 100).map((item) => boundedText(item, 512)),
      schedule,
      timezone: boundedText(draft.timezone, 128),
      ...(typeof draft.graphSource === 'string' ? { graphSource: draft.graphSource } : {}),
    },
  }
}

function projectBlock(
  block: AssistantVisualBlock,
  exchangeId: string,
  registrations: readonly NativeTranscriptProjectionAsset[],
  allowDraft: boolean,
): AssistantVisualBlock | null {
  const source = plainRecord(block)
  if (!source) return null
  if (source.kind === 'reasoning') return { kind: 'reasoning', key: boundedText(source.key, 512), text: boundedText(source.text) }
  if (source.kind === 'text') return { kind: 'text', text: boundedText(source.text) }
  if (source.kind === 'file') return null
  if (source.kind === 'source') {
    if (source.sourceKind !== 'url' && source.sourceKind !== 'document') return null
    const url = safePublicUrl(source.url)
    const asset = registrations.find((item) => item.exchangeId === exchangeId && item.resourceId === source.sourceId)
    return {
      kind: 'source', id: boundedText(source.id, 512), sourceKind: source.sourceKind,
      sourceId: asset?.handle ?? '',
      ...(url ? { url } : {}), ...(source.title ? { title: boundedText(source.title, 512) } : {}),
      ...(source.mediaType ? { mediaType: boundedText(source.mediaType, 128) } : {}),
      ...(source.filename ? { filename: safeDisplayName(source.filename) } : {}),
    }
  }
  if (source.kind === 'tool' && block.kind === 'tool') {
    const state = safeToolState(source.state)
    if (!state) return { kind: 'text', text: 'Tool status unavailable.' }
    const safe: Extract<AssistantVisualBlock, { kind: 'tool' }> = {
      kind: 'tool', key: boundedText(source.key, 512), name: boundedText(source.name, 256), state,
    }
    if (allowDraft) {
      const draft = safeDraft(getDraftFromToolBlock(block))
      if (draft) safe.toolOutput = { success: true, draft: draft.draft }
    }
    return safe
  }
  if (source.kind !== 'generated-ui') return null
  const part = plainRecord(source.part)
  if (!part || part.type !== 'data' || part.dataType !== 'overlay.generated_ui') return null
  const projected = projectGeneratedUiData(part.data)
  if (!projected) return null
  if ('unavailable' in projected) return { kind: 'text', text: 'Generated content unavailable: exceeds the native transcript limit.' }
  const id = boundedText(part.id, 512)
  if (!id) return null
  return {
    kind: 'generated-ui',
    part: { type: 'data', id, dataType: 'overlay.generated_ui', data: projected.data },
  }
}

function projectExchange(
  exchange: ChatTranscriptExchangeView,
  registrations: readonly NativeTranscriptProjectionAsset[],
  allowDraft: boolean,
  fallbackIndex: number,
): ChatTranscriptExchangeView {
  const exchangeId = boundedText(exchange.id, 512)
  const sourceResponses = Array.isArray(exchange.responses) ? exchange.responses.slice(0, 100) : []
  const responses = sourceResponses.map((response) => projectResponse(exchangeId, response, registrations, allowDraft))
  const selectedResponseIndex = boundedInteger(exchange.selectedResponseIndex, 0, Math.max(0, responses.length - 1)) ?? 0
  const registeredId = (resourceId: unknown) => typeof resourceId === 'string'
    ? registrations.find((item) => item.exchangeId === exchangeId && item.resourceId === resourceId)?.handle
    : undefined
  const documentNames = Array.isArray(exchange.user?.documentNames) ? exchange.user.documentNames : []
  const indexedAttachments = Array.isArray(exchange.user?.indexedAttachments) ? exchange.user.indexedAttachments : []
  const mentions = Array.isArray(exchange.user?.mentions) ? exchange.user.mentions : []
  const user = exchange.user
  const replyThread = plainRecord(user?.replyThread)
  const mode = exchange.mode === 'ask' || exchange.mode === 'act' ? exchange.mode : 'ask'
  const generationMode = exchange.generationMode === 'text' || exchange.generationMode === 'image' || exchange.generationMode === 'video'
    ? exchange.generationMode : 'text'
  const selectedStatus = responses[selectedResponseIndex]?.status
  return {
    id: exchangeId, turnId: boundedText(exchange.turnId, 512),
    index: boundedInteger(exchange.index, 0, 1_000_000) ?? Math.max(0, fallbackIndex),
    mode, generationMode,
    user: {
      id: boundedText(user?.id, 512), text: boundedText(user?.text),
      documentNames: documentNames.slice(0, 100).map((name) => safeDisplayName(name)),
      indexedAttachments: indexedAttachments.slice(0, 100).flatMap((attachment) => {
        const safe = plainRecord(attachment)
        if (!safe) return []
        const fileIds = Array.isArray(safe.fileIds) ? safe.fileIds.map(registeredId).filter((id): id is string => Boolean(id)) : []
        return [{ name: safeDisplayName(safe.name), fileIds }]
      }),
      images: [],
      mentions: mentions.slice(0, 100).flatMap((mention) => {
        const safe = plainRecord(mention)
        if (!safe) return []
        const fileIds = Array.isArray(safe.fileIds) ? safe.fileIds.map(registeredId).filter((id): id is string => Boolean(id)) : []
        return [{ type: boundedText(safe.type, 64), id: boundedText(safe.id, 512), name: boundedText(safe.name, 256), fileIds }]
      }),
      replyThread: replyThread
        ? { replyToTurnId: boundedText(replyThread.replyToTurnId, 512), replySnippet: boundedText(replyThread.replySnippet, 2_000) }
        : null,
      ...(safeCreatedAt(user?.createdAt) !== undefined ? { createdAt: safeCreatedAt(user?.createdAt) } : {}),
    },
    responses,
    selectedResponseIndex,
    selectedModelId: typeof exchange.selectedModelId === 'string' ? boundedText(exchange.selectedModelId, 256) || null : null,
    status: safeChatStatus(exchange.status, selectedStatus ?? 'idle'),
    media: null,
  }
}

function projectMedia(
  exchange: ChatTranscriptExchangeView,
  registrations: readonly NativeTranscriptProjectionAsset[],
): NativeTranscriptPresentationMedia | null {
  const source = plainRecord(exchange.media)
  const fallbackKind = exchange.generationMode === 'image' || exchange.generationMode === 'video'
    ? exchange.generationMode
    : undefined
  if (!source && !fallbackKind) return null
  const rawKind = source?.kind
  const kind: NativeTranscriptMediaKind = rawKind === 'image' || rawKind === 'video'
    ? rawKind
    : source ? 'unsupported' : fallbackKind ?? 'unsupported'
  const allResults = Array.isArray(source?.results) ? source.results : []
  const results = allResults.slice(0, MAX_MEDIA_RESULTS)
  return {
    exchangeId: boundedText(exchange.id, 512),
    kind,
    omittedResultCount: Math.max(0, allResults.length - results.length),
    results: results.map((value) => {
      const result = plainRecord(value)
      const rawType = result?.type
      const type: NativeTranscriptMediaKind = rawType === 'image' || rawType === 'video' ? rawType : 'unsupported'
      const rawStatus = result?.status
      const status: NativeTranscriptMediaStatus = rawStatus === 'generating' || rawStatus === 'failed' || rawStatus === 'completed'
        ? rawStatus
        : 'unavailable'
      const outputId = safeScopeId(result?.outputId)
      const asset = status === 'completed' && outputId
        ? registrations.find((item) => item.exchangeId === exchange.id && item.resourceKind === 'output' && item.resourceId === outputId)
        : undefined
      const previewDataUrl = asset?.previewable === true && type === 'image' ? safePreviewDataUrl(asset.previewDataUrl) : undefined
      const modelUsed = result?.modelUsed
      return {
        type,
        status,
        ...(asset?.handle ? { assetHandle: asset.handle } : {}),
        ...(typeof modelUsed === 'string' ? { modelUsed: boundedText(modelUsed, 256) } : {}),
        ...(previewDataUrl ? { previewDataUrl } : {}),
      }
    }),
  }
}

function projectResponse(
  exchangeId: string,
  response: ChatTranscriptResponseView,
  registrations: readonly NativeTranscriptProjectionAsset[],
  allowDraft: boolean,
): ChatTranscriptResponseView {
  const sourceCitations = projectSourceCitations(response.sourceCitations, exchangeId, registrations)
  const blocks = Array.isArray(response.blocks) ? response.blocks.slice(0, 500) : []
  const sources = Array.isArray(response.sources) ? response.sources.slice(0, 200) : []
  return {
    id: boundedText(response.id, 512), modelId: boundedText(response.modelId, 256),
    blocks: blocks.map((block) => projectBlock(block, exchangeId, registrations, allowDraft)).filter((block): block is AssistantVisualBlock => Boolean(block)),
    sources: sources.flatMap((source) => {
      const safe = plainRecord(source)
      if (!safe || (safe.sourceKind !== 'url' && safe.sourceKind !== 'document')) return []
      const url = safePublicUrl(safe.url)
      const asset = registrations.find((item) => item.exchangeId === exchangeId && item.resourceId === safe.sourceId)
      const originIndex = boundedInteger(safe.originIndex, 0, 1_000_000) ?? 0
      return [{
        id: boundedText(safe.id, 512), sourceKind: safe.sourceKind,
        sourceId: asset?.handle ?? '', originIndex,
        ...(url ? { url } : {}), ...(safe.title ? { title: boundedText(safe.title, 512) } : {}),
        ...(safe.mediaType ? { mediaType: boundedText(safe.mediaType, 128) } : {}),
        ...(safe.filename ? { filename: boundedText(safe.filename, 256) } : {}),
      }]
    }),
    ...(sourceCitations ? { sourceCitations } : {}),
    ...(response.routedModelId ? { routedModelId: boundedText(response.routedModelId, 256) } : {}),
    status: safeChatStatus(response.status), errorMessage: safeChatStatus(response.status) === 'error' ? 'Response unavailable' : null,
  }
}

function hasKnownAssetResource(exchange: ChatTranscriptExchangeView, asset: NativeTranscriptProjectionAsset): boolean {
  if (asset.resourceKind === 'output') {
    const media = plainRecord(exchange.media)
    const results = Array.isArray(media?.results) ? media.results.slice(0, MAX_MEDIA_RESULTS) : []
    return results.some((value) => {
      const result = plainRecord(value)
      return result?.outputId === asset.resourceId && result.status === 'completed' &&
        (result.type === 'image' || result.type === 'video')
    })
  }
  const attachments = Array.isArray(exchange.user?.indexedAttachments) ? exchange.user.indexedAttachments.slice(0, 100) : []
  if (attachments.some((attachment) => Array.isArray(attachment.fileIds) && attachment.fileIds.includes(asset.resourceId))) return true
  const mentions = Array.isArray(exchange.user?.mentions) ? exchange.user.mentions.slice(0, 100) : []
  if (mentions.some((mention) => Array.isArray(mention.fileIds) && mention.fileIds.includes(asset.resourceId))) return true
  const responses = Array.isArray(exchange.responses) ? exchange.responses.slice(0, 100) : []
  return responses.some((response) => {
    const sources: ChatTranscriptSourceView[] = Array.isArray(response?.sources) ? response.sources.slice(0, 200) : []
    const blocks: AssistantVisualBlock[] = Array.isArray(response?.blocks) ? response.blocks.slice(0, 500) : []
    const hasFileCitation = getNativeTranscriptCitationEntries(response?.sourceCitations)
      .some(({ citation }) => citation.kind === 'file' && citation.sourceId === asset.resourceId)
    return sources.some((source) => plainRecord(source)?.sourceKind === 'document' && plainRecord(source)?.sourceId === asset.resourceId) ||
      blocks.some((block) => plainRecord(block)?.kind === 'source' && plainRecord(block)?.sourceKind === 'document' && plainRecord(block)?.sourceId === asset.resourceId) || Boolean(hasFileCitation)
  })
}

function hasMatchingImageOutput(exchange: ChatTranscriptExchangeView, resourceId: string): boolean {
  const media = plainRecord(exchange.media)
  if (media?.kind !== 'image' || !Array.isArray(media.results)) return false
  return media.results.slice(0, MAX_MEDIA_RESULTS).some((value) => {
    const result = plainRecord(value)
    return result?.type === 'image' && result.status === 'completed' && result.outputId === resourceId
  })
}

export function createNativeTranscriptDomSnapshot(input: NativeTranscriptProjectionInput): NativeTranscriptDomSnapshot {
  const sourceExchanges: ChatTranscriptExchangeView[] = Array.isArray(input.view?.exchanges) ? input.view.exchanges.slice(0, 5_000) : []
  const assetsInput: NativeTranscriptProjectionAsset[] = Array.isArray(input.assets) ? input.assets.slice(0, 2_000) : []
  const exchangeById = new Map(sourceExchanges.map((exchange) => [exchange.id, exchange]))
  const registrations = assetsInput.filter((asset, index, all) => {
    if (!asset || typeof asset !== 'object') return false
    return typeof asset.handle === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(asset.handle) &&
      safeScopeId(asset.resourceId) !== '' && ['file', 'output'].includes(asset.resourceKind) &&
      (asset.resourceKind === 'output' || asset.previewable === true) &&
      Boolean(exchangeById.get(asset.exchangeId) && hasKnownAssetResource(exchangeById.get(asset.exchangeId)!, asset)) &&
      all.findIndex((item) => Boolean(item && item.handle === asset.handle)) === index
  })
  const focusNonce = safeScopeId(input.focusNonce)
  const publicModelLabels = Array.isArray(input.publicModelLabels) ? input.publicModelLabels.slice(0, 64).flatMap((value) => {
    const label = plainRecord(value)
    const id = label?.id
    const name = label?.name
    if (Object.keys(label ?? {}).some((key) => key !== 'id' && key !== 'name') || typeof id !== 'string' ||
      !/^[A-Za-z0-9._:/-]{1,128}$/.test(id) || id.includes('..') || typeof name !== 'string') return []
    const safeName = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 96)
    return safeName ? [{ id, name: safeName }] : []
  }) : []
  const supportedActions = focusNonce && Array.isArray(input.supportedActions)
    ? [...new Set(input.supportedActions.slice(0, 36).filter((action): action is NativeTranscriptActionKind => typeof action === 'string' && NATIVE_ACTIONS.has(action as NativeTranscriptActionKind)))]
    : []
  const assets: NativeTranscriptPresentationAsset[] = registrations.filter((asset) => asset.previewable === true).map((asset) => {
    const exchange = exchangeById.get(asset.exchangeId)
    const attachments = Array.isArray(exchange?.user?.indexedAttachments) ? exchange.user.indexedAttachments : []
    const name = safeDisplayName(asset.label ?? attachments
      .find((attachment) => Array.isArray(attachment.fileIds) && attachment.fileIds.includes(asset.resourceId))?.name, asset.resourceKind === 'output' ? 'Generated media' : 'Attached file')
    const outputExchange = asset.resourceKind === 'output' ? exchangeById.get(asset.exchangeId) : undefined
    const previewDataUrl = asset.previewable === true && (asset.resourceKind === 'file' || (outputExchange && hasMatchingImageOutput(outputExchange, asset.resourceId)))
      ? safePreviewDataUrl(asset.previewDataUrl)
      : undefined
    return { handle: asset.handle, exchangeId: boundedText(asset.exchangeId, 512), label: name, resourceKind: asset.resourceKind, ...(previewDataUrl ? { previewDataUrl } : {}) }
  })
  const unavailablePreviews: NativeTranscriptUnavailablePreview[] = sourceExchanges.flatMap((exchange) => {
    const images = Array.isArray(exchange.user?.images) ? exchange.user.images : []
    const responses = Array.isArray(exchange.responses) ? exchange.responses : []
    return [
      ...images.flatMap((image) => {
        const safe = plainRecord(image)
        return safe ? [{ exchangeId: boundedText(exchange.id, 512), label: `${safeDisplayName(safe.name, 'Image')} preview unavailable in transcript` }] : []
      }),
      ...responses.flatMap((response) => {
        const blocks: AssistantVisualBlock[] = Array.isArray(response?.blocks) ? response.blocks : []
        return blocks.filter((block) => plainRecord(block)?.kind === 'file').map(() => ({ exchangeId: boundedText(exchange.id, 512), label: 'File preview unavailable in transcript' }))
      }),
    ]
  }).slice(0, 5_000)
  const view: ChatTranscriptView = {
    version: 1,
    exchanges: sourceExchanges.map((exchange, index) => projectExchange(exchange, registrations, supportedActions.includes('open-draft'), index)),
  }
  const media = sourceExchanges.flatMap((exchange) => {
    const projection = projectMedia(exchange, registrations)
    return projection ? [projection] : []
  })
  const requestedDeliveryEpoch = input.deliveryEpoch
  const deliveryEpoch = typeof requestedDeliveryEpoch === 'number' && Number.isSafeInteger(requestedDeliveryEpoch) && requestedDeliveryEpoch >= 0
    ? Math.min(requestedDeliveryEpoch, MAX_NATIVE_TRANSCRIPT_DELIVERY_EPOCH)
    : 0
  let scrollIntent: NativeTranscriptScrollIntent | null = null
  const requestedIntent = input.scrollIntent
  if (requestedIntent && typeof requestedIntent.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(requestedIntent.id)) {
    if (requestedIntent.kind === 'restore') {
      scrollIntent = { id: requestedIntent.id, kind: 'restore', scrollTop: Number.isFinite(requestedIntent.scrollTop) ? Math.max(0, requestedIntent.scrollTop) : 0 }
    } else if (requestedIntent.kind === 'reply') {
      const exchangeId = typeof requestedIntent.exchangeId === 'string' && view.exchanges.some((exchange) => exchange.id === requestedIntent.exchangeId)
        ? requestedIntent.exchangeId : ''
      scrollIntent = { id: requestedIntent.id, kind: 'reply', exchangeId }
    } else if (requestedIntent.kind === 'initial-end' || requestedIntent.kind === 'submission') {
      scrollIntent = { id: requestedIntent.id, kind: requestedIntent.kind }
    }
  }
  return {
    version: 1, deliveryEpoch, workspaceId: input.workspaceId === null ? null : safeScopeId(input.workspaceId), conversationId: safeScopeId(input.conversationId),
    mountNonce: safeScopeId(input.mountNonce), focusNonce, theme: input.theme === 'dark' ? 'dark' : 'light', view, supportedActions,
    publicModelLabels, query: boundedText(input.query, 512), scrollIntent,
    assets, media, unavailablePreviews,
  }
}
