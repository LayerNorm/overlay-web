'use client'

import { createContext, useContext } from 'react'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'

export type NativeNotification = FunctionReturnType<typeof api.collaboration.nativeActivity.listNotifications>['page'][number]
export type UnreadCounts = FunctionReturnType<typeof api.collaboration.nativeActivity.getUnreadCounts>
export type ReadAction = { id: string; at: number } & (
  { kind: 'ids'; ids: string[]; through: number } | { kind: 'all'; through: number } | { kind: 'room'; conversationId: string; sequence: number })
export type NativeActivity = {
  status: 'disabled' | 'loading' | 'ready' | 'unavailable'
  notifications: NativeNotification[]; ready: boolean; counts: UnreadCounts | null; hasMore: boolean; loadingMore: boolean
  loadMore(): void
  mark(ids: string[], observedThrough: number): Promise<void>
  markAll(observedThrough: number): Promise<void>
  markRoom(conversationId: string, sequence: number): Promise<void>
  readSequence(conversationId: string, stored: number): number
}
export const NativeActivityContext = createContext<NativeActivity | null>(null)
export const useNativeActivity = () => useContext(NativeActivityContext)
