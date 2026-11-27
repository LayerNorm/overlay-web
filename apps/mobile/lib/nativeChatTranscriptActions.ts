import type {
  ChatTranscriptExchangeView,
  ChatTranscriptResponseView,
  ChatTranscriptView,
  DraftModalState,
} from '@overlay/chat-core'
import { getDraftFromToolBlock } from '@overlay/chat-core'
import { validateNativeMarkdownLink } from './sharedMarkdownBridge'
import { MAX_AUTOMATION_GRAPH_SOURCE_LENGTH } from './nativeTranscriptLimits'
import {
  getNativeTranscriptCitationEntries,
  isNativeTranscriptCitationKey,
  isNativeTranscriptResourceId as validResourceId,
  type NativeTranscriptCitation,
} from './nativeTranscriptCitations'

export const MAX_TRANSCRIPT_TEXT_LENGTH = 1_000_000
export const MAX_TRANSCRIPT_FILENAME_LENGTH = 160

export type NativeTranscriptActionKind =
  | 'copy'
  | 'download-text'
  | 'open-link'
  | 'reply'
  | 'jump-to-reply'
  | 'open-asset'
  | 'open-source'
  | 'open-citation'
  | 'open-draft'
  | 'keyboard-dismiss'

interface ScopeRequest {
  workspaceId: string | null
  conversationId: string
  mountNonce: string
  focusNonce: string
}

interface ExchangeRequest extends ScopeRequest {
  exchangeId: string
}

export type NativeTranscriptActionTarget =
  | { kind: 'user'; userId: string }
  | { kind: 'response'; responseId: string }
  | { kind: 'media'; outputId: string }

export type NativeTranscriptActionRequestTarget =
  | Extract<NativeTranscriptActionTarget, { kind: 'user' | 'response' }>
  | { kind: 'media'; assetHandle: string }

type UserOrResponseTarget = Extract<NativeTranscriptActionTarget, { kind: 'user' | 'response' }>
type UserTarget = Extract<NativeTranscriptActionTarget, { kind: 'user' }>
type ResponseTarget = Extract<NativeTranscriptActionTarget, { kind: 'response' }>
type NativeTranscriptMediaResult = NonNullable<ChatTranscriptExchangeView['media']>['results'][number]
export type NativeTranscriptActionRequest =
  | (ExchangeRequest & { kind: 'copy'; target: UserOrResponseTarget; text: string })
  | (ExchangeRequest & { kind: 'download-text'; target: ResponseTarget; filename: string; text: string })
  | (ExchangeRequest & { kind: 'open-link'; target: UserOrResponseTarget; url: string })
  | (ExchangeRequest & { kind: 'reply'; target: NativeTranscriptActionRequestTarget })
  | (ExchangeRequest & { kind: 'jump-to-reply'; target: UserTarget })
  | (ExchangeRequest & { kind: 'open-asset'; assetHandle: string })
  | (ExchangeRequest & { kind: 'open-source'; target: ResponseTarget; sourceId: string })
  | (ExchangeRequest & { kind: 'open-citation'; target: ResponseTarget; citationKey: string })
  | (ExchangeRequest & { kind: 'open-draft'; target: ResponseTarget; toolKey: string })
  | (ScopeRequest & { kind: 'keyboard-dismiss'; intent: 'user-drag' })

export interface NativeTranscriptAsset {
  handle: string
  exchangeId: string
  resourceId: string
  resourceKind: 'file' | 'output'
  previewable: boolean
}

export interface NativeTranscriptCommittedContext {
  workspaceId: string | null
  conversationId: string
  mountNonce: string
  focusNonce: string
  focused: boolean
  mounted: boolean
  allowedActions: readonly NativeTranscriptActionKind[]
  view: ChatTranscriptView
  assets: readonly NativeTranscriptAsset[]
}

export type NativeTranscriptError =
  | 'invalid-request'
  | 'invalid-payload'
  | 'stale-scope'
  | 'unfocused'
  | 'unsupported'
  | 'unknown-target'
  | 'canceled'
  | 'action-pending'
  | 'action-failed'

export type NativeTranscriptActionResult =
  | { ok: true }
  | { ok: false; error: NativeTranscriptError }

