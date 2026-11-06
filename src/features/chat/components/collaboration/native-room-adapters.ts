'use client'

import { useCallback } from 'react'
import type { ChannelSummary } from '@overlay/workspace-contracts'
import type { useRoomRoster } from '../DirectMessageExperience.hooks'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useNativeRoomSession } from './NativeRoomScope'
import { useNativeRoomMetadata } from './NativeRoomState'

const noLoad = async () => {}

export function nativeRoomChannel(room: NonNullable<ReturnType<typeof useNativeRoomSession>>['room']): ChannelSummary | null {
  if (!room || room.kind !== 'channel') return null
  return { conversationId: room.conversationId, workspaceId: room.workspaceId, name: room.title, slug: room.slug ?? '', topic: room.topic,
    visibility: room.visibility ?? 'private', participantCount: room.participants.length, createdAt: room.createdAt, updatedAt: room.updatedAt }
}

export function useRoomMessageWrites(conversationId: string) {
  const session = useNativeRoomSession()
  return session ?? {
    edit: (id: string, content: string) => overlayAppClient.conversations.editCollaborativeMessage(conversationId, id, content),
    remove: (id: string) => overlayAppClient.conversations.deleteCollaborativeMessage(conversationId, id),
  }
}

export function useRoomRosterSource(legacy: ReturnType<typeof useRoomRoster>): ReturnType<typeof useRoomRoster> {
  const session = useNativeRoomSession()
  const state = useNativeRoomMetadata()
  if (state) return { ...legacy, participants: state.snapshot?.participants ?? [], currentPrincipalId: state.snapshot?.viewerPrincipalId ?? '',
    presence: state.presence, loadParticipants: noLoad, loadPresence: noLoad, applyConvexPresence() {} }
  return session ? { ...legacy, participants: session.room?.participants ?? [],
    currentPrincipalId: session.room?.viewerPrincipalId ?? '', loadParticipants: noLoad } : legacy
}

export function useRoomChannelLookup(conversationId: string) {
  const session = useNativeRoomSession()
  const room = session?.room?.conversationId === conversationId ? session.room : undefined
  const enabled = Boolean(session)
  return useCallback(async (): Promise<{ channels: ChannelSummary[] }> => {
    if (!enabled) return overlayAppClient.conversations.channels()
    const channel = nativeRoomChannel(room)
    return { channels: channel ? [channel] : [] }
  }, [enabled, room])
}
