'use client'

import type React from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { AutomationDetail } from '@overlay/app-core'
import { UsageExhaustedNotice } from '@overlay/chat-react'
import { chatGreetingLine } from '@overlay/chat-core'
import type { Conversation } from '../chat-interface/types'
import type { useChatRuntimes } from './useChatRuntimes'
import type { useConversationUiState } from './useConversationUiState'

const EMPTY_UI_MESSAGES: UIMessage[] = []

export function buildChatDerivedView({
  chats,
  activeChatId,
  activeRuntime,
  generationResults,
  idParam,
  automationConversationId,
  showAutomationChatTab,
  activeChatHydrated,
  isActiveLoading,
  isOptimisticLoading,
  isConversationBottomVisible,
  composerMode,
  firstName,
  mode,
  selectedAutomation,
  belowEmptyComposer,
  isBudgetExhaustedPaid,
  isTemporaryChat,
  activeChatTitle,
}: {
  chats: Conversation[]
  activeChatId: string | null
  activeRuntime: ReturnType<typeof useChatRuntimes>['activeRuntime']
  generationResults: ReturnType<typeof useConversationUiState>['generationResults']
  idParam: string | null
  automationConversationId: string | null
  showAutomationChatTab: boolean
  activeChatHydrated: boolean
  isActiveLoading: boolean
  isOptimisticLoading: boolean
  isConversationBottomVisible: boolean
  composerMode: 'chat' | 'automate'
  firstName: string | undefined
  mode: 'chat' | 'automate'
  selectedAutomation: AutomationDetail | null
  belowEmptyComposer: React.ReactNode
  isBudgetExhaustedPaid: boolean
  isTemporaryChat: boolean
  activeChatTitle: string | null
}) {
  const activeChat = chats.find((c) => c._id === activeChatId)

  // Read messages directly from the runtime Chat instance so the UI never lags
  // behind the loaded state (useChat's useSyncExternalStore can be one beat late).
  const primaryMessageSource =
    activeRuntime.askChats.find((chat) => chat.messages.some((message) => message.role === 'user')) ??
    (activeRuntime.actChat.messages.some((message) => message.role === 'user') ? activeRuntime.actChat : activeRuntime.askChats[0])
  const primaryMessages = (primaryMessageSource.messages as UIMessage[] | undefined) ?? EMPTY_UI_MESSAGES
  const hasRuntimeMessages =
    activeRuntime.actChat.messages.some((message) => message.role === 'user') ||
    activeRuntime.askChats.some((chat) => chat.messages.some((message) => message.role === 'user'))
  const hasHistory = hasRuntimeMessages || generationResults.size > 0
  const isExistingConversationView = Boolean(idParam || activeChatId || automationConversationId)
  const showChatLoadingState = showAutomationChatTab && isExistingConversationView && !hasHistory && !activeChatHydrated
  /** Empty chat (any modality): center composer + suggestions only on the true new-chat surface. */
  const showCenteredEmptyChat = !hasHistory && (!isExistingConversationView || activeChatHydrated)
  const reserveLatestExchangeStartSpace = showAutomationChatTab && hasHistory && (isActiveLoading || isOptimisticLoading)
  const showScrollToBottomControl =
    showAutomationChatTab &&
    hasHistory &&
    !showChatLoadingState &&
    !showCenteredEmptyChat &&
    !isConversationBottomVisible
  const userTurnCount = primaryMessages.filter((m) => m.role === 'user').length
  const latestExchIdx = userTurnCount > 0 ? userTurnCount - 1 : -1

  const greetingLine = composerMode === 'automate' ? 'What are we automating today?' : chatGreetingLine(firstName)
  const automationChatIntro = showCenteredEmptyChat && selectedAutomation && !automationConversationId ? (
    <div className="mx-auto mt-5 w-full max-w-[36rem] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-left shadow-sm">
      <p className="text-sm font-medium text-[var(--foreground)]">{selectedAutomation.name || selectedAutomation.title || 'Saved automation'}</p>
      {selectedAutomation.description ? (
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{selectedAutomation.description}</p>
      ) : null}
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-light)]">Saved instructions</p>
        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--foreground)]">{selectedAutomation.instructions}</p>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">Send a message below to continue this automation conversation.</p>
    </div>
  ) : null
  const emptyComposerContent = (
    <>
      {automationChatIntro}
      {belowEmptyComposer}
    </>
  )
  const usageExhaustedNotice = isBudgetExhaustedPaid && !isActiveLoading
    ? <UsageExhaustedNotice />
    : null

  const headerTitleLabel =
    selectedAutomation?.name ||
    (isTemporaryChat ? 'Temporary chat' : activeChatTitle || activeChat?.title || (mode === 'automate' ? 'New automation' : 'New conversation'))

  return {
    activeChat,
    primaryMessages,
    hasHistory,
    isExistingConversationView,
    showChatLoadingState,
    showCenteredEmptyChat,
    reserveLatestExchangeStartSpace,
    showScrollToBottomControl,
    latestExchIdx,
    greetingLine,
    automationChatIntro,
    emptyComposerContent,
    usageExhaustedNotice,
    headerTitleLabel,
  }
}