export interface NativeTranscriptTrustedReplyTarget {
  exchange: ChatTranscriptExchangeView
  target: NativeTranscriptActionTarget
  user: ChatTranscriptExchangeView['user']
  response: ChatTranscriptResponseView | null
  mediaResult: NativeTranscriptMediaResult | null
}

export interface NativeTranscriptScope {
  workspaceId: string | null
  conversationId: string
  mountNonce: string
  focusNonce: string
  isCurrent: () => boolean
}

export interface NativeTranscriptActionHandlers {
  copyText?: (text: string, scope: NativeTranscriptScope) => Promise<void>
  downloadText?: (filename: string, text: string, scope: NativeTranscriptScope) => Promise<void>
  openLink?: (url: string, scope: NativeTranscriptScope) => Promise<void>
  reply?: (target: NativeTranscriptTrustedReplyTarget, scope: NativeTranscriptScope) => void | Promise<void>
  jumpToReply?: (parentExchangeId: string, scope: NativeTranscriptScope) => void | Promise<void>
  openAsset?: (asset: NativeTranscriptAsset, scope: NativeTranscriptScope) => void | Promise<void>
  openSource?: (source: ChatTranscriptResponseView['sources'][number], scope: NativeTranscriptScope) => void | Promise<void>
  openCitation?: (citation: NativeTranscriptCitation, scope: NativeTranscriptScope) => void | Promise<void>
  openDraft?: (draft: DraftModalState, scope: NativeTranscriptScope, draftToken: string) => void | Promise<void>
  saveDraft?: (draft: DraftModalState, scope: NativeTranscriptScope) => void | Promise<void>
  dismissKeyboard?: (scope: NativeTranscriptScope) => void | Promise<void>
}

export interface NativeTranscriptActionControllerOptions {
  getContext: () => NativeTranscriptCommittedContext | null
  handlers: NativeTranscriptActionHandlers
  confirmActions?: readonly NativeTranscriptActionKind[]
  confirm?: (request: NativeTranscriptActionRequest) => Promise<boolean>
  createDraftToken: () => string
}

type NativeTranscriptScopeIdentity = Pick<NativeTranscriptScope, 'workspaceId' | 'conversationId' | 'mountNonce' | 'focusNonce'>

