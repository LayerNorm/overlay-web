'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@overlay/ui/primitives'
import { sanitizeChatTitle } from '@/shared/chat/chat-title'
import { generateTitle, prefetchTitle } from '@/features/chat/lib/generate-title'
import { DEFAULT_CHAT_TITLE } from '../chat-interface/constants'
import { persistNativeChatTitle } from '@/features/chat/lib/persist-native-chat-title'
import type { PersonalChatSummary } from '@/components/providers/PersonalChatProvider'

export function useChatTitleController({
  activeChatId,
  getNativeSummary,
  renameNative,
  titleGenerationEnabled,
}: {
  activeChatId: string | null
  getNativeSummary: (chatId: string) => Pick<PersonalChatSummary, 'title'> | undefined
  renameNative: (chatId: string, title: string) => Promise<void>
  titleGenerationEnabled: boolean
}) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingChatTitle, setEditingChatTitle] = useState('')
  const headerTitleInputRef = useRef<HTMLInputElement>(null)

  const beginHeaderChatRename = useCallback(() => {
    if (!activeChatId) return
    setEditingChatId(activeChatId)
    setEditingChatTitle(getNativeSummary(activeChatId)?.title ?? DEFAULT_CHAT_TITLE)
  }, [activeChatId, getNativeSummary])

  useEffect(() => {
    if (!activeChatId || editingChatId !== activeChatId) return
    const input = headerTitleInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [activeChatId, editingChatId])

  const cancelChatRename = useCallback(() => {
    setEditingChatId(null)
    setEditingChatTitle('')
  }, [])

  const [renameChatId, setRenameChatId] = useState(activeChatId)
  if (renameChatId !== activeChatId) {
    setRenameChatId(activeChatId)
    cancelChatRename()
  }

  const commitChatRename = useCallback(async (chatId: string) => {
    const previousTitle = getNativeSummary(chatId)?.title ?? DEFAULT_CHAT_TITLE
    const nextTitle = sanitizeChatTitle(editingChatTitle, previousTitle)
    cancelChatRename()
    if (nextTitle === previousTitle) return
    const persisted = await persistNativeChatTitle(renameNative, chatId, nextTitle)
    if (!persisted) toast.error('Could not rename chat.')
  }, [cancelChatRename, editingChatTitle, getNativeSummary, renameNative])

  /**
   * Fire the title request alongside the first message instead of waiting for
   * the conversation to exist. A long agent run would otherwise leave the chat
   * named "New Chat" for its whole duration.
   *
   * The resolved title is shown on the open conversation right away; the chat
   * row and the server update follow once the conversation id arrives.
   */
  const prefetchFirstMessageTitle = useCallback((seedText: string) => {
    if (titleGenerationEnabled) prefetchTitle(seedText)
  }, [titleGenerationEnabled])

  const startFirstMessageRename = useCallback((chatId: string, text: string) => {
    if (!titleGenerationEnabled) return
    // Resolves from the prefetched request when the seed matches.
    void generateTitle(text).then(async (aiTitle) => {
      if (aiTitle) await persistNativeChatTitle(renameNative, chatId, sanitizeChatTitle(aiTitle, DEFAULT_CHAT_TITLE))
    })
  }, [renameNative, titleGenerationEnabled])

  return {
    beginHeaderChatRename,
    cancelChatRename,
    commitChatRename,
    editingChatId,
    editingChatTitle,
    headerTitleInputRef,
    prefetchFirstMessageTitle,
    setEditingChatTitle,
    startFirstMessageRename,
  }
}
