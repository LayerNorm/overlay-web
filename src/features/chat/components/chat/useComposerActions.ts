'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { GenerationMode } from '@/shared/ai/gateway/model-types'
import type { PersonalChatMode } from '@overlay/ui/chat'
import { assistantBlocksToPlainText, buildAssistantVisualSequence } from '@overlay/chat-core'
import { safeSetLocalStorage } from './model-selection-utils'
import { CHAT_GEN_MODE_KEY, PERSONAL_CHAT_MODE_KEY } from '../chat-interface/constants'
import type { EmptyAutomateSuggestionId, EmptyChatSuggestionId } from '../ChatEmptyState'
import type { useGuestGate } from '@/components/providers/GuestGateProvider'
import type { useChatSendController } from './useChatSendController'
import type { useChatPreferences } from './useChatPreferences'
import type { useDraftReviewActions } from './useDraftReviewActions'
import type { useComposerTextState } from './useComposerTextState'
import type { useComposerTools } from './useComposerTools'
import type { useChatMentions } from '../use-chat-mentions'
import type { useChatModelSelectionController } from './useChatModelSelectionController'
import type { MentionInputHandle } from '../chat-interface/MentionInput'

type ChatPrefs = ReturnType<typeof useChatPreferences>

export function useComposerActions({
  isPublicShowcase,
  requireAuth,
  personMentions,
  setPersonalMentionConfirmationOpen,
  handleSend,
  setDraftModalState,
  setGenerationMode,
  setGenerationChip,
  setInput,
  textareaRef,
  personalChatMode,
  setPersonalChatMode,
  handleModeChange,
  setSelectedToolIds,
  autoContinueEnabled,
  activeChatId,
  primaryMessages,
  isActiveLoading,
  setShowModelPicker,
}: {
  isPublicShowcase: boolean
  requireAuth: ReturnType<typeof useGuestGate>['requireAuth']
  personMentions: ReturnType<typeof useChatMentions>['personMentions']
  setPersonalMentionConfirmationOpen: ReturnType<typeof useChatMentions>['setPersonalMentionConfirmationOpen']
  handleSend: ReturnType<typeof useChatSendController>['handleSend']
  setDraftModalState: ReturnType<typeof useDraftReviewActions>['setDraftModalState']
  setGenerationMode: ChatPrefs['setGenerationMode']
  setGenerationChip: ChatPrefs['setGenerationChip']
  setInput: ReturnType<typeof useComposerTextState>['setInput']
  textareaRef: RefObject<MentionInputHandle | null>
  personalChatMode: ChatPrefs['personalChatMode']
  setPersonalChatMode: ChatPrefs['setPersonalChatMode']
  handleModeChange: ReturnType<typeof useChatModelSelectionController>['handleModeChange']
  setSelectedToolIds: ReturnType<typeof useComposerTools>['setSelectedToolIds']
  autoContinueEnabled: boolean
  activeChatId: string | null
  primaryMessages: UIMessage[]
  isActiveLoading: boolean
  setShowModelPicker: ReturnType<typeof useChatModelSelectionController>['setShowModelPicker']
}) {
  const autoContinuedForMessageRef = useRef<Set<string>>(new Set())

  const effectiveHandleSend = useCallback(async () => {
    if (isPublicShowcase) {
      requireAuth('nav')
      return
    }
    if (personMentions.length > 0) {
      setPersonalMentionConfirmationOpen(true)
      return
    }
    await handleSend()
  }, [handleSend, isPublicShowcase, personMentions.length, requireAuth, setPersonalMentionConfirmationOpen])

  const focusComposer = useCallback(() => {
    window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
  }, [textareaRef])

  const handlePersonalChatModeChange = useCallback((nextMode: PersonalChatMode) => {
    setPersonalChatMode(nextMode)
    safeSetLocalStorage(PERSONAL_CHAT_MODE_KEY, nextMode)
  }, [setPersonalChatMode])

  const handleGenerationModeChange = useCallback((nextMode: GenerationMode) => {
    if (nextMode !== 'text' && personalChatMode === 'work') {
      handlePersonalChatModeChange('chat')
    }
    handleModeChange(nextMode)
  }, [handleModeChange, handlePersonalChatModeChange, personalChatMode])

  const handleGenerationChipChange = useCallback((chip: 'image' | 'video' | null) => {
    if (chip && personalChatMode === 'work') {
      handlePersonalChatModeChange('chat')
    }
    setGenerationChip(chip)
  }, [handlePersonalChatModeChange, personalChatMode, setGenerationChip])

  const handleEmptySuggestion = useCallback(
    (id: EmptyChatSuggestionId) => {
      if (id === 'image') {
        handleGenerationModeChange('image')
        handleGenerationChipChange('image')
        setInput('')
        focusComposer()
        return
      }
      if (id === 'write') {
        handleGenerationModeChange('text')
        setInput('Help me write or edit ')
        focusComposer()
        return
      }
      handleGenerationModeChange('text')
      setSelectedToolIds((current) =>
        current.includes('web_search') ? current : [...current, 'web_search'],
      )
      setInput('Look up ')
      focusComposer()
    },
    [focusComposer, handleGenerationChipChange, handleGenerationModeChange, setInput, setSelectedToolIds],
  )

  const handleAutomateSuggestion = useCallback(
    (id: EmptyAutomateSuggestionId) => {
      const prompts: Record<EmptyAutomateSuggestionId, string> = {
        workflow: 'Build a workflow that ',
        monitor: 'Monitor a website and alert me when it changes',
        schedule: 'Schedule a weekly report and send it to my team',
      }
      setInput(prompts[id])
      focusComposer()
    },
    [focusComposer, setInput],
  )

  const isActiveLoadingRef = useRef(isActiveLoading)
  useEffect(() => {
    isActiveLoadingRef.current = isActiveLoading
  }, [isActiveLoading])

  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey

      if (meta && e.shiftKey && (e.key === '/' || e.key === '?')) {
        e.preventDefault()
        setShowModelPicker((v) => !v)
        return
      }

      if (meta && e.shiftKey && e.key === '.') {
        if (isActiveLoadingRef.current) return
        e.preventDefault()
        setGenerationMode((prev) => {
          const order: GenerationMode[] = ['text', 'image', 'video']
          const i = order.indexOf(prev)
          const next = order[(i + 1) % order.length]!
          safeSetLocalStorage(CHAT_GEN_MODE_KEY, next)
          return next
        })
        setGenerationChip(null)
        return
      }

      if (e.key === '/' && !meta && !e.altKey && !e.shiftKey) {
        const t = e.target as HTMLElement | null
        if (!t) return
        const editorEl = textareaRef.current?.getElement?.()
        if (editorEl && (t === editorEl || editorEl.contains(t))) return
        if (t.closest('input, textarea, select, [contenteditable="true"]')) return
        e.preventDefault()
        textareaRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true)
  }, [setGenerationChip, setGenerationMode, setShowModelPicker, textareaRef])

  const handleSendRef = useRef(effectiveHandleSend)
  useEffect(() => {
    handleSendRef.current = effectiveHandleSend
  }, [effectiveHandleSend])

  const handleCreateAutomationDraftViaChat = useCallback(async () => {
    if (isActiveLoadingRef.current) return
    setDraftModalState(null)
    setGenerationMode('text')
    setGenerationChip(null)
    setInput('Create automation')
    await new Promise<void>((resolve) => {
      window.setTimeout(() => {
        void handleSendRef.current().finally(resolve)
      }, 0)
    })
  }, [setDraftModalState, setGenerationChip, setGenerationMode, setInput])

  // Auto-continue: when the latest assistant message contains a timeout sentinel
  // and the user has enabled auto-continue, automatically send "continue".
  useEffect(() => {
    if (!autoContinueEnabled || !activeChatId) return
    const latestAssistantMsg = [...primaryMessages].reverse().find((m) => {
      const um = m as unknown as { role?: string }
      return um.role === 'assistant'
    })
    if (!latestAssistantMsg) return
    const msgId = (latestAssistantMsg as unknown as { id?: string }).id
    if (!msgId || autoContinuedForMessageRef.current.has(msgId)) return

    const text = assistantBlocksToPlainText(
      buildAssistantVisualSequence(
        (latestAssistantMsg as unknown as { parts?: unknown[] }).parts,
      ),
    )
    if (!/\[Request timed out after \d+s\. Continue\?\]/.test(text)) return
    if ((latestAssistantMsg as unknown as { status?: string }).status !== 'completed') return

    autoContinuedForMessageRef.current.add(msgId)
    const timer = setTimeout(() => {
      setInput('continue')
      void handleSendRef.current()
    }, 1000)
    return () => clearTimeout(timer)
  }, [autoContinueEnabled, activeChatId, primaryMessages, setInput])

  // Reset auto-continue tracking when switching chats.
  useEffect(() => {
    autoContinuedForMessageRef.current.clear()
  }, [activeChatId])

  return {
    effectiveHandleSend,
    focusComposer,
    handlePersonalChatModeChange,
    handleGenerationModeChange,
    handleGenerationChipChange,
    handleEmptySuggestion,
    handleAutomateSuggestion,
    handleCreateAutomationDraftViaChat,
  }
}
