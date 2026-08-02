/**
 * Non-hook variant of the mention data fetcher for use outside React (e.g. from a
 * TipTap suggestion plugin). Same fetch + cache + scoring policy as `useMentionData`.
 */

import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import type { MentionCategory, MentionItem, MentionType } from '@/shared/knowledge/mention-types'

interface CachedData {
  cacheKey: string
  files: MentionItem[]
  knowledge: MentionItem[]
  connectors: MentionItem[]
  automations: MentionItem[]
  skills: MentionItem[]
  mcps: MentionItem[]
  chats: MentionItem[]
}

type MentionListKey = Exclude<keyof CachedData, 'cacheKey'>

const CATEGORY_META: Array<{ type: MentionType; label: string; icon: string }> = [
  { type: 'file', label: 'Files', icon: 'FileText' },
  { type: 'knowledge', label: 'Knowledge', icon: 'BookOpen' },
  { type: 'connector', label: 'Connectors', icon: 'Plug' },
  { type: 'automation', label: 'Automations', icon: 'Zap' },
  { type: 'skill', label: 'Skills', icon: 'Sparkles' },
  { type: 'mcp', label: 'MCP Servers', icon: 'Server' },
  { type: 'chat', label: 'Chats', icon: 'MessageSquare' },
]

let cache: CachedData | null = null
let inFlight: Promise<CachedData> | null = null
let capabilityState: Promise<{
  chat: boolean
  files: boolean
  knowledge: boolean
  integrations: boolean
  automations: boolean
  skills: boolean
  mcpServers: boolean
}> | null = null

export function invalidateMentionCache() {
  cache = null
  capabilityState = null
}

async function fetchAll(): Promise<CachedData> {
  if (cache) return cache
  if (inFlight) return inFlight
  inFlight = (async () => {
    const automationsEnabled = await areAutomationsEnabled()
    const capabilities = await getMentionCapabilities()
    const cacheKey = mentionCapabilityCacheKey(capabilities)
    const [filesRes, notesRes, knowledgeRes, connectorsRes, automationsRes, skillsRes, mcpsRes, chatsRes] =
      await Promise.allSettled([
        capabilities.files
          ? overlayAppClient.files.getResponse({ limit: 100, summary: true }).then((r) => (r.ok ? r.json() : []))
          : Promise.resolve([]),
        capabilities.files
          ? overlayAppClient.notes.getResponse({ limit: 100 }).then((r) => (r.ok ? r.json() : []))
          : Promise.resolve([]),
        capabilities.knowledge
          ? overlayAppClient.knowledgeBases.list()
          : Promise.resolve({ knowledgeBases: [] }),
        capabilities.integrations
          ? overlayAppClient.integrations.getResponse().then((r) => (r.ok ? r.json() : { items: [] }))
          : Promise.resolve({ items: [] }),
        capabilities.automations && automationsEnabled
          ? overlayAppClient.automations.getResponse({ limit: 100 }).then((r) => (r.ok ? r.json() : []))
          : Promise.resolve([]),
        capabilities.skills
          ? overlayAppClient.skills.getResponse({ limit: 100 }).then((r) => (r.ok ? r.json() : []))
          : Promise.resolve([]),
        capabilities.mcpServers
          ? overlayAppClient.mcpServers.getResponse({ limit: 100 }).then((r) => (r.ok ? r.json() : []))
          : Promise.resolve([]),
        capabilities.chat
          ? overlayAppClient.conversations.getResponse({ limit: 100 }).then((r) => (r.ok ? r.json() : []))
          : Promise.resolve([]),
      ])

    const canonicalFiles: MentionItem[] = (
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
    const notes: MentionItem[] = (
      notesRes.status === 'fulfilled'
        ? unwrapPaginatedData<{ _id: string; title?: string }>(notesRes.value)
        : []
    ).map((note: { _id: string; title?: string }) => ({
      type: 'file' as const,
      id: note._id,
      name: note.title || 'Untitled',
      description: 'note',
      icon: 'FileText',
    }))
    const files = [...new Map([...canonicalFiles, ...notes].map((item) => [item.id, item])).values()]
    const knowledge: MentionItem[] = (
      knowledgeRes.status === 'fulfilled' ? knowledgeRes.value.knowledgeBases : []
    ).map((knowledgeBase) => ({
      type: 'knowledge' as const,
      id: knowledgeBase.id,
      name: knowledgeBase.title,
      description: knowledgeBase.description || 'Knowledge base',
      icon: 'BookOpen',
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
    const automations: MentionItem[] = capabilities.automations && automationsEnabled ? (
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

    cache = { cacheKey, files, knowledge, connectors, automations, skills, mcps, chats }
    return cache
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

async function areAutomationsEnabled(): Promise<boolean> {
  return (await getMentionCapabilities()).automations
}

async function getMentionCapabilities(): Promise<{
  chat: boolean
  files: boolean
  knowledge: boolean
  integrations: boolean
  automations: boolean
  skills: boolean
  mcpServers: boolean
}> {
  if (!capabilityState) {
    capabilityState = fetch('/api/v1/capabilities', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return defaultMentionCapabilities()
        const payload = await response.json()
        const capabilities = payload?.capabilities ?? {}
        return {
          chat: capabilities.chat !== false,
          files: capabilities.files !== false,
          knowledge: capabilities.knowledge !== false,
          integrations: capabilities.integrations !== false,
          automations: capabilities.automations !== false,
          skills: capabilities.skills !== false,
          mcpServers: capabilities.mcpServers !== false,
        }
      })
      .catch(defaultMentionCapabilities)
  }
  return capabilityState
}

function defaultMentionCapabilities() {
  return {
    chat: true,
    files: true,
    knowledge: true,
    integrations: true,
    automations: true,
    skills: true,
    mcpServers: true,
  }
}

function mentionCapabilityCacheKey(capabilities: Awaited<ReturnType<typeof getMentionCapabilities>>): string {
  return CATEGORY_META
    .filter((cat) => {
      switch (cat.type) {
        case 'file':
          return capabilities.files
        case 'knowledge':
          return capabilities.knowledge
        case 'connector':
          return capabilities.integrations
        case 'automation':
          return capabilities.automations
        case 'skill':
          return capabilities.skills
        case 'mcp':
          return capabilities.mcpServers
        case 'chat':
          return capabilities.chat
      }
    })
    .map((cat) => cat.type)
    .join('|')
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
  const capabilities = await getMentionCapabilities()
  const q = query.trim().toLowerCase()
  return CATEGORY_META.filter((cat) => {
    switch (cat.type) {
      case 'file':
        return capabilities.files
      case 'knowledge':
        return capabilities.knowledge
      case 'connector':
        return capabilities.integrations
      case 'automation':
        return capabilities.automations
      case 'skill':
        return capabilities.skills
      case 'mcp':
        return capabilities.mcpServers
      case 'chat':
        return capabilities.chat
    }
  }).map((cat) => {
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
  if (type === 'knowledge') return 'knowledge'
  return type === 'connector' ? 'connectors' : `${type}s` as MentionListKey
}
