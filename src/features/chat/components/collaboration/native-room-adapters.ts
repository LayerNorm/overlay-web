'use client'

import { useCallback } from 'react'
import type { ChannelSummary } from '@overlay/workspace-contracts'
import type { useRoomRoster } from '../DirectMessageExperience.hooks'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useNativeRoomSession } from './NativeRoomScope'

const noLoad = async () => {}

export function useRoomMessageWrites(conversationId: string) {
  const session = useNativeRoomSession()
  return session ?? {
    edit: (id: string, content: string) => overlayAppClient.conversations.editCollaborativeMessage(conversationId, id, content),
    remove: (id: string) => overlayAppClient.conversations.deleteCollaborativeMessage(conversationId, id),
  }
}

export function useRoomRosterSource(legacy: ReturnType<typeof useRoomRoster>): ReturnType<typeof useRoomRoster> {
  const session = useNativeRoomSession()
  return session ? { ...legacy, participants: session.room?.participants ?? [],
    currentPrincipalId: session.room?.viewerPrincipalId ?? '', loadParticipants: noLoad } : legacy
}

export function useRoomChannelLookup(conversationId: string) {
  const session = useNativeRoomSession()
  const room = session?.room
  const enabled = Boolean(session)
  return useCallback(async (): Promise<{ channels: ChannelSummary[] }> => {
    if (!enabled) return overlayAppClient.conversations.channels()
    if (!room || room.kind !== 'channel') return { channels: [] }
    return { channels: [{ conversationId, workspaceId: room.workspaceId, name: room.title, slug: room.slug ?? '',
      topic: room.topic, visibility: room.visibility ?? 'private', participantCount: room.participants.length,
      createdAt: room.createdAt, updatedAt: room.updatedAt }] }
  }, [conversationId, enabled, room])
}
