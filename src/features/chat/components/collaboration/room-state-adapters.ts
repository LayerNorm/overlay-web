'use client'

import { useMemo } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchChatArchived, dispatchChatModified } from '@/shared/chat/chat-title'
import { useNativeRoomMetadata } from './NativeRoomState'
import { toast } from '@overlay/ui/primitives'
import { useNativeCollaboration } from './NativeCollaborationProvider'
import type { RoomAction } from '@/components/providers/native-room-state-client'
import { useNativeRoomStateClient } from '@/components/providers/native-room-state-client'
import { useNativeRoomSession } from './NativeRoomScope'
import { nativeRoomChannel } from './native-room-adapters'
import { useNativeActivity } from '@/components/providers/native-activity-context'

export function useRoomEvents() {
  const native = useNativeRoomMetadata()
  const scope = useNativeCollaboration()
  return native ? { archived() {}, modified() {}, navigationOwner() {
    const key = () => window.location.pathname + window.location.search
    const origin = key()
    return () => Boolean(scope.isCurrentScope?.()) && key() === origin
  } } : { archived: dispatchChatArchived, modified: dispatchChatModified, navigationOwner: () => () => true }
}

export function useRoomApi(conversationId: string) {
  const native = useNativeRoomMetadata()
  const activity = useNativeActivity()
  const legacy = overlayAppClient.conversations
  return useMemo(() => {
  if (!native) return legacy
  const overrides = {
    participants: async () => ({ participants: native.snapshot?.participants ?? [], currentPrincipalId: native.snapshot?.viewerPrincipalId ?? '' }),
    presence: async () => ({ presence: native.presence }),
    reactions: async () => ({ reactions: native.snapshot?.reactions ?? [] }),
    pins: async () => ({ pins: native.snapshot?.pins ?? [] }),
    savedMessages: async () => ({ savedMessages: native.snapshot?.savedMessages ?? [] }),
    threadFollow: async (_id: string, root: string) => ({ following: Boolean(native.snapshot?.follows.some(row => row.threadRootMessageId === root)),
      follows: native.snapshot?.follows.filter(row => row.threadRootMessageId === root) ?? [] }),
    async setReaction(_id: string, args: { messageId: string; emoji: string; enabled: boolean }) {
      await native.act({ kind: 'setReaction', ...args }); return { reactions: native.snapshot?.reactions ?? [] }
    },
    async setPinned(_id: string, args: { messageId: string; pinned: boolean }) { await native.act({ kind: 'setPinned', ...args }); return { pinned: args.pinned } },
    async setSaved(args: { messageId: string; saved: boolean }) { await native.act({ kind: 'setSaved', ...args }); return { saved: args.saved } },
    async setThreadFollow(_id: string, threadRootMessageId: string, followed: boolean) { await native.act({ kind: 'setThreadFollow', threadRootMessageId, followed }); return { followed } },
    async updateParticipantState(_id: string, args: Parameters<typeof legacy.updateParticipantState>[1]) {
      const participant = native.snapshot?.participants.find(row => row.principalId === native.snapshot?.viewerPrincipalId)
      if (!participant) throw new Error('Room metadata is loading')
      if (args.notificationLevel) await native.act({ kind: 'setNotificationLevel', notificationLevel: args.notificationLevel })
      if (args.archived !== undefined) await native.act({ kind: 'setRoomArchived', archived: args.archived, scope: args.archiveScope ?? 'self' })
      if (args.markUnread || (args.markRead && args.readSequence === undefined)) throw new Error('Use the observed room read boundary')
      if (args.readSequence !== undefined) {
        if (!activity) throw new Error('Native read state is unavailable')
        await activity.markRoom(conversationId, args.readSequence)
      }
      return { participant }
    },
  } satisfies Partial<typeof legacy>
  return new Proxy(legacy, { get(target, key) {
    if (key in overrides) return overrides[key as keyof typeof overrides]
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  }, [activity, conversationId, legacy, native])
}

export function useRoomPresenceWriter(conversationId: string) {
  const owner = useNativeRoomMetadata()
  const native = useNativeRoomStateClient()
  return (payload: Parameters<typeof native.heartbeat>[1]) => {
    if (owner) return owner.heartbeat(payload)
    if (native.enabled) return native.heartbeat(conversationId, payload)
    return overlayAppClient.conversations.updatePresence(conversationId, payload)
  }
}

export function useRoomParticipantWriter() {
  const native = useNativeRoomStateClient()
  const owner = useNativeRoomMetadata()
  return (conversationId: string, principalId: string) => {
    const action = { kind: 'addParticipant' as const, principalId }
    if (owner?.snapshot?.conversationId === conversationId) return owner.act(action)
    if (native.enabled) return native.act(conversationId, action)
    return overlayAppClient.conversations.addParticipant(conversationId, principalId)
  }
}

export function useRoomCollaborationSource<T extends { channel: unknown; reactions: unknown; pins: unknown; savedMessages: unknown }>(legacy: T): T {
  const native = useNativeRoomMetadata()
  const session = useNativeRoomSession()
  return native ? { ...legacy, channel: nativeRoomChannel(session?.room), reactions: native.snapshot?.reactions ?? [], pins: native.snapshot?.pins ?? [], savedMessages: native.snapshot?.savedMessages ?? [] } : legacy
}

export function useRoomThreadSource<T extends { threadRootId: string | null; threadFollowing: boolean; toggleThreadFollow(): void }>(legacy: T): T {
  const native = useNativeRoomMetadata()
  if (!native) return legacy
  const following = Boolean(native.snapshot?.follows.some(row => row.threadRootMessageId === legacy.threadRootId))
  return { ...legacy, threadFollowing: following, toggleThreadFollow() {
    if (legacy.threadRootId) void native.act({ kind: 'setThreadFollow', threadRootMessageId: legacy.threadRootId, followed: !following })
      .catch(error => toast.error(error instanceof Error ? error.message : 'Could not update thread follow'))
  } }
}

export function useRoomMessageActionsSource<T extends { toggleReaction(id: string, emoji: string): Promise<void>; togglePinned(id: string): Promise<void>; toggleSaved(id: string): Promise<void> }>(legacy: T): T {
  const native = useNativeRoomMetadata()
  if (!native) return legacy
  const run = async (action: RoomAction) => {
    try { await native.act(action) } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update this message') }
  }
  return { ...legacy,
    toggleReaction: (messageId: string, emoji: string) => run({ kind: 'setReaction', messageId, emoji,
      enabled: !native.snapshot?.reactions.some(row => row.messageId === messageId && row.emoji === emoji && row.reactedByCurrentPrincipal) }),
    togglePinned: (messageId: string) => run({ kind: 'setPinned', messageId, pinned: !native.snapshot?.pins.some(row => row.messageId === messageId) }),
    toggleSaved: (messageId: string) => run({ kind: 'setSaved', messageId, saved: !native.snapshot?.savedMessages.some(row => row.messageId === messageId) }),
  }
}
