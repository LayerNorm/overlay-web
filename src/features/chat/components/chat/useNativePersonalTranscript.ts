import { useEffect, useMemo } from 'react'
import type { usePersonalChat } from '@/components/providers/PersonalChatProvider'
import type { ConversationUiState } from '../chat-interface/types'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { GenerationResult } from '../chat-interface/types'
import type { PersonalPendingTurn, PersonalTranscriptMessage, PersonalTranscriptRow } from './personal-transcript'
import { projectPersonalTranscript } from './personal-transcript'
import {
  ACTIVE_AGENT_RUN_STATUSES,
  isTerminalAgentRunStatus,
  type AgentRunStatus,
} from '@/shared/agents/agent-run'
import { isPlaceholderChatTitle } from '@/shared/chat/chat-title'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'

const activeRunStatuses = new Set<string>(ACTIVE_AGENT_RUN_STATUSES)

/**
 * Title generation starts in the sending tab, so a reload during the first turn can
 * lose it. Returns the first prompt when a settled chat still has a placeholder title.
 */
export function nativeTitleRecoverySeed({ title, turnActive, status, messages }: {
  title: string | null | undefined
  turnActive: boolean
  status: string
  messages: ReadonlyArray<{ role: string; createdAt: number; parts?: ReadonlyArray<{ type: string; text?: unknown }> }>
}): string | null {
  if (turnActive || status !== 'ready' || !isPlaceholderChatTitle(title)) return null
  let firstUser: (typeof messages)[number] | null = null
  for (const message of messages) {
    if (message.role === 'user' && (!firstUser || message.createdAt < firstUser.createdAt)) firstUser = message
  }
  const text = firstUser?.parts
    ?.flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
    .join(' ')
    .trim()
  return text || null
}

function sdkResponsesForTurn(messages: readonly UIMessage[], turn: PersonalPendingTurn) {
  const exact = messages.filter((message) => {
    const metadata = message.metadata as { turnId?: unknown } | undefined
    return message.role === 'assistant'
      && (('turnId' in message && message.turnId === turn.turnId) || metadata?.turnId === turn.turnId)
  })
  if (exact.length > 0) return exact
  const userIndex = messages.findIndex((message) => message.id === turn.user.id)
  if (userIndex < 0) return []
  const responses: UIMessage[] = []
  for (const message of messages.slice(userIndex + 1)) {
    if (message.role === 'user') break
    if (message.role === 'assistant') responses.push(message)
  }
  return responses
}

export function projectScopedNativeTranscript({
  enabled,
  conversationId,
  summaryConversationId,
  transcriptConversationId,
  pendingFirstConversationId,
  rows,
  pendingTurns,
  sdkMessages,
}: {
  enabled: boolean
  conversationId: string | null
  summaryConversationId: string | null
  transcriptConversationId: string | null
  pendingFirstConversationId?: string | null
  rows: readonly PersonalTranscriptRow[]
  pendingTurns: readonly PersonalPendingTurn[]
  sdkMessages: readonly UIMessage[]
}) {
  const scopeMatches = Boolean(enabled && conversationId
    && summaryConversationId === conversationId
    && transcriptConversationId === conversationId)
  const pendingFirstScope = Boolean(enabled && conversationId
    && conversationId === pendingFirstConversationId
    && (!summaryConversationId || summaryConversationId === conversationId)
    && (!transcriptConversationId || transcriptConversationId === conversationId))
  const localOnlyScope = enabled && !conversationId && !summaryConversationId && !transcriptConversationId
  const scopedPending = scopeMatches || pendingFirstScope || localOnlyScope ? pendingTurns : []
  const responsesByTurn = new Map(scopedPending.map((turn) => [
    turn.turnId,
    sdkResponsesForTurn(sdkMessages, turn).map((message, index) => ({
      ...message,
      turnId: turn.turnId,
      mode: turn.user.mode,
      model: (message as { model?: string }).model ?? turn.user.model,
      variantIndex: (message as { variantIndex?: number }).variantIndex ?? index,
      contentType: 'text' as const,
      status: (message as { status?: 'generating' | 'completed' | 'error' }).status ?? 'generating',
      createdAt: (message as { createdAt?: number }).createdAt ?? turn.user.createdAt,
    })),
  ]))
  const localPending = scopedPending.map((turn) => ({
    ...turn,
    responses: [...turn.responses, ...(responsesByTurn.get(turn.turnId) ?? [])],
  }))
  return {
    scopeMatches,
    localOnlyScope,
    projection: projectPersonalTranscript(scopeMatches ? rows : [], localPending),
  }
}

