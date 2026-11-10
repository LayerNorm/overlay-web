'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ChatMessageListActions } from '../ChatMessageList'

export function useChatRowCallbacks(actions: ChatMessageListActions): ChatMessageListActions {
  const latest = useRef(actions)
  useLayoutEffect(() => { latest.current = actions }, [actions])
  const handlers = useMemo<Omit<ChatMessageListActions, 'generatedUiConnectorActions'>>(() => ({
    onJumpToReply: (...args) => latest.current.onJumpToReply(...args),
    onDeleteTurn: (...args) => latest.current.onDeleteTurn(...args),
    onReplyToMediaPrompt: (...args) => latest.current.onReplyToMediaPrompt(...args),
    onReplyToAssistantText: (...args) => latest.current.onReplyToAssistantText(...args),
    onBranch: (...args) => latest.current.onBranch(...args),
    onOpenDraft: (...args) => latest.current.onOpenDraft(...args),
    onCreateAutomationDraft: (...args) => latest.current.onCreateAutomationDraft(...args),
    onOpenSources: (...args) => latest.current.onOpenSources(...args),
    onRetry: (...args) => latest.current.onRetry(...args),
    onOpenFilePreview: (...args) => latest.current.onOpenFilePreview(...args),
    onOpenAttachmentPreview: (...args) => latest.current.onOpenAttachmentPreview(...args),
    onContinue: (...args) => latest.current.onContinue(...args),
    onGeneratedUiChange: (...args) => latest.current.onGeneratedUiChange(...args),
  }), [])
  return useMemo(() => ({ ...handlers, generatedUiConnectorActions: actions.generatedUiConnectorActions }),
    [handlers, actions.generatedUiConnectorActions])
}