function scopeIdentity(context: NativeTranscriptCommittedContext): NativeTranscriptScopeIdentity {
  return {
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
    mountNonce: context.mountNonce,
    focusNonce: context.focusNonce,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || Object.getPrototypeOf(prototype) === null
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function validDisplayTargetId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
}

function validAssetHandle(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(value)
}

function validCitationKey(value: unknown): value is string {
  return isNativeTranscriptCitationKey(value)
}

function isResponseTarget(value: unknown): value is ResponseTarget {
  return isRecord(value) && value.kind === 'response' && hasExactKeys(value, ['kind', 'responseId']) &&
    validDisplayTargetId(value.responseId)
}

function isUserOrResponseTarget(value: unknown): value is UserOrResponseTarget {
  if (!isRecord(value)) return false
  if (value.kind === 'user') return isUserTarget(value)
  return isResponseTarget(value)
}

function isUserTarget(value: unknown): value is UserTarget {
  return isRecord(value) && value.kind === 'user' && hasExactKeys(value, ['kind', 'userId']) && validDisplayTargetId(value.userId)
}

function isActionRequestTarget(value: unknown): value is NativeTranscriptActionRequestTarget {
  if (!isRecord(value)) return false
  if (value.kind === 'media') return hasExactKeys(value, ['kind', 'assetHandle']) && validAssetHandle(value.assetHandle)
  return isUserOrResponseTarget(value)
}

function validDraftState(value: unknown): value is DraftModalState {
  if (!isRecord(value) || !['skill', 'automation'].includes(String(value.kind)) || !isRecord(value.draft)) return false
  const draft = value.draft
  const common = ['name', 'description', 'instructions', 'confidence', 'detectedIntegrations', 'reason']
  const expected = value.kind === 'skill'
    ? common
    : [...common, 'missingFields', 'schedule', 'timezone', ...(Object.hasOwn(draft, 'graphSource') ? ['graphSource'] : [])]
  if (!hasExactKeys(draft, expected) || !hasExactKeys(value, ['kind', 'draft'])) return false
  if (
    !['name', 'description', 'instructions', 'reason'].every((key) =>
      typeof draft[key] === 'string' && (draft[key] as string).length <= 20_000,
    ) ||
    !['low', 'medium', 'high'].includes(String(draft.confidence)) ||
    !Array.isArray(draft.detectedIntegrations) ||
    draft.detectedIntegrations.length > 100 ||
    !draft.detectedIntegrations.every((item) => typeof item === 'string' && item.length <= 256)
  ) return false
  if (value.kind === 'skill') return true
  if (
    !Array.isArray(draft.missingFields) || draft.missingFields.length > 100 ||
    !draft.missingFields.every((item) => typeof item === 'string' && item.length <= 512) ||
    typeof draft.timezone !== 'string' || draft.timezone.length > 128 ||
    (draft.graphSource !== undefined && (typeof draft.graphSource !== 'string' || draft.graphSource.length > MAX_AUTOMATION_GRAPH_SOURCE_LENGTH)) ||
    !isRecord(draft.schedule)
  ) return false
  const schedule = draft.schedule
  switch (schedule.kind) {
    case 'interval': return hasExactKeys(schedule, ['kind', 'intervalMinutes']) && Number.isInteger(schedule.intervalMinutes) && Number(schedule.intervalMinutes) >= 1 && Number(schedule.intervalMinutes) <= 525_600
    case 'daily': return hasExactKeys(schedule, ['kind', 'hourUTC', 'minuteUTC']) && Number.isInteger(schedule.hourUTC) && Number(schedule.hourUTC) >= 0 && Number(schedule.hourUTC) <= 23 && Number.isInteger(schedule.minuteUTC) && Number(schedule.minuteUTC) >= 0 && Number(schedule.minuteUTC) <= 59
    case 'weekly': return hasExactKeys(schedule, ['kind', 'dayOfWeekUTC', 'hourUTC', 'minuteUTC']) && Number.isInteger(schedule.dayOfWeekUTC) && Number(schedule.dayOfWeekUTC) >= 0 && Number(schedule.dayOfWeekUTC) <= 6 && Number.isInteger(schedule.hourUTC) && Number(schedule.hourUTC) >= 0 && Number(schedule.hourUTC) <= 23 && Number.isInteger(schedule.minuteUTC) && Number(schedule.minuteUTC) >= 0 && Number(schedule.minuteUTC) <= 59
    case 'monthly': return hasExactKeys(schedule, ['kind', 'dayOfMonthUTC', 'hourUTC', 'minuteUTC']) && Number.isInteger(schedule.dayOfMonthUTC) && Number(schedule.dayOfMonthUTC) >= 1 && Number(schedule.dayOfMonthUTC) <= 31 && Number.isInteger(schedule.hourUTC) && Number(schedule.hourUTC) >= 0 && Number(schedule.hourUTC) <= 23 && Number.isInteger(schedule.minuteUTC) && Number(schedule.minuteUTC) >= 0 && Number(schedule.minuteUTC) <= 59
    default: return false
  }
}

function draftFromToolTarget(target: NativeTranscriptResolvedTarget, toolKey: string): DraftModalState | null {
  const tool = target.response?.blocks.find((block) => block.kind === 'tool' && block.key === toolKey)
  if (!tool || tool.kind !== 'tool') return null
  const draft = getDraftFromToolBlock(tool)
  return draft && validDraftState(draft) ? draft : null
}

function validFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TRANSCRIPT_FILENAME_LENGTH &&
    value.trim() === value && !value.startsWith('.') && !value.includes('..') &&
    !/[\\/\u0000-\u001f\u007f]/.test(value) && /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(value)
}

