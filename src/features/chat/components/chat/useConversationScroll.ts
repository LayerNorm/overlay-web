'use client'

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { MutableRefObject, RefObject } from 'react'
import type { useChatRuntimes } from './useChatRuntimes'

type Runtimes = ReturnType<typeof useChatRuntimes>

export function useConversationBottomVisibility({
  messagesScrollRef,
  messagesEndRef,
  activeChatId,
  actChat,
  chat0,
  chat1,
  chat2,
  chat3,
  isActiveLoading,
  isOptimisticLoading,
  runtimeHydrationVersion,
  isTemporaryChat,
  showAutomationChatTab,
}: {
  messagesScrollRef: RefObject<HTMLDivElement | null>
  messagesEndRef: RefObject<HTMLDivElement | null>
  activeChatId: string | null
  actChat: Runtimes['actChat']
  chat0: Runtimes['chat0']
  chat1: Runtimes['chat1']
  chat2: Runtimes['chat2']
  chat3: Runtimes['chat3']
  isActiveLoading: boolean
  isOptimisticLoading: boolean
  runtimeHydrationVersion: number
  isTemporaryChat: boolean
  showAutomationChatTab: boolean
}) {
  const [isConversationBottomVisible, setIsConversationBottomVisible] = useState(true)

  const updateConversationBottomVisibility = useCallback(() => {
    const container = messagesScrollRef.current
    const endMarker = messagesEndRef.current
    if (!container || !endMarker) {
      setIsConversationBottomVisible(true)
      return
    }
    const containerRect = container.getBoundingClientRect()
    const markerRect = endMarker.getBoundingClientRect()
    const visible =
      markerRect.top <= containerRect.bottom + 24 &&
      markerRect.bottom >= containerRect.top - 24
    setIsConversationBottomVisible((current) => (current === visible ? current : visible))
  }, [messagesScrollRef, messagesEndRef])

  useEffect(() => {
    const container = messagesScrollRef.current
    if (!container) {
      const frame = window.requestAnimationFrame(() => setIsConversationBottomVisible(true))
      return () => window.cancelAnimationFrame(frame)
    }
    let frame = 0
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateConversationBottomVisibility()
      })
    }
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      container.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [
    activeChatId,
    isActiveLoading,
    isOptimisticLoading,
    isTemporaryChat,
    runtimeHydrationVersion,
    showAutomationChatTab,
    updateConversationBottomVisibility,
    messagesScrollRef,
  ])

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateConversationBottomVisibility)
    return () => window.cancelAnimationFrame(frame)
  }, [
    actChat.messages.length,
    chat0.messages.length,
    chat1.messages.length,
    chat2.messages.length,
    chat3.messages.length,
    isActiveLoading,
    isOptimisticLoading,
    runtimeHydrationVersion,
    updateConversationBottomVisibility,
  ])

  const scrollToConversationBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const endMarker = messagesEndRef.current
    if (endMarker) {
      endMarker.scrollIntoView({ behavior, block: 'end' })
      window.requestAnimationFrame(updateConversationBottomVisibility)
      return
    }
    const container = messagesScrollRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
    window.requestAnimationFrame(updateConversationBottomVisibility)
  }, [messagesEndRef, messagesScrollRef, updateConversationBottomVisibility])

  return { isConversationBottomVisible, scrollToConversationBottom }
}

export function usePendingTurnScroll({
  messagesScrollRef,
  pendingScrollTurnIdRef,
  pendingScrollChatIdRef,
  shouldScrollRef,
  activeChatId,
  chat0,
  actChat,
  exchangeModesLength,
  generationResultsSize,
  isActiveLoading,
  isOptimisticLoading,
  runtimeHydrationVersion,
  scrollToConversationBottom,
}: {
  messagesScrollRef: RefObject<HTMLDivElement | null>
  pendingScrollTurnIdRef: MutableRefObject<string | null>
  pendingScrollChatIdRef: MutableRefObject<string | null>
  shouldScrollRef: MutableRefObject<boolean>
  activeChatId: string | null
  chat0: Runtimes['chat0']
  actChat: Runtimes['actChat']
  exchangeModesLength: number
  generationResultsSize: number
  isActiveLoading: boolean
  isOptimisticLoading: boolean
  runtimeHydrationVersion: number
  scrollToConversationBottom(behavior?: ScrollBehavior): void
}) {
  useLayoutEffect(() => {
    const turnId = pendingScrollTurnIdRef.current
    if (!turnId || !messagesScrollRef.current) return
    const pendingChatId = pendingScrollChatIdRef.current
    if (pendingChatId && activeChatId !== pendingChatId) return
    const scrollFrame = window.requestAnimationFrame(() => {
      const container = messagesScrollRef.current
      if (!container || pendingScrollTurnIdRef.current !== turnId) return
      const target = container.querySelector<HTMLElement>(
        `[data-exchange-turn="${CSS.escape(turnId)}"]`,
      )
      if (!target) return
      // The shared transcript hook performs the single top-alignment. These
      // refs only suppress the older send-to-bottom path until the optimistic
      // exchange is mounted; streaming updates must never move the viewport.
      pendingScrollTurnIdRef.current = null
      pendingScrollChatIdRef.current = null
    })
    return () => window.cancelAnimationFrame(scrollFrame)
  }, [
    activeChatId,
    chat0.messages,
    actChat.messages,
    exchangeModesLength,
    generationResultsSize,
    isActiveLoading,
    isOptimisticLoading,
    runtimeHydrationVersion,
    messagesScrollRef,
    pendingScrollChatIdRef,
    pendingScrollTurnIdRef,
  ])

  useEffect(() => {
    if (shouldScrollRef.current) {
      if (pendingScrollTurnIdRef.current) {
        shouldScrollRef.current = false
        return
      }
      scrollToConversationBottom('smooth')
      shouldScrollRef.current = false
    }
  }, [chat0.messages.length, actChat.messages.length, scrollToConversationBottom, pendingScrollTurnIdRef, shouldScrollRef])
}
