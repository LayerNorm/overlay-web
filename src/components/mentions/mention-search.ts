/**
 * Mention search shared by the chat composer, the notebook editor, Cmd-K and the Work context picker. Everything except
 * connectors comes from the native `search/browse:mentions` query (indexed, permission-checked, at most ten per
 * category); connectors come from the integration provider over HTTP because that list lives with the provider.
 */

import type { ConvexReactClient } from 'convex/react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import type { MentionCategory, MentionItem } from '@/shared/knowledge/mention-types'
import { api } from '../../../convex/_generated/api'

type Connector = { slug: string; name: string; description?: string; logoUrl?: string }

/** How long a loaded connector list is reused before asking the provider again. */
const CONNECTOR_TTL_MS = 60_000

const connectorLists = new Map<string, { at: number; list: Promise<MentionItem[]> }>()

/**
 * The workspace's connectors, reused for a minute; the provider is the source of truth. A failed load is not kept,
 * so the next search asks again.
 */
function connectorsFor(workspaceId: string): Promise<MentionItem[]> {
  const cached = connectorLists.get(workspaceId)
  if (cached && Date.now() - cached.at < CONNECTOR_TTL_MS) return cached.list
  const list = overlayAppClient.integrations
    .getResponse(undefined, { headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`connectors ${response.status}`)
      return await response.json() as { items?: Connector[] }
    })
    .then(({ items }) => (items ?? []).map((connector): MentionItem => ({
      type: 'connector',
      id: connector.slug,
      name: connector.name,
      description: connector.description || '',
      icon: 'Plug',
      logoUrl: connector.logoUrl,
    })))
    .catch(() => {
      if (connectorLists.get(workspaceId)?.list === list) connectorLists.delete(workspaceId)
      return []
    })
  connectorLists.set(workspaceId, { at: Date.now(), list })
  return list
}

/** Forget cached connector lists, e.g. after connecting or removing a connector. */
export function invalidateMentionCache() {
  connectorLists.clear()
}

function scoreMatch(item: MentionItem, query: string): number {
  const name = item.name.toLowerCase()
  if (name === query) return 100
  if (name.startsWith(query)) return 80
  if (name.includes(query)) return 60
  if (item.description?.toLowerCase().includes(query)) return 40
  return 0
}

function category(type: MentionCategory['type'], label: string, icon: string, items: MentionItem[]): MentionCategory[] {
  return items.length ? [{ type, label, icon, items: items.slice(0, 10) }] : []
}

/**
 * Mention categories for a query in a workspace (the newest items when the query is empty). Callers that type fast
 * should keep only the answer for the latest query they asked; each answer carries the query it is for.
 */
export async function searchMentions(
  convex: Pick<ConvexReactClient, 'query'>,
  workspaceId: string,
  query: string,
): Promise<MentionCategory[]> {
  const q = query.trim().toLowerCase()
  const result = await convex.query(api.search.browse.mentions, { workspaceId, query: q })
  if (!result) return []
  const connectors = result.connectorsAllowed ? await connectorsFor(workspaceId) : []
  const matchingConnectors = q
    ? connectors.filter((item) => scoreMatch(item, q) > 0).sort((a, b) => scoreMatch(b, q) - scoreMatch(a, q))
    : connectors
  return [
    ...category('file', 'Files', 'FileText', result.files.map((file) => ({
      type: 'file' as const,
      id: file.id,
      name: file.name || 'Untitled',
      description: file.kind === 'note' ? 'note' : file.kind || file.mimeType || 'file',
      icon: 'FileText',
    }))),
    ...category('connector', 'Connectors', 'Plug', matchingConnectors),
    ...category('automation', 'Automations', 'Zap', result.automations.map((automation) => ({
      type: 'automation' as const,
      id: automation.id,
      name: automation.name || 'Untitled automation',
      description: automation.description || '',
      icon: 'Zap',
    }))),
    ...category('skill', 'Skills', 'Sparkles', result.skills.map((skill) => ({
      type: 'skill' as const,
      id: skill.id,
      name: skill.name,
      description: skill.description || '',
      icon: 'Sparkles',
    }))),
    ...category('mcp', 'MCP Servers', 'Server', result.mcpServers.map((server) => ({
      type: 'mcp' as const,
      id: server.id,
      name: server.name,
      description: server.description || '',
      icon: 'Server',
    }))),
    ...category('chat', 'Chats', 'MessageSquare', result.chats.map((chat) => ({
      type: 'chat' as const,
      id: chat.id,
      name: chat.title || 'Untitled chat',
      icon: 'MessageSquare',
    }))),
  ]
}