function requestKeys(kind: string): readonly string[] | null {
  const scope = ['kind', 'workspaceId', 'conversationId', 'mountNonce', 'focusNonce']
  const exchange = [...scope, 'exchangeId']
  switch (kind) {
    case 'keyboard-dismiss': return [...scope, 'intent']
    case 'copy': return [...exchange, 'target', 'text']
    case 'download-text': return [...exchange, 'target', 'filename', 'text']
    case 'open-link': return [...exchange, 'target', 'url']
    case 'reply': return [...exchange, 'target']
    case 'jump-to-reply': return [...exchange, 'target']
    case 'open-asset': return [...exchange, 'assetHandle']
    case 'open-source': return [...exchange, 'target', 'sourceId']
    case 'open-citation': return [...exchange, 'target', 'citationKey']
    case 'open-draft': return [...exchange, 'target', 'toolKey']
    default: return null
  }
}

interface NativeTranscriptResolvedTarget {
  exchange: ChatTranscriptExchangeView
  target: NativeTranscriptActionTarget
  user: ChatTranscriptExchangeView['user']
  response: ChatTranscriptResponseView | null
  mediaResult: NativeTranscriptMediaResult | null
}

interface NativeTranscriptValidation {
  request: NativeTranscriptActionRequest
  context: NativeTranscriptCommittedContext
  target: NativeTranscriptResolvedTarget | null
  asset?: NativeTranscriptAsset
  source?: ChatTranscriptResponseView['sources'][number]
  draft?: DraftModalState
  citation?: NativeTranscriptCitation
  replyParentExchangeId?: string
  replyParentFingerprint?: string
}

function findTarget(
  context: NativeTranscriptCommittedContext,
  exchangeId: string,
  target: NativeTranscriptActionRequestTarget,
): NativeTranscriptResolvedTarget | null {
  const exchange = context.view.exchanges.find((item) => item.id === exchangeId)
  if (!exchange) return null
  if (target.kind === 'user') {
    return exchange.user.id === target.userId
      ? { exchange, target, user: exchange.user, response: null, mediaResult: null }
      : null
  }
  if (target.kind === 'response') {
    const response = exchange.responses.find((item) => item.id === target.responseId)
    return response ? { exchange, target, user: exchange.user, response, mediaResult: null } : null
  }
  const asset = context.assets.find((item) => item.handle === target.assetHandle && item.exchangeId === exchangeId && item.resourceKind === 'output')
  const mediaResult = asset && exchange.media?.results.find((item) => item.outputId === asset.resourceId && item.status === 'completed')
  return mediaResult
    ? { exchange, target: { kind: 'media', outputId: asset!.resourceId }, user: exchange.user, response: null, mediaResult }
    : null
}

function validateRequestShape(value: unknown): value is NativeTranscriptActionRequest {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  const keys = requestKeys(value.kind)
  if (!keys || !hasExactKeys(value, keys)) return false
  if (
    !(value.workspaceId === null || validResourceId(value.workspaceId)) ||
    !validResourceId(value.conversationId) || !validResourceId(value.mountNonce) || !validResourceId(value.focusNonce)
  ) return false
  if (value.kind === 'keyboard-dismiss') return value.intent === 'user-drag'
  if (!validDisplayTargetId(value.exchangeId)) return false
  switch (value.kind) {
    case 'copy': return isUserOrResponseTarget(value.target) && typeof value.text === 'string' && value.text.length > 0 && value.text.length <= MAX_TRANSCRIPT_TEXT_LENGTH
    case 'download-text': return isResponseTarget(value.target) && validFilename(value.filename) && typeof value.text === 'string' && value.text.length > 0 && value.text.length <= MAX_TRANSCRIPT_TEXT_LENGTH
    case 'open-link': return isUserOrResponseTarget(value.target) && validateNativeMarkdownLink(value.url) !== null
    case 'reply': return isActionRequestTarget(value.target)
    case 'jump-to-reply': return isUserTarget(value.target)
    case 'open-asset': return validAssetHandle(value.assetHandle)
    case 'open-source': return isResponseTarget(value.target) && validDisplayTargetId(value.sourceId)
    case 'open-citation': return isResponseTarget(value.target) && validCitationKey(value.citationKey)
    case 'open-draft': return isResponseTarget(value.target) && validDisplayTargetId(value.toolKey)
    default: return false
  }
}

function scopeMatches(context: NativeTranscriptCommittedContext, request: NativeTranscriptActionRequest): boolean {
  return context.mounted && context.workspaceId === request.workspaceId &&
    context.conversationId === request.conversationId && context.mountNonce === request.mountNonce && context.focusNonce === request.focusNonce
}

