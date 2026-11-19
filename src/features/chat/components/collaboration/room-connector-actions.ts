'use client'

import { createContext, useContext } from 'react'
import type { GeneratedUiConnectorActions } from '@overlay/chat-react'

/**
 * Live connector state for agent replies in a room. The room loads it once, so
 * every "Connect <app>" card in the transcript shares one connected-app list
 * and flips to Connected together.
 */
export const RoomConnectorActionsContext = createContext<GeneratedUiConnectorActions | undefined>(undefined)

export function useRoomConnectorActions(): GeneratedUiConnectorActions | undefined {
  return useContext(RoomConnectorActionsContext)
}
