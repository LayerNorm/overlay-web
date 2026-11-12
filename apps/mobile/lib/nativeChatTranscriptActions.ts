import type {
  ChatTranscriptExchangeView,
  ChatTranscriptResponseView,
  ChatTranscriptView,
  DraftModalState,
} from '@overlay/chat-core'
import { getDraftFromToolBlock } from '@overlay/chat-core'
import { validateNativeMarkdownLink } from './sharedMarkdownBridge'
import { MAX_AUTOMATION_GRAPH_SOURCE_LENGTH } from './nativeTranscriptLimits'
import { isNativeTranscriptResourceId as validResourceId, normalizeNativeTranscriptCitation, type NativeTranscriptCitation } from './nativeTranscriptCitations'

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

type UserOrResponseTarget = Extract<NativeTranscriptActionTarget, { kind: 'user' | 'response' }>
type UserTarget = Extract<NativeTranscriptActionTarget, { kind: 'user' }>
type ResponseTarget = Extract<NativeTranscriptActionTarget, { kind: 'response' }>
type NativeTranscriptMediaResult = NonNullable<ChatTranscriptExchangeView['media']>['results'][number]
export type NativeTranscriptActionRequest =
  | (ExchangeRequest & { kind: 'copy'; target: UserOrResponseTarget; text: string })
  | (ExchangeRequest & { kind: 'download-text'; target: ResponseTarget; filename: string; text: string })
  | (ExchangeRequest & { kind: 'open-link'; target: UserOrResponseTarget; url: string })
  | (ExchangeRequest & { kind: 'reply'; target: NativeTranscriptActionTarget })
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
}

export interface NativeTranscriptActionHandlers {
  copyText?: (text: string) => Promise<void>
  downloadText?: (filename: string, text: string) => Promise<void>
  openLink?: (url: string) => Promise<void>
  reply?: (target: NativeTranscriptTrustedReplyTarget, scope: NativeTranscriptScope) => void | Promise<void>
  jumpToReply?: (parentExchangeId: string, scope: NativeTranscriptScope) => void | Promise<void>
  openAsset?: (asset: NativeTranscriptAsset, scope: NativeTranscriptScope) => void | Promise<void>
  openSource?: (source: ChatTranscriptResponseView['sources'][number], scope: NativeTranscriptScope) => void | Promise<void>
  openCitation?: (citation: NativeTranscriptCitation, scope: NativeTranscriptScope) => void | Promise<void>
  openDraft?: (draft: DraftModalState, scope: NativeTranscriptScope, draftToken: string) => void | Promise<void>
  saveDraft?: (draft: DraftModalState, scope: NativeTranscriptScope) => void | Promise<void>
  dismissKeyboard?: () => void | Promise<void>
}

