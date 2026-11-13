'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { PersonalChatContextValue } from './PersonalChatProvider'

export type PersonalChatDirectoryValue = Pick<PersonalChatContextValue,
  'available' | 'workspaceId' | 'viewerUserId' | 'selectedConversationId' | 'selectedSummary'
  | 'active' | 'archived' | 'rename' | 'setArchived' | 'setRead'>

const DirectoryContext = createContext<PersonalChatDirectoryValue | null>(null)

export function PersonalChatDirectoryProvider({ value, children }: {
  value: PersonalChatDirectoryValue
  children: ReactNode
}) {
  const { available, workspaceId, viewerUserId, selectedConversationId, selectedSummary,
    active, archived, rename, setArchived, setRead } = value
  const directory = useMemo(() => ({
    available, workspaceId, viewerUserId, selectedConversationId, selectedSummary,
    active, archived, rename, setArchived, setRead,
  }), [available, workspaceId, viewerUserId, selectedConversationId, selectedSummary,
    active, archived, rename, setArchived, setRead])
  return <DirectoryContext.Provider value={directory}>{children}</DirectoryContext.Provider>
}

export function usePersonalChatDirectory() {
  const value = useContext(DirectoryContext)
  if (!value) throw new Error('PersonalChatProvider is required')
  return value
}
