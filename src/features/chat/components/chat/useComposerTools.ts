'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  defaultChatToolRequestIds,
  defaultMemoryEnabled,
  type ChatToolRequestId,
} from '@/shared/chat/tool-requests'
import type { useChatAttachments } from '../useChatAttachments'

type AttachmentsApi = ReturnType<typeof useChatAttachments>

export function useComposerTools({
  setPendingChatDocuments,
  setAttachmentError,
  setComposerNotice,
}: {
  setPendingChatDocuments: AttachmentsApi['setPendingChatDocuments']
  setAttachmentError: AttachmentsApi['setAttachmentError']
  setComposerNotice: Dispatch<SetStateAction<string | null>>
}) {
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [selectedToolIds, setSelectedToolIds] = useState<ChatToolRequestId[]>(() =>
    defaultChatToolRequestIds({ temporary: false }),
  )
  const [memoryEnabled, setMemoryEnabled] = useState(() =>
    defaultMemoryEnabled({ temporary: false }),
  )
  const [replyContext, setReplyContext] = useState<{
    snippet: string
    bodyForModel: string
    replyToTurnId?: string
  } | null>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)

  const clearTransientComposerState = useCallback(() => {
    setPendingChatDocuments([])
    setReplyContext(null)
    setAttachmentError(null)
    setComposerNotice(null)
  }, [setAttachmentError, setPendingChatDocuments, setComposerNotice])
  const resetComposerToolIds = useCallback((temporary: boolean) => {
    setSelectedToolIds(defaultChatToolRequestIds({ temporary }))
    setMemoryEnabled(defaultMemoryEnabled({ temporary }))
  }, [])
  const toggleComposerTool = useCallback((toolId: ChatToolRequestId) => {
    if (toolId === 'memory') {
      setMemoryEnabled((current) => !current)
      return
    }
    setSelectedToolIds((current) =>
      current.includes(toolId)
        ? current.filter((id) => id !== toolId)
        : [...current, toolId],
    )
  }, [])
  const removeComposerTool = useCallback((toolId: ChatToolRequestId) => {
    setSelectedToolIds((current) => current.filter((id) => id !== toolId))
  }, [])

  useEffect(() => {
    if (!showAttachMenu) return
    function handleOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node))
        setShowAttachMenu(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showAttachMenu])

  useEffect(() => {
    if (!showModeMenu) return
    function handleOutside(e: MouseEvent) {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node))
        setShowModeMenu(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showModeMenu])

  return {
    showAttachMenu,
    setShowAttachMenu,
    showModeMenu,
    setShowModeMenu,
    selectedToolIds,
    setSelectedToolIds,
    memoryEnabled,
    setMemoryEnabled,
    replyContext,
    setReplyContext,
    attachMenuRef,
    modeMenuRef,
    clearTransientComposerState,
    resetComposerToolIds,
    toggleComposerTool,
    removeComposerTool,
  }
}
