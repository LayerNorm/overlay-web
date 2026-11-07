'use client'

import { useCallback } from 'react'
import { useConvex, useMutation } from 'convex/react'
import type { FunctionArgs } from 'convex/server'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

type GeneratedUiInput = { conversationId: string; messageId: string; partId: string; data: GeneratedUiData }

function generatedUiArgs(workspaceId: string | null, args: GeneratedUiInput) {
  if (!workspaceId) throw new Error('Native personal chat is unavailable')
  return {
    workspaceId,
    conversationId: args.conversationId as Id<'conversations'>,
    messageId: args.messageId as Id<'conversationMessages'>,
    partId: args.partId,
    data: args.data as FunctionArgs<typeof api.chat.personal.setGeneratedUi>['data'],
  }
}

export function usePersonalChatCommands(workspaceId: string | null) {
  const client = useConvex()
  const deleteTurnMutation = useMutation(api.chat.personal.deleteTurn)
  const branchMutation = useMutation(api.chat.personal.branch)
  const generatedUiMutation = useMutation(api.chat.personal.setGeneratedUi)
  const noteMutation = useMutation(api.chat.personal.addAssistantNote)
  const deleteTurn = async (args: FunctionArgs<typeof api.chat.personal.deleteTurn>) => {
    await deleteTurnMutation(args)
  }
  const branch = (args: FunctionArgs<typeof api.chat.personal.branch>): Promise<string> => branchMutation(args)
  const setGeneratedUi = useCallback(async (args: GeneratedUiInput) => {
    await generatedUiMutation(generatedUiArgs(workspaceId, args))
  }, [generatedUiMutation, workspaceId])
  const addAssistantNote = useCallback(async (conversationId: string, turnId: string, text: string) => {
    if (!workspaceId) return
    await noteMutation({ workspaceId, conversationId: conversationId as Id<'conversations'>, turnId, text })
  }, [noteMutation, workspaceId])
  const findRecentChat = useCallback(async (scope: 'personal' | 'workspace'): Promise<string | null> => {
    if (!workspaceId) return null
    const result = await client.query(api.chat.personal.list, {
      workspaceId, archived: false, scope, paginationOpts: { numItems: 10, cursor: null },
    })
    return result.page[0]?._id ?? null
  }, [client, workspaceId])
  return { deleteTurn, branch, setGeneratedUi, addAssistantNote, findRecentChat }
}

export type PersonalChatCommands = ReturnType<typeof usePersonalChatCommands>
