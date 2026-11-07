'use client'

import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { toast } from '@overlay/ui/primitives'
import { scrollToExchangeTurn } from '@/features/chat/lib/scroll-to-exchange-turn'
import {
  getResponseForExchange,
  removeTurnFromConversationRuntime,
} from './chat-runtime-helpers'
import type { useChatRuntimes } from './useChatRuntimes'
import type { useConversationUiState } from './useConversationUiState'
import type { useChatRouteController } from './useChatRouteController'
import type { useChatConversationLoader } from './useChatConversationLoader'
import type { useComposerTools } from './useComposerTools'
import type { usePersonalChat } from '@/components/providers/PersonalChatProvider'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { MentionInputHandle } from '../chat-interface/MentionInput'

type Runtimes = ReturnType<typeof useChatRuntimes>

export function useChatTurnActions({
  nativeThreadReadOnly = false,
  activeRuntime,
  isActiveLoading,
  setReplyContext,
  textareaRef,
  ensureConversationRuntime,
  activeChatIdRef,
  chatInstances,
  actChat,
  applyUiStateToView,
  setRuntimeHydrationVersion,
  resetToBlankChatSurface,
  isTemporaryChat,
  activeChatId,
  setIsSwitchingChat,
  loadChat,
  nativeBranch,
  nativeDeleteTurn,
  nativeWorkspaceId,
  setExitingTurnIds,
}: {
  nativeThreadReadOnly?: boolean
  activeRuntime: Runtimes['activeRuntime']
  isActiveLoading: boolean
  setReplyContext: ReturnType<typeof useComposerTools>['setReplyContext']
  textareaRef: RefObject<MentionInputHandle | null>
  ensureConversationRuntime: Runtimes['ensureConversationRuntime']
  activeChatIdRef: MutableRefObject<string | null>
  chatInstances: Runtimes['chatInstances']
  actChat: Runtimes['actChat']
  applyUiStateToView: ReturnType<typeof useConversationUiState>['applyUiStateToView']
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  resetToBlankChatSurface: ReturnType<typeof useChatRouteController>['resetToBlankChatSurface']
  isTemporaryChat: boolean
  activeChatId: string | null
  setIsSwitchingChat: Dispatch<SetStateAction<boolean>>
  loadChat: ReturnType<typeof useChatConversationLoader>['loadChat']
  nativeBranch: ReturnType<typeof usePersonalChat>['branch']
  nativeDeleteTurn: ReturnType<typeof usePersonalChat>['deleteTurn']
  nativeWorkspaceId: string | null
  setExitingTurnIds: Dispatch<SetStateAction<string[]>>
}) {
  const getResponseForExchangeAtIndex = useCallback((
    exchangeIndex: number,
  ): UIMessage | null => getResponseForExchange({
    exchangeIndex,
    activeRuntime,
  }), [activeRuntime])

  const beginReplyToAssistantText = useCallback((assistantText: string, targetUserTurnId: string | null) => {
    const t = assistantText.trim()
    if (!t) {
      textareaRef.current?.focus()
      return
    }
    setReplyContext({
      snippet: t.length > 160 ? `${t.slice(0, 160)}…` : t,
      bodyForModel: t.slice(0, 16000),
      ...(targetUserTurnId ? { replyToTurnId: targetUserTurnId } : {}),
    })
    textareaRef.current?.focus()
  }, [setReplyContext, textareaRef])

  const beginReplyToMediaPrompt = useCallback((prompt: string, kind: 'image' | 'video', targetUserTurnId: string | null) => {
    const t = prompt.trim()
    if (!t) {
      textareaRef.current?.focus()
      return
    }
    setReplyContext({
      snippet: t.length > 120 ? `${t.slice(0, 120)}…` : t,
      bodyForModel: `[Prior ${kind} generation request]\n${t.slice(0, 12000)}`,
      ...(targetUserTurnId ? { replyToTurnId: targetUserTurnId } : {}),
    })
    textareaRef.current?.focus()
  }, [setReplyContext, textareaRef])

  const jumpToReplyTarget = useCallback((turnId: string) => {
    scrollToExchangeTurn(turnId)
  }, [])

  function removeTurnFromRuntime(chatId: string, turnId: string) {
    const runtime = ensureConversationRuntime(chatId)
    const { removedExchangeIndex } = removeTurnFromConversationRuntime(runtime, turnId)

    if (activeChatIdRef.current === chatId) {
      chatInstances[0]?.setMessages([...runtime.askChats[0].messages] as UIMessage[])
    }
    if (activeChatIdRef.current === chatId) {
      actChat.setMessages([...runtime.actChat.messages] as UIMessage[])
    }

    if (removedExchangeIndex >= 0) {
      if (activeChatIdRef.current === chatId) applyUiStateToView(runtime.ui)
    }
    setRuntimeHydrationVersion((value) => value + 1)
  }

  function handleTemporaryChatToggle() {
    if (isActiveLoading) return
    resetToBlankChatSurface({ temporary: !isTemporaryChat })
  }

  async function handleBranchConversationAtTurn(turnId: string | null) {
    const sourceChatId = activeChatIdRef.current ?? activeChatId
    const targetTurnId = turnId?.trim()
    if (!sourceChatId || !targetTurnId || isActiveLoading || !nativeWorkspaceId) return
    try {
      setIsSwitchingChat(true)
      const branchChatId = await nativeBranch({
        workspaceId: nativeWorkspaceId,
        conversationId: sourceChatId as Id<'conversations'>,
        turnId: targetTurnId,
        clientId: crypto.randomUUID(),
      })
      await loadChat(branchChatId)
      toast.success('Branch created.')
    } catch (error) {
      const tooLong = error instanceof Error && error.message.includes('BRANCH_TOO_LONG')
      toast.error(tooLong ? 'This chat is too long to branch.' : 'Could not create branch')
      setIsSwitchingChat(false)
    }
  }

  async function handleDeleteTurnById(turnId: string) {
    if (nativeThreadReadOnly) return
    const cid = activeChatIdRef.current ?? activeChatId
    if (!cid || !turnId || !nativeWorkspaceId) {
      toast.error('Cannot delete this message right now.')
      return
    }
    try {
      const EXIT_MS = 300
      if (activeChatIdRef.current === cid) {
        setExitingTurnIds((prev) => (prev.includes(turnId) ? prev : [...prev, turnId]))
        await new Promise((r) => window.setTimeout(r, EXIT_MS))
      }
      await nativeDeleteTurn({ workspaceId: nativeWorkspaceId, conversationId: cid as Id<'conversations'>, turnId })
      removeTurnFromRuntime(cid, turnId)
    } catch {
      toast.error('Could not delete this turn.')
    } finally {
      setExitingTurnIds((prev) => prev.filter((id) => id !== turnId))
    }
  }

  return {
    getResponseForExchange: getResponseForExchangeAtIndex,
    beginReplyToAssistantText,
    beginReplyToMediaPrompt,
    jumpToReplyTarget,
    handleTemporaryChatToggle,
    handleBranchConversationAtTurn,
    handleDeleteTurnById,
  }
}