function contextScope(
  context: NativeTranscriptCommittedContext,
  getCurrent: () => NativeTranscriptCommittedContext | null,
  isStillValid: () => boolean = () => true,
  requiredAction?: NativeTranscriptActionKind,
): NativeTranscriptScope {
  const scope = {
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
    mountNonce: context.mountNonce,
    focusNonce: context.focusNonce,
  }
  return {
    ...scope,
    isCurrent: () => {
      if (!isStillValid()) return false
      try {
        const current = getCurrent()
        return Boolean(current?.mounted && current.focused && current.workspaceId === scope.workspaceId &&
          current.conversationId === scope.conversationId && current.mountNonce === scope.mountNonce && current.focusNonce === scope.focusNonce &&
          (!requiredAction || current.allowedActions.includes(requiredAction)))
      } catch {
        return false
      }
    },
  }
}

function validationFingerprint(validation: NativeTranscriptValidation, request: NativeTranscriptActionRequest): string {
  const target = validation.target
  const requestTarget = 'target' in request ? request.target : null
  return stableSerialize({
    target: target ? {
      exchangeId: target.exchange.id,
      turnId: target.exchange.turnId,
      userId: target.user.id,
      responseId: requestTarget?.kind === 'response' ? target.response?.id ?? null : null,
    } : null,
    media: requestTarget?.kind === 'media' && target?.mediaResult ? {
      outputId: target.mediaResult.outputId,
      type: target.mediaResult.type,
    } : null,
    asset: validation.asset ? {
      handle: validation.asset.handle,
      exchangeId: validation.asset.exchangeId,
      resourceId: validation.asset.resourceId,
      resourceKind: validation.asset.resourceKind,
      previewable: validation.asset.previewable === true,
    } : null,
    source: validation.source ? {
      id: validation.source.id,
      sourceKind: validation.source.sourceKind,
      sourceId: validation.source.sourceId,
      url: validation.source.url,
      title: validation.source.title,
      filename: validation.source.filename,
      mediaType: validation.source.mediaType,
      originIndex: validation.source.originIndex,
    } : null,
    citation: validation.citation ?? null,
    draft: validation.draft ?? null,
    replyParentExchangeId: validation.replyParentExchangeId ?? null,
    replyParentFingerprint: validation.replyParentFingerprint ?? null,
  })
}

function handlerAvailable(handlers: NativeTranscriptActionHandlers, kind: NativeTranscriptActionKind): boolean {
  switch (kind) {
    case 'copy': return typeof handlers.copyText === 'function'
    case 'download-text': return typeof handlers.downloadText === 'function'
    case 'open-link': return typeof handlers.openLink === 'function'
    case 'reply': return typeof handlers.reply === 'function'
    case 'jump-to-reply': return typeof handlers.jumpToReply === 'function'
    case 'open-asset': return typeof handlers.openAsset === 'function'
    case 'open-source': return typeof handlers.openSource === 'function'
    case 'open-citation': return typeof handlers.openCitation === 'function'
    case 'open-draft': return typeof handlers.openDraft === 'function' && typeof handlers.saveDraft === 'function'
    case 'keyboard-dismiss': return typeof handlers.dismissKeyboard === 'function'
  }
}

function safeError(error: NativeTranscriptError): NativeTranscriptActionResult {
  return { ok: false, error }
}

