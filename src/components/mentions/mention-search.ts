/**
 * Non-hook variant of the mention data fetcher for use outside React (e.g. from a
 * TipTap suggestion plugin). Same fetch + cache + scoring policy as `useMentionData`.
 */

import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import type { MentionCategory, MentionItem, MentionType } from '@/shared/knowledge/mention-types'

interface CachedData {
  automationsEnabled: boolean
  files: MentionItem[]
  connectors: MentionItem[]
  automations: MentionItem[]
  skills: MentionItem[]
  mcps: MentionItem[]
  chats: MentionItem[]
}

type MentionListKey = Exclude<keyof CachedData, 'automationsEnabled'>

const CATEGORY_META: Array<{ type: MentionType; label: string; icon: string }> = [
  { type: 'file', label: 'Files', icon: 'FileText' },
  { type: 'connector', label: 'Connectors', icon: 'Plug' },
  { type: 'automation', label: 'Automations', icon: 'Zap' },
  { type: 'skill', label: 'Skills', icon: 'Sparkles' },
  { type: 'mcp', label: 'MCP Servers', icon: 'Server' },
  { type: 'chat', label: 'Chats', icon: 'MessageSquare' },
]

let cache: CachedData | null = null
let inFlight: Promise<CachedData> | null = null
let automationsCapability: Promise<boolean> | null = null

export function invalidateMentionCache() {
  cache = null
  automationsCapability = null
}

async function fetchAll(): Promise<CachedData> {
  if (cache) return cache
  if (inFlight) return inFlight
  inFlight = (async () => {
    const automationsEnabled = await areAutomationsEnabled()
    const [filesRes, connectorsRes, automationsRes, skillsRes, mcpsRes, chatsRes] =
      await Promise.allSettled([
        overlayAppClient.files.getResponse({ limit: 100, summary: true }).then((r) => (r.ok ? r.json() : [])),
        overlayAppClient.integrations.getResponse().then((r) => (r.ok ? r.json() : { items: [] })),
        automationsEnabled
          ? overlayAppClient.automations.getResponse({ limit: 100 }).then((r) => (r.ok ? r.json() : []))
          : Promise.resolve([]),
        overlayAppClient.skills.getResponse({ limit: 100 }).then((r) => (r.ok ? r.json() : [])),
        overlayAppClient.mcpServers.getResponse({ limit: 100 }).then((r) => (r.ok ? r.json() : [])),
        overlayAppClient.conversations.getResponse({ limit: 100 }).then((r) => (r.ok ? r.json() : [])),
      ])

    const files: MentionItem[] = (
      filesRes.status === 'fulfilled'
        ? unwrapPaginatedData<{ _id: string; name?: string; kind?: string; mimeType?: string }>(filesRes.value)
        : []
    ).map((f: { _id: string; name?: string; kind?: string; mimeType?: string }) => ({
      type: 'file' as const,
      id: f._id,
      name: f.name || 'Untitled',
      description: f.kind || f.mimeType || 'file',
      icon: 'FileText',
    }))
    const connectorsRaw = connectorsRes.status === 'fulfilled' ? connectorsRes.value : { items: [] }
    const connectors: MentionItem[] = (connectorsRaw.items || []).map(
      (c: { slug: string; name: string; description?: string; logoUrl?: string }) => ({
        type: 'connector' as const,
        id: c.slug,
        name: c.name,
        description: c.description || '',
        icon: 'Plug',
        logoUrl: c.logoUrl,
      })
    )
    const automations: MentionItem[] = automationsEnabled ? (
      automationsRes.status === 'fulfilled'
        ? unwrapPaginatedData<{ _id: string; name?: string; description?: string; deletedAt?: number }>(automationsRes.value)
        : []
    )
      .filter((a: { deletedAt?: number }) => !a.deletedAt)
      .map((a: { _id: string; name?: string; description?: string }) => ({
        type: 'automation' as const,
        id: a._id,
        name: a.name || 'Untitled automation',
        description: a.description || '',
        icon: 'Zap',
      })) : []
    const skills: MentionItem[] = (
      skillsRes.status === 'fulfilled'
        ? unwrapPaginatedData<{ _id: string; name: string; description?: string; enabled?: boolean }>(skillsRes.value)
        : []
    )
      .filter((s: { enabled?: boolean }) => s.enabled !== false)
      .map((s: { _id: string; name: string; description?: string }) => ({
        type: 'skill' as const,
        id: s._id,
        name: s.name,
        description: s.description || '',
        icon: 'Sparkles',
      }))
    const mcps: MentionItem[] = (
      mcpsRes.status === 'fulfilled'
        ? unwrapPaginatedData<{ _id: string; name: string; description?: string; url?: string }>(mcpsRes.value)
        : []
    ).map((m: { _id: string; name: string; description?: string; url?: string }) => ({
      type: 'mcp' as const,
      id: m._id,
      name: m.name,
      description: m.description || m.url || '',
      icon: 'Server',
    }))
    const chats: MentionItem[] = (
      chatsRes.status === 'fulfilled'
        ? unwrapPaginatedData<{ _id: string; title: string }>(chatsRes.value)
        : []
    ).map((c: { _id: string; title: string }) => ({
      type: 'chat' as const,
      id: c._id,
      name: c.title || 'Untitled chat',
      icon: 'MessageSquare',
    }))

    cache = { automationsEnabled, files, connectors, automations, skills, mcps, chats }
    return cache
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

async function areAutomationsEnabled(): Promise<boolean> {
  if (!automationsCapability) {
    automationsCapability = fetch('/api/v1/capabilities', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return true
        const payload = await response.json()
        return payload?.capabilities?.automations !== false
      })
      .catch(() => true)
  }
  return automationsCapability
}

function scoreMatch(item: MentionItem, query: string): number {
  const q = query.toLowerCase()
  const name = item.name.toLowerCase()
  if (name === q) return 100
  if (name.startsWith(q)) return 80
  if (name.includes(q)) return 60
  if (item.description?.toLowerCase().includes(q)) return 40
  return 0
}

export async function searchMentions(query: string): Promise<MentionCategory[]> {
  const data = await fetchAll()
  const q = query.trim().toLowerCase()
  return CATEGORY_META.map((cat) => {
    const items = data[mentionListKey(cat.type)]
    const filtered = q
      ? items
          .filter(
            (item) =>
              item.name.toLowerCase().includes(q) || (item.description || '').toLowerCase().includes(q),
          )
          .sort((a, b) => scoreMatch(b, q) - scoreMatch(a, q))
      : items
    return {
      type: cat.type,
      label: cat.label,
      icon: cat.icon,
      items: filtered.slice(0, 10),
    }
  }).filter((cat) => cat.items.length > 0)
}

function mentionListKey(type: MentionType): MentionListKey {
  return type === 'connector' ? 'connectors' : `${type}s` as MentionListKey
}
