'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ChannelSummary, ConversationParticipant, ConversationPin, ConversationPresence, ConversationSavedMessage, MessageReaction } from '@overlay/workspace-contracts'
import type { RoomPanelKind } from './RoomSidePanels'
import type { SendMessage } from '../DirectMessageExperience.hooks'
import { useRoomThreadSelection } from './NativeRoomScope'
import { useRoomChannelLookup } from './native-room-adapters'
import { useRoomApi, useRoomThreadSource, useRoomCollaborationSource } from './room-state-adapters'

function requireArray<T>(value: T[] | undefined, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} were not returned`)
  return value
}

export function useThreadPanel({
  conversationId,

  setRoomPanel,
}: {
  conversationId: string

  setRoomPanel: Dispatch<SetStateAction<RoomPanelKind | null>>
}) {
  const api = useRoomApi(conversationId)
  const [threadRootId, setThreadRootId] = useRoomThreadSelection(useState<string | null>(null))
  const [threadFollowing, setThreadFollowing] = useState(false)
  const [threadInput, setThreadInputState] = useState('')
  const threadInputRef = useRef(threadInput)
  const threadInputVersionRef = useRef(0)
  const threadScopeRef = useRef({ conversationId, threadRootId })
  useLayoutEffect(() => {
    threadScopeRef.current = { conversationId, threadRootId }
  }, [conversationId, threadRootId])
  const setThreadInput = useCallback((value: string) => {
    if (value !== threadInputRef.current) threadInputVersionRef.current += 1
    threadInputRef.current = value
    setThreadInputState(value)
  }, [])
  const submitThreadMessage = useCallback(async ({ sendMessage, threadRootMessageId }: {
    sendMessage: SendMessage
    threadRootMessageId: string
  }) => {
    const scope = threadScopeRef.current
    if (scope.conversationId !== conversationId || scope.threadRootId !== threadRootMessageId) return
    const text = threadInputRef.current
    const version = threadInputVersionRef.current
    const submitted: { clearedVersion: number | null } = { clearedVersion: null }
    const clearSubmittedInput = () => {
      if (submitted.clearedVersion !== null || threadScopeRef.current !== scope
          || threadInputVersionRef.current !== version || threadInputRef.current !== text) return
      setThreadInput('')
      submitted.clearedVersion = threadInputVersionRef.current
    }
    const result = await sendMessage(text, {
      threadRootMessageId, requireCurrentThread: true, onSubmitted: clearSubmittedInput,
    })
    if (result.accepted) clearSubmittedInput()
    else if (submitted.clearedVersion !== null && threadScopeRef.current === scope
        && threadInputVersionRef.current === submitted.clearedVersion) setThreadInput(text)
  }, [conversationId, setThreadInput])

  useEffect(() => {
    if (!threadRootId) {
      queueMicrotask(() => setThreadFollowing(false))
      return
    }
    let cancelled = false
    void api.threadFollow(conversationId, threadRootId)
      .then((result) => {
        if (!cancelled) setThreadFollowing(result.following)
      })
      .catch(() => {
        if (!cancelled) setThreadFollowing(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, conversationId, threadRootId])

  const toggleThreadFollow = useCallback(() => {
    if (!threadRootId) return
    const next = !threadFollowing
    setThreadFollowing(next)
    void api.setThreadFollow(conversationId, threadRootId, next)
      .then((result) => setThreadFollowing(result.followed))
      .catch(() => setThreadFollowing(!next))
  }, [api, conversationId, threadFollowing, threadRootId])

  const openThread = useCallback((messageId: string) => {
    setThreadRootId(messageId)
    setRoomPanel('thread')
  }, [setRoomPanel, setThreadRootId])

  return useRoomThreadSource({
    threadRootId,
    setThreadRootId,
    threadFollowing,
    threadInput,
    setThreadInput,
    submitThreadMessage,
    toggleThreadFollow,
    openThread,
  })
}

export function useRoomRoster({
  conversationId,


  noteParticipantsLoaded,
}: {
  conversationId: string


  noteParticipantsLoaded: (participants: ConversationParticipant[], principalId: string) => void
}) {
  const api = useRoomApi(conversationId)
  const [participants, setParticipants] = useState<ConversationParticipant[]>(
    [],
  )
  const [currentPrincipalId, setCurrentPrincipalId] = useState(
    '',
  )
  const [presence, setPresence] = useState<ConversationPresence[]>(
    [],
  )
  const participantsRequest = useRef(0)
  const applyConvexPresence = useCallback((next: ConversationPresence[]) => {
    setPresence(next)
  }, [])

  const loadParticipants = useCallback(async () => {
    const requestId = ++participantsRequest.current
    const result = await api.participants(conversationId)
    if (requestId !== participantsRequest.current) return
    const nextParticipants = requireArray(result.participants, 'Conversation participants')
    if (typeof result.currentPrincipalId !== 'string' || !result.currentPrincipalId) {
      throw new Error('Conversation participants returned an invalid principal')
    }
    setParticipants(nextParticipants)
    setCurrentPrincipalId(result.currentPrincipalId)
    noteParticipantsLoaded(nextParticipants, result.currentPrincipalId)
  }, [api, conversationId, noteParticipantsLoaded])

  useEffect(() => {
    const invalidate = () => { participantsRequest.current += 1 }
    const reloadIdentity = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      if (!workspaceId || participants.some((participant) => participant.workspaceId === workspaceId)) {
        void loadParticipants()
      }
    }
    window.addEventListener('overlay:identity-updated', reloadIdentity)
    return () => {
      window.removeEventListener('overlay:identity-updated', reloadIdentity)
      invalidate()
    }
  }, [loadParticipants, participants])

  const loadPresence = useCallback(async () => {
    const result = await api.presence(conversationId)
    setPresence(requireArray(result.presence, 'Conversation presence'))
  }, [api, conversationId])

  return {
    participants,
    currentPrincipalId,
    presence,
    applyConvexPresence,
    loadParticipants,
    loadPresence,
  }
}

export function useRoomCollaboration({
  conversationId,
  conversationType,

}: {
  conversationId: string
  conversationType: 'dm' | 'channel'

}) {
  const api = useRoomApi(conversationId)
  const [channel, setChannel] = useState<ChannelSummary | null>(null)
  const [reactions, setReactions] = useState<MessageReaction[]>([])
  const [pins, setPins] = useState<ConversationPin[]>([])
  const [savedMessages, setSavedMessages] = useState<ConversationSavedMessage[]>([])
  const channelsForRoom = useRoomChannelLookup(conversationId)

  const loadCollaboration = useCallback(async () => {
    const [reactionResult, pinResult, savedResult, channelResult] = await Promise.all([
      api.reactions(conversationId),
      api.pins(conversationId),
      api.savedMessages(),
      conversationType === 'channel' ? channelsForRoom() : Promise.resolve({ channels: [] }),
    ])
    setReactions(requireArray(reactionResult.reactions, 'Conversation reactions'))
    setPins(requireArray(pinResult.pins, 'Conversation pins'))
    setSavedMessages(requireArray(savedResult.savedMessages, 'Saved messages'))
    if (conversationType === 'channel') {
      const channels = requireArray(channelResult.channels, 'Workspace channels')
      setChannel(channels.find((item) => item.conversationId === conversationId) ?? null)
    }
  }, [api, channelsForRoom, conversationId, conversationType])

  return useRoomCollaborationSource({
    channel,
    reactions,
    setReactions,
    pins,
    setPins,
    savedMessages,
    setSavedMessages,
    loadCollaboration,
  })
}
