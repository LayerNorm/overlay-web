'use client'

import { createContext, useContext } from 'react'

/** The parts of a room message that panels beside the transcript read. */
export type RoomTranscriptMessage = {
  id: string
  authorKind: string
  createdAt: number
  status?: 'generating' | 'completed' | 'error'
  parts?: unknown[]
  agentPlan?: ReadonlyArray<{ id: string; title: string; status: string }>
}

const RoomTranscriptContext = createContext<readonly RoomTranscriptMessage[]>([])

/** The open room's loaded messages, for panels rendered beside the transcript (an agent thread's Progress or Terminal). */
export const RoomTranscriptProvider = RoomTranscriptContext.Provider

export function useRoomTranscript(): readonly RoomTranscriptMessage[] {
  return useContext(RoomTranscriptContext)
}