export function useNativePersonalTranscript({
  enabled,
  conversationId,
  summaryConversationId,
  transcriptConversationId,
  pendingFirstConversationId,
  status,
  rows,
  journal,
  sourceJournal = journal,
  sdkMessages,
  runtimeHydrationVersion,
  onJournalChange,
  isCurrentScope,
}: {
  enabled: boolean
  conversationId: string | null
  summaryConversationId: string | null
  transcriptConversationId: string | null
  pendingFirstConversationId?: string | null
  status: 'disabled' | 'loading' | 'ready' | 'unavailable'
  rows: readonly PersonalTranscriptRow[]
  journal: Map<string, PersonalPendingTurn>
  sourceJournal?: Map<string, PersonalPendingTurn>
  sdkMessages: readonly UIMessage[]
  runtimeHydrationVersion: number
  onJournalChange(): void
  isCurrentScope?: () => boolean
}) {
  const { scopeMatches, localOnlyScope, projection } = useMemo(
    () => {
      void runtimeHydrationVersion
      return projectScopedNativeTranscript({
      enabled: enabled && status !== 'unavailable',
      conversationId,
      summaryConversationId,
      transcriptConversationId,
      pendingFirstConversationId,
      rows,
      pendingTurns: [...journal.values()],
      sdkMessages,
      })
    },
    [
      conversationId,
      enabled,
      journal,
      rows,
      runtimeHydrationVersion,
      sdkMessages,
      status,
      summaryConversationId,
      transcriptConversationId,
      pendingFirstConversationId,
    ],
  )

  useEffect(() => {
    if (!scopeMatches || (isCurrentScope && !isCurrentScope())) return
    let changed = false
    for (const [turnId, pending] of journal) {
      if (sourceJournal.get(turnId) !== pending) continue
      if (projection.acknowledgedTurnIds.has(turnId) && !pending.userAcknowledged) {
        sourceJournal.set(turnId, { ...pending, userAcknowledged: true })
        changed = true
        continue
      }
      const completedOutput = projection.outputs.some((output) =>
        output.turnId === turnId && output.status !== 'pending')
      if (projection.terminalTurnIds.has(turnId) || completedOutput) {
        sourceJournal.delete(turnId)
        changed = true
      }
    }
    if (changed) onJournalChange()
  }, [isCurrentScope, journal, onJournalChange, projection, scopeMatches, sourceJournal])

  return { projection, scopeMatches, localOnlyScope }
}

export function pendingNativeGenerationResults({
  turns,
  exchanges,
  canonicalOutputs,
}: {
  turns: readonly PersonalPendingTurn[]
  exchanges: readonly { turnId: string }[]
  canonicalOutputs: readonly { turnId: string; type: string }[]
}) {
  const pendingTurnIds = new Set(turns.map((turn) => turn.turnId))
  const canonicalTurnIds = new Set(canonicalOutputs.map((output) => output.turnId))
  const result = new Map<number, GenerationResult[]>()
  exchanges.forEach((exchange, index) => {
    if (!pendingTurnIds.has(exchange.turnId) || canonicalTurnIds.has(exchange.turnId)) return
    const generation = turns.find((turn) => turn.turnId === exchange.turnId)?.localGenerationResults
    if (generation?.length) result.set(index, [...generation])
  })
  return result
}

export function buildNativeTranscriptView(
  projection: ReturnType<typeof projectPersonalTranscript>,
  pendingTurns: readonly PersonalPendingTurn[],
) {
  const exchanges = projection.exchanges.map(exchange => ({
    ...exchange,
    user: exchange.user ?? ({
      id: exchange.turnId, turnId: exchange.turnId, role: 'user', mode: 'act',
      contentType: 'text', createdAt: exchange.responses[0]?.createdAt ?? 0,
      metadata: { nativeOrphan: true },
      parts: [{ type: 'text', text: 'Original message unavailable' }],
    } satisfies PersonalTranscriptMessage as PersonalTranscriptMessage),
  }))
  const byTurn = new Map(exchanges.map((exchange, index) => [exchange.turnId, index]))
  const generationResults = new Map<number, GenerationResult[]>()
  for (const output of projection.outputs) {
    if (output.type !== 'image' && output.type !== 'video') continue
    const index = byTurn.get(output.turnId)
    if (index === undefined) continue
    const results = generationResults.get(index) ?? []
    results.push({
      outputId: output._id, type: output.type,
      status: output.status === 'pending' ? 'generating' : output.status,
      modelUsed: output.modelId, url: output.url,
    })
    generationResults.set(index, results)
  }
  const pending = pendingNativeGenerationResults({
    turns: pendingTurns, exchanges, canonicalOutputs: projection.outputs,
  })
  for (const [index, results] of pending) generationResults.set(index, results)
  return {
    exchanges, generationResults,
    primaryMessages: exchanges.map(exchange => exchange.user),
    exchangeModes: exchanges.map(exchange => exchange.user.mode),
    exchangeGenTypes: exchanges.map(exchange => exchange.user.contentType),
    exchangeModels: exchanges.map(exchange => {
      const models = exchange.responses.map(response => response.model).filter((model): model is string => Boolean(model))
      return models.length ? models : exchange.user.model ? [exchange.user.model] : []
    }),
  }
}

