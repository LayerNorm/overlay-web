import type {
  ChatTranscriptExchangeView,
  ChatTranscriptResponseView,
  ChatTranscriptView,
  DraftModalState,
} from '@overlay/chat-core'
import { validateNativeMarkdownLink } from './sharedMarkdownBridge'

export const MAX_TRANSCRIPT_TEXT_LENGTH = 1_000_000
export const MAX_TRANSCRIPT_FILENAME_LENGTH = 160

export type NativeTranscriptActionKind =
  | 'copy'
  | 'download-text'
  | 'open-link'
  | 'reply'
  | 'open-asset'
  | 'open-source'
  | 'open-draft'
  | 'keyboard-dismiss'

interface TargetRequest {
  workspaceId: string | null
  conversationId: string
  mountNonce: string
  exchangeId: string
  responseId: string
}

export type NativeTranscriptActionRequest =
  | (TargetRequest & { kind: 'copy'; text: string })
  | (TargetRequest & { kind: 'download-text'; filename: string; text: string })
  | (TargetRequest & { kind: 'open-link'; url: string })
  | (TargetRequest & { kind: 'reply' })
  | (Omit<TargetRequest, 'responseId'> & { kind: 'open-asset'; assetHandle: string })
  | (TargetRequest & { kind: 'open-source'; sourceId: string })
  | (TargetRequest & { kind: 'open-draft'; partId: string; draft: DraftModalState })
  | { kind: 'keyboard-dismiss'; workspaceId: string | null; conversationId: string; mountNonce: string }

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
  | 'action-failed'

export type NativeTranscriptActionResult =
  | { ok: true }
  | { ok: false; error: NativeTranscriptError }

export interface NativeTranscriptTrustedReplyTarget {
  exchange: ChatTranscriptExchangeView
  response: ChatTranscriptResponseView
}

export interface NativeTranscriptScope {
  workspaceId: string | null
  conversationId: string
  mountNonce: string
}

export interface NativeTranscriptActionHandlers {
  copyText?: (text: string) => Promise<void>
  downloadText?: (filename: string, text: string) => Promise<void>
  openLink?: (url: string) => Promise<void>
  reply?: (target: NativeTranscriptTrustedReplyTarget, scope: NativeTranscriptScope) => void | Promise<void>
  openAsset?: (asset: NativeTranscriptAsset, scope: NativeTranscriptScope) => void | Promise<void>
  openSource?: (source: ChatTranscriptResponseView['sources'][number], scope: NativeTranscriptScope) => void | Promise<void>
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
  return prototype === Object.prototype || prototype === null
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

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value &&
    !/[\u0000-\u001f\u007f/\\]/.test(value) && !value.includes('..') && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}

function validAssetHandle(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(value)
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
    (draft.graphSource !== undefined && (typeof draft.graphSource !== 'string' || draft.graphSource.length > 256)) ||
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

function validFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TRANSCRIPT_FILENAME_LENGTH &&
    value.trim() === value && !value.startsWith('.') && !value.includes('..') &&
    !/[\\/\u0000-\u001f\u007f]/.test(value) && /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(value)
}

function requestKeys(kind: string): readonly string[] | null {
  const base = ['kind', 'workspaceId', 'conversationId', 'mountNonce']
  switch (kind) {
    case 'keyboard-dismiss': return base
    case 'copy': return [...base, 'exchangeId', 'responseId', 'text']
    case 'download-text': return [...base, 'exchangeId', 'responseId', 'filename', 'text']
    case 'open-link': return [...base, 'exchangeId', 'responseId', 'url']
    case 'reply': return [...base, 'exchangeId', 'responseId']
    case 'open-asset': return [...base, 'exchangeId', 'assetHandle']
    case 'open-source': return [...base, 'exchangeId', 'responseId', 'sourceId']
    case 'open-draft': return [...base, 'exchangeId', 'responseId', 'partId', 'draft']
    default: return null
  }
}

