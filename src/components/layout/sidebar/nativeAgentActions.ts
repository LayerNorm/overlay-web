'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { useNativeThreadClient } from '@/components/providers/native-agent-threads'
import { announceArchived } from '@/shared/app/archive-toast'
import { rememberAgentOpened } from '@/shared/agents/last-agent-by-workspace'
import { automationHref } from '@overlay/app-core/automations'
import { agentHref, agentThreadHref } from '../sidebar-nav'
import type { useAgentActions } from '../AppSidebarAgentsPanel'

type Args = Parameters<typeof useAgentActions>[0]
type Agent = WorkspaceAgentDirectoryItem
type Client = ReturnType<typeof useNativeThreadClient>
type ActionContext = { args: Args; client: Client; router: ReturnType<typeof useRouter> }

export function pendingAgentHref(href: string, token: string) {
  const url = new URL(href, 'https://workspace.invalid')
  url.searchParams.set('nativePending', token)
  return `${url.pathname}${url.search}`
}

function locationKey() { return typeof window === 'undefined' ? '' : window.location.pathname + window.location.search }
export function ownsThreadNavigation(current: string, origin: string, pending: string) { return current === origin || current === pending }

function destination(ctx: ActionContext, agent: Agent) { return agentHref(ctx.args.baseHref, agent.id, ctx.args.view) }

async function createNativeThread(ctx: ActionContext, agent: Agent, requestId: string) {
  const origin = locationKey()
  const token = `create:${requestId}`
  const pending = pendingAgentHref(destination(ctx, agent), token)
  const finish = ctx.client.track(token)
  try {
    ctx.router.push(pending)
    ctx.args.onNavigate?.()
    const thread = await ctx.client.create(agent.id, requestId)
    if (ownsThreadNavigation(locationKey(), origin, pending)) ctx.router.replace(agentThreadHref(ctx.args.baseHref, agent.id, thread.conversationId, ctx.args.view))
  } catch (error) {
    if (ownsThreadNavigation(locationKey(), origin, pending)) ctx.router.replace(destination(ctx, agent))
    throw error
  } finally { finish() }
}

async function archiveNativeThread(ctx: ActionContext, agent: Agent, conversationId: string, archived: boolean) {
  const origin = locationKey()
  const token = `archive:${crypto.randomUUID()}`
  const pending = pendingAgentHref(destination(ctx, agent), token)
  const selected = ctx.args.activeConversationId === conversationId
  const finish = ctx.client.track(token)
  try {
    if (selected && archived) ctx.router.replace(pending)
    await ctx.client.archive(agent.id, conversationId, archived)
    if (archived) announceArchived({ name: 'Thread', undo: () => ctx.client.archive(agent.id, conversationId, false) })
    if (selected && archived && ownsThreadNavigation(locationKey(), origin, pending)) ctx.router.replace(destination(ctx, agent))
  } catch (error) {
    if (selected && ownsThreadNavigation(locationKey(), origin, pending)) ctx.router.replace(agentThreadHref(ctx.args.baseHref, agent.id, conversationId, ctx.args.view))
    throw error
  } finally { finish() }
}

async function deleteNativeThread(ctx: ActionContext, agent: Agent, conversationId: string) {
  const origin = locationKey()
  await ctx.client.delete(agent.id, conversationId)
  if (ctx.args.activeConversationId === conversationId && locationKey() === origin) ctx.router.replace(destination(ctx, agent))
}

export function useAgentActionsSource(args: Args, legacy: ReturnType<typeof useAgentActions>) {
  const client = useNativeThreadClient()
  const router = useRouter()
  const [openError, setOpenError] = useState<string | null>(null)
  const [creatingThreadFor, setCreatingThreadFor] = useState<string | null>(null)
  const requests = useRef(new Map<string, string>())
  const busy = useRef(false)
  const ctx = { args, client, router }
  async function run(action: () => Promise<void>) {
    try { await action(); setOpenError(null) } catch (error) { setOpenError(error instanceof Error ? error.message : 'Could not update agent thread') }
  }
  const native = {
    openingAgentId: null, openError, creatingThreadFor,
    async openAgentById(agent: Agent, navigation: 'push' | 'replace' = 'push') {
      rememberAgentOpened(args.workspaceId, agent.id)
      router[navigation](destination(ctx, agent))
      args.onNavigate?.()
    },
    openThread(agent: Agent, conversationId: string) { router.push(agentThreadHref(args.baseHref, agent.id, conversationId, args.view)); args.onNavigate?.() },
    openAutomation(id: string) { router.push(args.buildWorkspaceHref(args.workspaceId, automationHref({ _id: id }), args.view)); args.onNavigate?.() },
    async createThread(agent: Agent) {
      if (busy.current) return
      busy.current = true
      setCreatingThreadFor(agent.id)
      const requestId = requests.current.get(agent.id) ?? crypto.randomUUID()
      requests.current.set(agent.id, requestId)
      await run(async () => { await createNativeThread(ctx, agent, requestId); requests.current.delete(agent.id) })
      busy.current = false
      setCreatingThreadFor(null)
    },
    archiveThread(agent: Agent, conversationId: string, archived: boolean) { return run(() => archiveNativeThread(ctx, agent, conversationId, archived)) },
    deleteThread(agent: Agent, conversationId: string) { return run(() => deleteNativeThread(ctx, agent, conversationId)) },
    retryOpen() { setOpenError(null); router.replace(args.baseHref) },
  }
  return client.enabled ? native : legacy
}