export function selectNativePersonalScope({ nativePersonalRoute, isTemporaryChat,
  activeChatId, isNativePersonalChat, pendingRunConversationId, pendingTurns, personal, selectedModels, selectedActModel }: {
  nativePersonalRoute: boolean; isTemporaryChat: boolean;
  activeChatId: string | null; isNativePersonalChat(id: string): boolean; pendingRunConversationId: string | null;
  pendingTurns: number; personal: ReturnType<typeof usePersonalChat>; selectedModels: string[]; selectedActModel: string;
}) {
  const enabled = nativePersonalRoute && !isTemporaryChat
  const selectedConversationId = personal.selectedConversationId
  const pendingFirst = activeChatId === PENDING_FIRST_CHAT_ID || activeChatId === null
  const active = enabled && Boolean(selectedConversationId
    ? isNativePersonalChat(selectedConversationId)
    : pendingFirst && (pendingRunConversationId || pendingTurns))
  const conversationId = active ? selectedConversationId ?? pendingRunConversationId : null
  const summary = personalSummaryForConversation(personal, conversationId)
  return {
    enabled, active, conversationId, summary, summaryConversationId: summary?._id ?? null,
    selectedModels: summary?.askModelIds ?? selectedModels,
    selectedActModel: summary?.actModelId ?? selectedActModel,
  }
}

export function personalSummaryForConversation(personal: ReturnType<typeof usePersonalChat>, id: string | null) {
  const summary = personal.selectedSummary
  return summary && summary._id === id && summary.workspaceId === personal.workspaceId ? summary : null
}

export function nativeChatHydrated(enabled: boolean, status: string, pendingTurns: number, legacy: boolean) {
  return enabled ? status === 'ready' || status === 'unavailable' || pendingTurns > 0 : legacy
}

export function nativePersonalViewFromState({ legacy, transcript, state, enabled, journal }:
  Pick<Parameters<typeof useNativePersonalTranscript>[0], 'journal' | 'enabled'> & {
    legacy: Pick<ConversationUiState, 'generationResults' | 'exchangeModes' | 'exchangeModels' | 'exchangeGenTypes'> & {
      getResponseForExchange(index: number): UIMessage | null
    }
    transcript: ReturnType<typeof usePersonalChat>['transcript']
    state: ReturnType<typeof useNativePersonalTranscript>
  }) {
  const view = buildNativeTranscriptView(state.projection, [...journal.values()])
  if (!enabled) return { ...legacy, canonicalView: undefined, getResponsesForExchange: undefined, pagination: undefined }
  return {
    generationResults: view.generationResults, exchangeModes: view.exchangeModes,
    exchangeModels: view.exchangeModels, exchangeGenTypes: view.exchangeGenTypes,
    getResponseForExchange: (index: number) => view.exchanges[index]?.responses.at(-1) ?? null,
    getResponsesForExchange: (index: number) => view.exchanges[index]?.responses ?? [],
    canonicalView: {
      primaryMessages: view.primaryMessages, generationResults: view.generationResults,
      hydrated: transcript.status === 'ready' || transcript.status === 'unavailable' || state.localOnlyScope,
    },
    pagination: state.scopeMatches ? transcript : undefined,
  }
}

type NativeRunActivity = {
  turnId: string
  status: string
  createdAt: number
}

function nativePendingTurnFailed(turn: PersonalPendingTurn) {
  return turn.responses.some((response) => response.status === 'error')
    || turn.localGenerationResults?.some((result) => result.status === 'failed') === true
}

export function nativePersonalCurrentTurnId(
  projection: ReturnType<typeof projectPersonalTranscript>,
  run: NativeRunActivity | null,
  pendingTurns: readonly PersonalPendingTurn[] = [],
) {
  const pending = [...pendingTurns].reverse().find((turn) => !nativePendingTurnFailed(turn))
  if (pending) return pending.turnId
  if (run && activeRunStatuses.has(run.status)) return run.turnId
  const latest = projection.exchanges.at(-1)
  return latest?.turnId ?? run?.turnId ?? null
}

export function nativePersonalTurnIsActive({
  projection,
  pendingTurns,
  run,
}: {
  projection: ReturnType<typeof projectPersonalTranscript>
  pendingTurns: readonly PersonalPendingTurn[]
  run: NativeRunActivity | null
}) {
  const turnId = nativePersonalCurrentTurnId(projection, run, pendingTurns)
  if (!turnId) return false
  if (projection.terminalTurnIds.has(turnId)
    || (run?.turnId === turnId && isTerminalAgentRunStatus(run.status as AgentRunStatus))) return false
  if (run?.turnId === turnId && activeRunStatuses.has(run.status)) return true
  const pending = pendingTurns.find((turn) => turn.turnId === turnId)
  if (pending) return !nativePendingTurnFailed(pending)
  return projection.exchanges.find((exchange) => exchange.turnId === turnId)
    ?.responses.some((response) => response.status === 'generating') ?? false
}
