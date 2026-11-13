'use client'

import { useCallback, useMemo } from 'react'
import { useMutation as useConvexMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { updatePersonalChatList } from './personal-chat-store'
import { updatePersonalChatUnread } from './personal-chat-optimistic'

type PersonalChatSummary = NonNullable<FunctionReturnType<typeof api.chat.personal.getSummary>>

export function usePersonalChatDirectoryActions(workspaceId: string | null) {
  const renameMutationBase = useConvexMutation(api.chat.personal.rename)
  const renameMutation = useMemo(() => renameMutationBase.withOptimisticUpdate((store, args) => {
    const update = (row: PersonalChatSummary) => ({
      ...row,
      title: args.title,
      lastModified: Date.now(),
    })
    for (const archived of [false, true]) {
      updatePersonalChatList(store, args.workspaceId, archived, args.conversationId, update)
    }
    const queryArgs = { workspaceId: args.workspaceId, conversationId: args.conversationId }
    const summary = store.getQuery(api.chat.personal.getSummary, queryArgs)
    if (summary) store.setQuery(api.chat.personal.getSummary, queryArgs, update(summary))
  }), [renameMutationBase])
  const readMutationBase = useConvexMutation(api.chat.personal.setRead)
  const readMutation = useMemo(() => readMutationBase.withOptimisticUpdate((store, args) => {
    const update = (row: PersonalChatSummary) => updatePersonalChatUnread(
      row,
      args.unread,
      args.throughMessageId ? String(args.throughMessageId) : undefined,
    )
    for (const archived of [false, true]) {
      updatePersonalChatList(store, args.workspaceId, archived, args.conversationId, update)
    }
    const queryArgs = { workspaceId: args.workspaceId, conversationId: args.conversationId }
    const summary = store.getQuery(api.chat.personal.getSummary, queryArgs)
    if (summary) store.setQuery(api.chat.personal.getSummary, queryArgs, update(summary))
  }), [readMutationBase])

  const rename = useCallback(async (conversationId: string, title: string) => {
    if (!workspaceId) throw new Error('Native personal chat is unavailable')
    await renameMutation({
      workspaceId,
      conversationId: conversationId as Id<'conversations'>,
      title,
    })
  }, [renameMutation, workspaceId])

  const setRead = useCallback(async (
    summary: PersonalChatSummary,
    unread: boolean,
    throughMessageId?: Id<'conversationMessages'>,
  ) => {
    await readMutation({
      workspaceId: summary.workspaceId,
      conversationId: summary._id,
      unread,
      ...(throughMessageId ? { throughMessageId } : {}),
    })
  }, [readMutation])

  return { rename, setRead }
}
