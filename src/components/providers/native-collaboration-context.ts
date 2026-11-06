'use client'

import { createContext, useContext } from 'react'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'

export type NativeCollaborationStatus = 'disabled' | 'loading' | 'ready' | 'unavailable'
export type NativeRoomSummary = FunctionReturnType<typeof api.collaboration.nativeRooms.listRooms>['page'][number]
export type NativeRoomList = { rows: NativeRoomSummary[]; hasMore: boolean; loadingMore: boolean; loadMore(): void }
export type NativeCollaborationValue = {
  status: NativeCollaborationStatus
  workspaceId: string | null
  scopeKey: string
  viewerUserId: string | null
  direct: NativeRoomList
  channels: NativeRoomList
  archivedDirect: NativeRoomList
  archivedChannels: NativeRoomList
  createDirectMessage(args: FunctionArgs<typeof api.collaboration.nativeRooms.createDirectMessage>): Promise<{ conversationId: string; title: string; agentId?: string }>
  createChannel(args: FunctionArgs<typeof api.collaboration.nativeRooms.createChannel>): Promise<{ conversationId: string; name: string }>
}
export const nativeCollaborationUnavailable = async (): Promise<never> => { throw new Error('Native collaboration is unavailable') }
const emptyList: NativeRoomList = { rows: [], hasMore: false, loadingMore: false, loadMore() {} }
export const emptyNativeCollaboration: NativeCollaborationValue = {
  status: 'disabled', workspaceId: null, scopeKey: '', viewerUserId: null, direct: emptyList, channels: emptyList,
  archivedDirect: emptyList, archivedChannels: emptyList, createDirectMessage: nativeCollaborationUnavailable, createChannel: nativeCollaborationUnavailable,
}
export const NativeCollaborationContext = createContext<NativeCollaborationValue>(emptyNativeCollaboration)
export const useNativeCollaboration = () => useContext(NativeCollaborationContext)