export interface NativeTranscriptActionControllerOptions {
  getContext: () => NativeTranscriptCommittedContext | null
  handlers: NativeTranscriptActionHandlers
  confirmActions?: readonly NativeTranscriptActionKind[]
  confirm?: (request: NativeTranscriptActionRequest) => Promise<boolean>
  createDraftToken: () => string
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
  return typeof value === 'string' && /^(?:0|[1-9][0-9]{0,5})$/.test(value)
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

function isActionTarget(value: unknown): value is NativeTranscriptActionTarget {
  if (!isRecord(value)) return false
  if (value.kind === 'media') return hasExactKeys(value, ['kind', 'outputId']) && validResourceId(value.outputId)
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
  draft?: DraftModalState
  citation?: NativeTranscriptCitation
  replyParentExchangeId?: string
}

function findTarget(
  context: NativeTranscriptCommittedContext,
  exchangeId: string,
  target: NativeTranscriptActionTarget,
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
  const mediaResult = exchange.media?.results.find((item) => item.outputId === target.outputId && item.status === 'completed')
  return mediaResult
    ? { exchange, target, user: exchange.user, response: null, mediaResult }
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
    case 'reply': return isActionTarget(value.target)
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

function contextScope(context: NativeTranscriptCommittedContext): NativeTranscriptScope {
  return {
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
    mountNonce: context.mountNonce,
    focusNonce: context.focusNonce,
  }
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
  const draftTokens = new Map<string, NativeTranscriptScope & {
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
        validAssetHandle(item.handle) && validResourceId(item.resourceId) && ['file', 'output'].includes(item.resourceKind) && item.previewable)
      if (!exchange || !asset) return safeError('unknown-target')
      return { request: value, context, target: null }
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
      return { request: value, context, target, replyParentExchangeId: parent.id }
    }
    if (value.kind === 'open-source' && !target.response?.sources.some((source) => source.id === value.sourceId &&
      (source.sourceKind === 'url' ? Boolean(validateNativeMarkdownLink(source.url)) : validResourceId(source.sourceId)))) return safeError('unknown-target')
    if (value.kind === 'open-citation') {
      const citations = target.response?.sourceCitations
      const citation = citations && Object.hasOwn(citations, value.citationKey) ? normalizeNativeTranscriptCitation(citations[value.citationKey]) : null
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
        switch (request.kind) {
          case 'copy': await options.handlers.copyText!(request.text); break
          case 'download-text': await options.handlers.downloadText!(request.filename, request.text); break
          case 'open-link': await options.handlers.openLink!(validateNativeMarkdownLink(request.url)!); break
          case 'reply': await options.handlers.reply!(current.target!, contextScope(current.context)); break
          case 'jump-to-reply': await options.handlers.jumpToReply!(current.replyParentExchangeId!, contextScope(current.context)); break
          case 'open-asset': {
            const asset = current.context.assets.find((item) => item.handle === request.assetHandle && item.exchangeId === request.exchangeId &&
              validAssetHandle(item.handle) && validResourceId(item.resourceId) && ['file', 'output'].includes(item.resourceKind) && item.previewable)
            if (!asset) return safeError('unknown-target')
            await options.handlers.openAsset!(asset, contextScope(current.context))
            break
          }
          case 'open-source': {
            const source = current.target!.response?.sources.find((item) => item.id === request.sourceId)
            if (!source || (source.sourceKind === 'url' && !validateNativeMarkdownLink(source.url))) return safeError('unknown-target')
            await options.handlers.openSource!(source, contextScope(current.context))
            break
          }
          case 'open-citation': await options.handlers.openCitation!(current.citation!, contextScope(current.context)); break
          case 'open-draft': {
            const originScope = contextScope(current.context)
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
              await options.handlers.openDraft!(current.draft!, originScope, token)
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
          case 'keyboard-dismiss': await options.handlers.dismissKeyboard!(); break
        }
        const afterAction = validate(request)
        if ('ok' in afterAction) return afterAction
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
    const origin = draftTokens.get(draftToken)
    if (!origin) return safeError('stale-scope')
    const draftOrigin = origin
    if (origin.draftKind !== safeDraft.kind) return safeError('invalid-payload')
    const saveKey = stableSerialize(safeDraft)
    const pendingSave = pendingDraftSaves.get(draftToken)
    if (pendingSave) return pendingSave.key === saveKey ? pendingSave.promise : safeError('action-pending')

    function validateOrigin(context: NativeTranscriptCommittedContext | null): NativeTranscriptError | null {
      if (invalidated || !context || !context.mounted || context.workspaceId !== draftOrigin.workspaceId ||
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
      if (beforeError !== 'unfocused') draftTokens.delete(draftToken)
      return safeError(beforeError)
    }

    const operation = (async (): Promise<NativeTranscriptActionResult> => {
      try {
        await options.handlers.saveDraft!(safeDraft, {
          workspaceId: origin.workspaceId,
          conversationId: origin.conversationId,
          mountNonce: origin.mountNonce,
          focusNonce: origin.focusNonce,
        })
      } catch {
        let afterFailure: NativeTranscriptCommittedContext | null
        try {
          afterFailure = options.getContext()
        } catch {
          return safeError('action-failed')
        }
        const failureError = validateOrigin(afterFailure)
        if (failureError && failureError !== 'unfocused') draftTokens.delete(draftToken)
        return safeError(failureError ?? 'action-failed')
      }
      draftTokens.delete(draftToken)
      let after: NativeTranscriptCommittedContext | null
      try {
        after = options.getContext()
      } catch {
        return safeError('action-failed')
      }
      const afterError = validateOrigin(after)
      return afterError ? safeError(afterError) : { ok: true }
    })()
    pendingDraftSaves.set(draftToken, { key: saveKey, promise: operation })
    try {
      return await operation
    } finally {
      if (pendingDraftSaves.get(draftToken)?.promise === operation) pendingDraftSaves.delete(draftToken)
    }
  }

  function invalidate(): void {
    invalidated = true
    draftTokens.clear()
  }

  return { dispatch, saveDraft, invalidate }
}
