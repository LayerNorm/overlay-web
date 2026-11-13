'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { PersistedFileReference } from '@overlay/chat-core'
import type { AttachmentPreviewOpenOptions } from '@overlay/chat-react'

type ConversationFilePreviewApi = {
  openFilePreview: (
    reference: PersistedFileReference,
    options?: AttachmentPreviewOpenOptions,
  ) => void
}

const ConversationFilePreviewContext = createContext<ConversationFilePreviewApi | null>(null)

export function ConversationFilePreviewProvider({
  openFilePreview,
  children,
}: ConversationFilePreviewApi & { children: ReactNode }) {
  const value = useMemo(() => ({ openFilePreview }), [openFilePreview])
  return (
    <ConversationFilePreviewContext.Provider value={value}>
      {children}
    </ConversationFilePreviewContext.Provider>
  )
}

export function useConversationFilePreview() {
  return useContext(ConversationFilePreviewContext)
}
