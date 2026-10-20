'use client'

import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createIdempotencyKey } from '@overlay/api-client'
import { toast } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { scrollToExchangeTurn } from '@/features/chat/lib/scroll-to-exchange-turn'
import { DEFAULT_CHAT_TITLE } from '../chat-interface/constants'
import {
  getResponseForExchange,
  removeTurnFromConversationRuntime,
} from './chat-runtime-helpers'
import type { useChatRuntimes } from './useChatRuntimes'
import type { useConversationUiState } from './useConversationUiState'
import type { useChatRouteController } from './useChatRouteController'
import type { useChatConversationLoader } from './useChatConversationLoader'
import type { useChatSendController } from './useChatSendController'
import type { useComposerTools } from './useComposerTools'
import type { MentionInputHandle } from '../chat-interface/MentionInput'

type Runtimes = ReturnType<typeof useChatRuntimes>

export function useChatTurnActions({
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
  createNewChat,
  loadChat,
  runtimesRef,
  activeChatTitle,
  setExitingTurnIds,
}: {
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
  createNewChat: ReturnType<typeof useChatSendController>['createNewChat']
  loadChat: ReturnType<typeof useChatConversationLoader>['loadChat']
  runtimesRef: Runtimes['runtimesRef']
  activeChatTitle: string | null
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
    if (!sourceChatId || !targetTurnId || isActiveLoading) return
    try {
      setIsSwitchingChat(true)
      const sourceRes = await overlayAppClient.conversations.getResponse({
        conversationId: sourceChatId,
        messages: true,
      })
      if (!sourceRes.ok) throw new Error('Could not load source chat')
      const sourceData = await sourceRes.json() as {
        messages?: Array<{
          turnId?: string
          mode?: 'ask' | 'act'
          role?: 'user' | 'assistant'
          contentType?: 'text' | 'image' | 'video'
          parts?: Array<{ type: string; text?: string; url?: string; mediaType?: string; fileName?: string }>
          model?: string
          variantIndex?: number
          replyToTurnId?: string
          replySnippet?: string
        }>
      }
      const rows: NonNullable<typeof sourceData.messages> = []
      for (const message of sourceData.messages ?? []) {
        rows.push(message)
        if (message.turnId === targetTurnId && message.role === 'assistant') {
          continue
        }
      }
      const targetIdx = rows.findLastIndex((message) => message.turnId === targetTurnId)
      if (targetIdx < 0) throw new Error('Could not find that turn')
      const branchRows = rows.slice(0, targetIdx + 1)
      const branchChatId = await createNewChat({ title: `${activeChatTitle || DEFAULT_CHAT_TITLE} branch` })
      if (!branchChatId) throw new Error('Could not create branch')
      const branchCopyRequestPrefix = createIdempotencyKey()
      for (const [messageIndex, message] of branchRows.entries()) {
        const content = (message.parts ?? [])
          .filter((part) => part.type === 'text' && part.text?.trim())
          .map((part) => part.text!.trim())
          .join('\n\n') || (message.role === 'assistant' ? '[Response]' : '[Message]')
        const parts = (message.parts ?? []).filter((part) => part.type === 'text' || part.type === 'file')
        // Sequential on purpose: branch messages must be appended in order —
        // parallel copies could interleave the conversation history.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const res = await overlayAppClient.conversations.addMessageResponse(
          {
            conversationId: branchChatId,
            turnId: message.turnId,
            mode: message.mode ?? 'act',
            role: message.role,
            content,
            parts,
            modelId: message.model,
            contentType: message.contentType ?? 'text',
            variantIndex: message.variantIndex,
            ...(message.replyToTurnId ? { replyToTurnId: message.replyToTurnId, replySnippet: message.replySnippet } : {}),
          },
          {
            idempotencyKey: [
              'branch-copy',
              branchCopyRequestPrefix,
              messageIndex,
              message.role ?? 'unknown',
              message.variantIndex ?? 0,
            ].join(':'),
          },
        )
        if (!res.ok) throw new Error('Could not copy branch messages')
      }
      const branchRuntime = runtimesRef.current.get(branchChatId)
      if (branchRuntime) branchRuntime.hydrated = false
      await loadChat(branchChatId)
      toast.success('Branch created.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create branch')
      setIsSwitchingChat(false)
    }
  }

  async function handleDeleteTurnById(turnId: string) {
    const cid = activeChatIdRef.current ?? activeChatId
    if (!cid || !turnId) {
      toast.error('Cannot delete this message right now.')
      return
    }
    const EXIT_MS = 300
    setExitingTurnIds((prev) => (prev.includes(turnId) ? prev : [...prev, turnId]))
    await new Promise((r) => window.setTimeout(r, EXIT_MS))
    try {
      const res = await overlayAppClient.conversations.deleteMessageResponse({ conversationId: cid, turnId })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(payload.error || 'Could not delete this turn.')
        return
      }
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