function findTarget(context: NativeTranscriptCommittedContext, request: { exchangeId: string; responseId: string }) {
  const exchange = context.view.exchanges.find((item) => item.id === request.exchangeId)
  const response = exchange?.responses.find((item) => item.id === request.responseId)
  return exchange && response ? { exchange, response } : null
}

function validateRequestShape(value: unknown): value is NativeTranscriptActionRequest {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  const keys = requestKeys(value.kind)
  if (!keys || !hasExactKeys(value, keys)) return false
  if (
    !(value.workspaceId === null || validId(value.workspaceId)) ||
    !validId(value.conversationId) || !validId(value.mountNonce)
  ) return false
  if (value.kind !== 'keyboard-dismiss' && !validId(value.exchangeId)) return false
  if (value.kind !== 'keyboard-dismiss' && value.kind !== 'open-asset' && !validId(value.responseId)) return false
  switch (value.kind) {
    case 'copy': return typeof value.text === 'string' && value.text.length > 0 && value.text.length <= MAX_TRANSCRIPT_TEXT_LENGTH
    case 'download-text': return validFilename(value.filename) && typeof value.text === 'string' && value.text.length > 0 && value.text.length <= MAX_TRANSCRIPT_TEXT_LENGTH
    case 'open-link': return validateNativeMarkdownLink(value.url) !== null
    case 'reply': return true
    case 'open-asset': return validAssetHandle(value.assetHandle)
    case 'open-source': return validId(value.sourceId)
    case 'open-draft': return validId(value.partId) && validDraftState(value.draft)
    case 'keyboard-dismiss': return true
    default: return false
  }
}

function scopeMatches(context: NativeTranscriptCommittedContext, request: NativeTranscriptActionRequest): boolean {
  return context.mounted && context.workspaceId === request.workspaceId &&
    context.conversationId === request.conversationId && context.mountNonce === request.mountNonce
}

function contextScope(context: NativeTranscriptCommittedContext): NativeTranscriptScope {
  return {
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
    mountNonce: context.mountNonce,
  }
}

function handlerAvailable(handlers: NativeTranscriptActionHandlers, kind: NativeTranscriptActionKind): boolean {
  switch (kind) {
    case 'copy': return typeof handlers.copyText === 'function'
    case 'download-text': return typeof handlers.downloadText === 'function'
    case 'open-link': return typeof handlers.openLink === 'function'
    case 'reply': return typeof handlers.reply === 'function'
    case 'open-asset': return typeof handlers.openAsset === 'function'
    case 'open-source': return typeof handlers.openSource === 'function'
    case 'open-draft': return typeof handlers.openDraft === 'function' && typeof handlers.saveDraft === 'function'
    case 'keyboard-dismiss': return typeof handlers.dismissKeyboard === 'function'
  }
}

function safeError(error: NativeTranscriptError): NativeTranscriptActionResult {
  return { ok: false, error }
}