export function createNativeTranscriptActionController(options: NativeTranscriptActionControllerOptions) {
  const pending = new Map<string, Promise<NativeTranscriptActionResult>>()
  const draftTokens = new Map<string, NativeTranscriptScopeIdentity & {
    exchangeId: string
    responseId: string
    toolKey: string
    draftKind: DraftModalState['kind']
    sourceFingerprint: string
  }>()
  const pendingDraftSaves = new Map<string, { key: string; promise: Promise<NativeTranscriptActionResult> }>()
  let invalidated = false

  function validate(value: unknown): NativeTranscriptValidation | NativeTranscriptActionResult {
    if (!validateRequestShape(value)) return safeError('invalid-request')
    if (invalidated) return safeError('stale-scope')
    let context: NativeTranscriptCommittedContext | null
    try {
      context = options.getContext()
    } catch {
      return safeError('action-failed')
    }
    if (!context || !scopeMatches(context, value)) return safeError('stale-scope')
    if (!context.focused) return safeError('unfocused')
    if (!context.allowedActions.includes(value.kind) || !handlerAvailable(options.handlers, value.kind)) return safeError('unsupported')
    if (value.kind === 'keyboard-dismiss') return { request: value, context, target: null }
    if (value.kind === 'open-asset') {
      const exchange = context.view.exchanges.find((item) => item.id === value.exchangeId)
      const asset = context.assets.find((item) => item.handle === value.assetHandle && item.exchangeId === value.exchangeId &&
        validAssetHandle(item.handle) && validResourceId(item.resourceId) && ['file', 'output'].includes(item.resourceKind) && item.previewable === true)
      if (!exchange || !asset) return safeError('unknown-target')
      return { request: value, context, target: null, asset }
    }
    const target = findTarget(context, value.exchangeId, value.target)
    if (!target) return safeError('unknown-target')
    if (value.kind === 'jump-to-reply') {
      const replyToTurnId = target.user.replyThread?.replyToTurnId
      const parentExchanges = typeof replyToTurnId === 'string' && validDisplayTargetId(replyToTurnId)
        ? context.view.exchanges.filter((exchange) => exchange.id !== target.exchange.id && exchange.turnId === replyToTurnId)
        : []
      const parent = parentExchanges.length === 1 ? parentExchanges[0] : null
      if (!parent || !validDisplayTargetId(parent.id)) return safeError('unknown-target')
      return {
        request: value,
        context,
        target,
        replyParentExchangeId: parent.id,
        replyParentFingerprint: stableSerialize({
          id: parent.id,
          turnId: parent.turnId,
          userId: parent.user.id,
          replyToTurnId,
        }),
      }
    }
    if (value.kind === 'open-source') {
      const source = target.response?.sources.find((item) => item.id === value.sourceId &&
        (item.sourceKind === 'url' ? Boolean(validateNativeMarkdownLink(item.url)) : validResourceId(item.sourceId)))
      if (!source) return safeError('unknown-target')
      return { request: value, context, target, source }
    }
    if (value.kind === 'open-citation') {
      const citation = getNativeTranscriptCitationEntries(target.response?.sourceCitations)
        .find((entry) => entry.key === value.citationKey)?.citation ?? null
      if (!citation) return safeError('unknown-target')
      return { request: value, context, target, citation }
    }
    if (value.kind === 'open-draft') {
      const draft = draftFromToolTarget(target, value.toolKey)
      if (!draft) return safeError('unknown-target')
      return { request: value, context, target, draft }
    }
    return { request: value, context, target }
  }

  async function dispatch(value: unknown): Promise<NativeTranscriptActionResult> {
    let checked: ReturnType<typeof validate>
    try {
      checked = validate(value)
    } catch {
      return safeError('invalid-request')
    }
    if ('ok' in checked) return checked
    let request: NativeTranscriptActionRequest
    try {
      request = JSON.parse(JSON.stringify(checked.request)) as NativeTranscriptActionRequest
    } catch {
      return safeError('invalid-request')
    }
    const openingDraftFingerprint = checked.draft ? stableSerialize(checked.draft) : null
    const openingCitationFingerprint = checked.citation ? stableSerialize(checked.citation) : null
    const openingReplyParentExchangeId = checked.replyParentExchangeId ?? null
    const openingValidationFingerprint = validationFingerprint(checked, request)
    const isCurrentLease = (): boolean => {
      if (invalidated) return false
      try {
        const current = validate(request)
        return !('ok' in current) && validationFingerprint(current, request) === openingValidationFingerprint
      } catch {
        return false
      }
    }
    const originScope = scopeIdentity(checked.context)
    const key = stableSerialize(request)
    const existing = pending.get(key)
    if (existing) return existing
    const operation = (async (): Promise<NativeTranscriptActionResult> => {
      try {
        if (options.confirmActions?.includes(request.kind)) {
          if (!options.confirm) return safeError('unsupported')
          if (!(await options.confirm(request))) return safeError('canceled')
          const afterConfirmation = validate(request)
          if ('ok' in afterConfirmation) return afterConfirmation
          if (request.kind === 'open-draft' && stableSerialize(afterConfirmation.draft) !== openingDraftFingerprint) return safeError('unknown-target')
          if (request.kind === 'open-citation' && stableSerialize(afterConfirmation.citation) !== openingCitationFingerprint) return safeError('unknown-target')
          if (request.kind === 'jump-to-reply' && afterConfirmation.replyParentExchangeId !== openingReplyParentExchangeId) return safeError('unknown-target')
        }
        const current = validate(request)
        if ('ok' in current) return current
        if (request.kind === 'open-draft' && stableSerialize(current.draft) !== openingDraftFingerprint) return safeError('unknown-target')
        if (request.kind === 'open-citation' && stableSerialize(current.citation) !== openingCitationFingerprint) return safeError('unknown-target')
        if (request.kind === 'jump-to-reply' && current.replyParentExchangeId !== openingReplyParentExchangeId) return safeError('unknown-target')
        if (validationFingerprint(current, request) !== openingValidationFingerprint) return safeError('unknown-target')
        switch (request.kind) {
          case 'copy': await options.handlers.copyText!(request.text, contextScope(current.context, options.getContext, isCurrentLease, 'copy')); break
          case 'download-text': await options.handlers.downloadText!(request.filename, request.text, contextScope(current.context, options.getContext, isCurrentLease, 'download-text')); break
          case 'open-link': await options.handlers.openLink!(validateNativeMarkdownLink(request.url)!, contextScope(current.context, options.getContext, isCurrentLease, 'open-link')); break
          case 'reply': await options.handlers.reply!(current.target!, contextScope(current.context, options.getContext, isCurrentLease, 'reply')); break
          case 'jump-to-reply': await options.handlers.jumpToReply!(current.replyParentExchangeId!, contextScope(current.context, options.getContext, isCurrentLease, 'jump-to-reply')); break
          case 'open-asset': {
            const asset = current.asset
            if (!asset) return safeError('unknown-target')
            await options.handlers.openAsset!(asset, contextScope(current.context, options.getContext, isCurrentLease, 'open-asset'))
            break
          }
          case 'open-source': {
            const source = current.source
            if (!source || (source.sourceKind === 'url' && !validateNativeMarkdownLink(source.url))) return safeError('unknown-target')
            await options.handlers.openSource!(source, contextScope(current.context, options.getContext, isCurrentLease, 'open-source'))
            break
          }
          case 'open-citation': await options.handlers.openCitation!(current.citation!, contextScope(current.context, options.getContext, isCurrentLease, 'open-citation')); break
          case 'open-draft': {
            const token = options.createDraftToken()
            if (!validResourceId(token) || draftTokens.has(token)) return safeError('action-failed')
            draftTokens.set(token, {
              ...originScope,
              exchangeId: request.exchangeId,
              responseId: request.target.responseId,
              toolKey: request.toolKey,
              draftKind: current.draft!.kind,
              sourceFingerprint: stableSerialize(current.draft),
            })
            try {
              await options.handlers.openDraft!(current.draft!, contextScope(current.context, options.getContext, () => draftTokens.has(token) && isCurrentLease(), 'open-draft'), token)
            } catch (error) {
              draftTokens.delete(token)
              throw error
            }
            const afterOpen = validate(request)
            if ('ok' in afterOpen || stableSerialize(afterOpen.draft) !== openingDraftFingerprint) {
              draftTokens.delete(token)
              return 'ok' in afterOpen ? afterOpen : safeError('unknown-target')
            }
            return { ok: true }
          }
          case 'keyboard-dismiss': await options.handlers.dismissKeyboard!(contextScope(current.context, options.getContext, () => !invalidated, 'keyboard-dismiss')); break
        }
        const afterAction = validate(request)
        if ('ok' in afterAction) return afterAction
        if (validationFingerprint(afterAction, request) !== openingValidationFingerprint) return safeError('unknown-target')
        if (request.kind === 'open-citation' && stableSerialize(afterAction.citation) !== openingCitationFingerprint) return safeError('unknown-target')
        if (request.kind === 'jump-to-reply' && afterAction.replyParentExchangeId !== openingReplyParentExchangeId) return safeError('unknown-target')
        return { ok: true }
      } catch {
        return safeError('action-failed')
      }
    })()
    pending.set(key, operation)
    try {
      return await operation
    } finally {
      pending.delete(key)
    }
  }

  async function saveDraft(draftToken: unknown, draft: unknown): Promise<NativeTranscriptActionResult> {
    let safeDraft: DraftModalState
    try {
      if (typeof draftToken !== 'string' || !validDraftState(draft)) return safeError('invalid-payload')
      safeDraft = JSON.parse(JSON.stringify(draft)) as DraftModalState
      if (!validDraftState(safeDraft)) return safeError('invalid-payload')
    } catch {
      return safeError('invalid-payload')
    }
    const token = draftToken as string
    const origin = draftTokens.get(token)
    if (!origin) return safeError('stale-scope')
    const draftOrigin = origin
    if (origin.draftKind !== safeDraft.kind) return safeError('invalid-payload')
    const saveKey = stableSerialize(safeDraft)
    const pendingSave = pendingDraftSaves.get(token)
    if (pendingSave) return pendingSave.key === saveKey ? pendingSave.promise : safeError('action-pending')

    function validateOrigin(context: NativeTranscriptCommittedContext | null): NativeTranscriptError | null {
      if (invalidated || draftTokens.get(token) !== draftOrigin || !context || !context.mounted || context.workspaceId !== draftOrigin.workspaceId ||
        context.conversationId !== draftOrigin.conversationId || context.mountNonce !== draftOrigin.mountNonce ||
        context.focusNonce !== draftOrigin.focusNonce) return 'stale-scope'
      if (!context.focused) return 'unfocused'
      if (!context.allowedActions.includes('open-draft') || !handlerAvailable(options.handlers, 'open-draft')) return 'unsupported'
      const exchange = context.view.exchanges.find((item) => item.id === draftOrigin.exchangeId)
      const response = exchange?.responses.find((item) => item.id === draftOrigin.responseId)
      const resolved = exchange && response
        ? { exchange, response, user: exchange.user, target: { kind: 'response' as const, responseId: response.id }, mediaResult: null }
        : null
      const currentDraft = resolved && draftFromToolTarget(resolved, draftOrigin.toolKey)
      return currentDraft && stableSerialize(currentDraft) === draftOrigin.sourceFingerprint ? null : 'unknown-target'
    }

    let context: NativeTranscriptCommittedContext | null
    try {
      context = options.getContext()
    } catch {
      return safeError('action-failed')
    }
    const beforeError = validateOrigin(context)
    if (beforeError) {
      if (beforeError !== 'unfocused') draftTokens.delete(token)
      return safeError(beforeError)
    }

    const operation = (async (): Promise<NativeTranscriptActionResult> => {
      try {
        await options.handlers.saveDraft!(safeDraft, contextScope(context!, options.getContext, () => {
          try {
            return validateOrigin(options.getContext()) === null
          } catch {
            return false
          }
        }, 'open-draft'))
      } catch {
        let afterFailure: NativeTranscriptCommittedContext | null
        try {
          afterFailure = options.getContext()
        } catch {
          return safeError('action-failed')
        }
        const failureError = validateOrigin(afterFailure)
        if (failureError && failureError !== 'unfocused') draftTokens.delete(token)
        return safeError(failureError ?? 'action-failed')
      }
      let after: NativeTranscriptCommittedContext | null
      try {
        after = options.getContext()
      } catch {
        return safeError('action-failed')
      }
      const afterError = validateOrigin(after)
      if (afterError !== 'unfocused') draftTokens.delete(token)
      return afterError ? safeError(afterError) : { ok: true }
    })()
    pendingDraftSaves.set(token, { key: saveKey, promise: operation })
    try {
      return await operation
    } finally {
      if (pendingDraftSaves.get(token)?.promise === operation) pendingDraftSaves.delete(token)
    }
  }

  function invalidate(): void {
    invalidated = true
    draftTokens.clear()
  }

  function cancelDraft(draftToken: unknown): void {
    if (typeof draftToken === 'string') draftTokens.delete(draftToken)
  }

  return { dispatch, saveDraft, cancelDraft, invalidate }
}
