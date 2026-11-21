'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMutation } from 'convex/react'
import { toast } from '@overlay/ui/primitives'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useLocalThreadOwner, useLocalThreadsBridge } from '@/components/desktop/useLocalThreads'
import { newPrivateThreadId } from '@/shared/agents/private-threads'

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message.replace(/^.*ConvexError: /, '').split('\n')[0] || fallback : fallback

/**
 * Cloud sync is chosen before a thread's first message. Switching swaps the empty thread for an empty thread of the
 * other kind with the same agent and folder, then removes the one left behind; nothing has been said in either yet.
 */
export function usePrivateThreadSwitch(workspaceId: string | null | undefined) {
  const bridge = useLocalThreadsBridge()
  const owner = useLocalThreadOwner(workspaceId)
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const createSynced = useMutation(api.agents.threads.create)
  const setWork = useMutation(api.agents.threadWork.set)
  const removeSynced = useMutation(api.agents.threads.remove)
  const [switching, setSwitching] = useState(false)
  // Read through a ref so the callbacks stay stable while a switch runs.
  const busy = useRef(false)

  const open = useCallback((conversationId: string) => {
    const params = new URLSearchParams(search?.toString() ?? '')
    params.set('id', conversationId)
    router.replace(`${pathname}?${params.toString()}`)
  }, [pathname, router, search])

  /** A new synced thread on this computer becomes a private one. */
  const makePrivate = useCallback(async (args: { agentId: string; conversationId: string; folder: string | null }) => {
    if (!bridge || !owner || !workspaceId || busy.current) return
    busy.current = true
    setSwitching(true)
    try {
      const threadId = newPrivateThreadId()
      await bridge.call('localThreads.create', { owner, threadId, agentId: args.agentId, folder: args.folder })
      open(threadId)
      void removeSynced({ workspaceId, agentId: args.agentId, conversationId: args.conversationId as Id<'conversations'> }).catch(() => undefined)
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t start a thread on this computer.'))
    } finally {
      busy.current = false
      setSwitching(false)
    }
  }, [bridge, open, owner, removeSynced, workspaceId])

  /** A new private thread becomes a synced thread on this computer. */
  const makeSynced = useCallback(async (args: { agentId: string; threadId: string; folder: string | null; environmentId: string | null }) => {
    if (!bridge || !owner || !workspaceId || busy.current) return
    busy.current = true
    setSwitching(true)
    try {
      const thread = await createSynced({ workspaceId, agentId: args.agentId })
      if (args.environmentId) {
        await setWork({
          workspaceId, agentId: args.agentId, conversationId: thread.conversationId as Id<'conversations'>,
          work: {
            computer: { kind: 'mac', environmentId: args.environmentId },
            folders: args.folder ? [{ source: 'mac', environmentId: args.environmentId, path: args.folder }] : [],
          },
        }).catch(() => undefined)
      }
      open(thread.conversationId)
      void bridge.call('localThreads.delete', { owner, threadId: args.threadId }).catch(() => undefined)
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t start a synced thread.'))
    } finally {
      busy.current = false
      setSwitching(false)
    }
  }, [bridge, createSynced, open, owner, setWork, workspaceId])

  const available = Boolean(bridge && owner)
  return useMemo(() => ({ available, switching, makePrivate, makeSynced }), [available, makePrivate, makeSynced, switching])
}
