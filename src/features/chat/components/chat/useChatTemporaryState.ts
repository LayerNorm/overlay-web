'use client'

import { useEffect, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { TEMPORARY_CHAT_UI_EVENT } from '@/shared/chat/temporary-chat-ui'

export function useChatTemporaryState(): {
  isTemporaryChat: boolean
  setIsTemporaryChat: Dispatch<SetStateAction<boolean>>
  isTemporaryChatRef: MutableRefObject<boolean>
} {
  const [isTemporaryChat, setIsTemporaryChat] = useState(false)
  const isTemporaryChatRef = useRef(false)
  useEffect(() => {
    isTemporaryChatRef.current = isTemporaryChat
  }, [isTemporaryChat])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(TEMPORARY_CHAT_UI_EVENT, {
      detail: { active: isTemporaryChat },
    }))
  }, [isTemporaryChat])

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent(TEMPORARY_CHAT_UI_EVENT, {
        detail: { active: false },
      }))
    }
  }, [])

  return { isTemporaryChat, setIsTemporaryChat, isTemporaryChatRef }
}