export function createNativeTranscriptActionController(options: NativeTranscriptActionControllerOptions) {
  const pending = new Map<string, Promise<NativeTranscriptActionResult>>()
  const draftTokens = new Map<string, { workspaceId: string | null; conversationId: string; mountNonce: string; draftKind: DraftModalState['kind'] }>()
  let invalidated = false

  function validate(value: unknown): { request: NativeTranscriptActionRequest; context: NativeTranscriptCommittedContext; target: ReturnType<typeof findTarget> } | NativeTranscriptActionResult {
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
        validAssetHandle(item.handle) && validId(item.resourceId) && ['file', 'output'].includes(item.resourceKind) && item.previewable)
      if (!exchange || !asset) return safeError('unknown-target')
      return { request: value, context, target: null }
    }
    const target = findTarget(context, value)
    if (!target) return safeError('unknown-target')
    if (value.kind === 'open-source' && !target.response.sources.some((source) => source.id === value.sourceId &&
      (source.sourceKind === 'url' ? Boolean(validateNativeMarkdownLink(source.url)) : validId(source.sourceId)))) return safeError('unknown-target')
    if (value.kind === 'open-draft' && !target.response.blocks.some((block) => block.kind === 'generated-ui' && block.part.id === value.partId)) return safeError('unknown-target')
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
        }
        const current = validate(request)
        if ('ok' in current) return current
        switch (request.kind) {
          case 'copy': await options.handlers.copyText!(request.text); break
          case 'download-text': await options.handlers.downloadText!(request.filename, request.text); break
          case 'open-link': await options.handlers.openLink!(validateNativeMarkdownLink(request.url)!); break
          case 'reply': await options.handlers.reply!(current.target!, contextScope(current.context)); break
          case 'open-asset': {
            const asset = current.context.assets.find((item) => item.handle === request.assetHandle && item.exchangeId === request.exchangeId &&
              validAssetHandle(item.handle) && validId(item.resourceId) && ['file', 'output'].includes(item.resourceKind) && item.previewable)
            if (!asset) return safeError('unknown-target')
            await options.handlers.openAsset!(asset, contextScope(current.context))
            break
          }
          case 'open-source': {
            const source = current.target!.response.sources.find((item) => item.id === request.sourceId)
            if (!source || (source.sourceKind === 'url' && !validateNativeMarkdownLink(source.url))) return safeError('unknown-target')
            await options.handlers.openSource!(source, contextScope(current.context))
            break
          }
          case 'open-draft': {
            const originScope = contextScope(current.context)
            const token = options.createDraftToken()
            if (!validId(token) || draftTokens.has(token)) return safeError('action-failed')
            draftTokens.set(token, { ...originScope, draftKind: request.draft.kind })
            try {
              await options.handlers.openDraft!(request.draft, originScope, token)
            } catch (error) {
              draftTokens.delete(token)
              throw error
            }
            const afterOpen = validate(request)
            if ('ok' in afterOpen) {
              draftTokens.delete(token)
              return afterOpen
            }
            return { ok: true }
          }
          case 'keyboard-dismiss': await options.handlers.dismissKeyboard!(); break
        }
        const afterAction = validate(request)
        return 'ok' in afterAction ? afterAction : { ok: true }
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
    if (origin.draftKind !== safeDraft.kind) return safeError('invalid-payload')
    let context: NativeTranscriptCommittedContext | null
    try {
      context = options.getContext()
    } catch {
      draftTokens.delete(draftToken)
      return safeError('action-failed')
    }
    if (!context || !context.mounted || !context.focused || context.workspaceId !== origin.workspaceId || context.conversationId !== origin.conversationId || context.mountNonce !== origin.mountNonce) {
      draftTokens.delete(draftToken)
      return safeError(context?.focused ? 'stale-scope' : 'unfocused')
    }
    if (!context.allowedActions.includes('open-draft')) {
      draftTokens.delete(draftToken)
      return safeError('unsupported')
    }
    if (typeof options.handlers.saveDraft !== 'function') {
      draftTokens.delete(draftToken)
      return safeError('unsupported')
    }
    draftTokens.delete(draftToken)
    try {
      await options.handlers.saveDraft(safeDraft, {
        workspaceId: origin.workspaceId,
        conversationId: origin.conversationId,
        mountNonce: origin.mountNonce,
      })
      const after = options.getContext()
      if (invalidated || !after || !after.mounted || after.workspaceId !== origin.workspaceId || after.conversationId !== origin.conversationId || after.mountNonce !== origin.mountNonce) return safeError('stale-scope')
      if (!after.focused) return safeError('unfocused')
      if (!after.allowedActions.includes('open-draft') || !handlerAvailable(options.handlers, 'open-draft')) return safeError('unsupported')
      return { ok: true }
    } catch {
      return safeError('action-failed')
    }
  }

  function invalidate(): void {
    invalidated = true
    draftTokens.clear()
  }

  return { dispatch, saveDraft, invalidate }
}
