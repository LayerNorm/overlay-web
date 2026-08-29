import { useCallback, useMemo, useState } from 'react'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import { getActiveChatListWorkspace } from '@/shared/chat/chat-list-cache'
import type { MentionCategory, MentionItem, MentionType } from '@/shared/knowledge/mention-types'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'

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
  { type: 'knowledge', label: 'Knowledge Bases', icon: 'BookOpen' },
  { type: 'connector', label: 'Connectors', icon: 'Plug' },
  { type: 'automation', label: 'Automations', icon: 'Zap' },
  { type: 'skill', label: 'Skills', icon: 'Sparkles' },
  { type: 'mcp', label: 'MCP Servers', icon: 'Server' },
  { type: 'chat', label: 'Chats', icon: 'MessageSquare' },
]

const MENTION_CACHE_TTL_MS = 60_000
const mentionCache = new Map<string, { data: CachedData; cachedAt: number }>()
const mentionRequests = new Map<string, Promise<CachedData>>()

function workspaceInit(workspaceId: string | null, init: RequestInit = {}): RequestInit {
  if (!workspaceId) return init
  const headers = new Headers(init.headers)
  headers.set(ACTIVE_WORKSPACE_HEADER, workspaceId)
  return { ...init, headers }
}

function supportedMentionTypes(capabilities: ReturnType<typeof useOverlayCapabilities>['capabilities']): MentionType[] {
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
}

function mentionCapabilityCacheKey(capabilities: ReturnType<typeof useOverlayCapabilities>['capabilities']): string {
  return supportedMentionTypes(capabilities).join('|')
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  return lower.includes(q)
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

export function useMentionData() {
  const { capabilities } = useOverlayCapabilities()
  const availableTypes = useMemo(() => supportedMentionTypes(capabilities), [capabilities])
  const cacheKey = useMemo(() => mentionCapabilityCacheKey(capabilities), [capabilities])
  const [loading, setLoading] = useState(false)

  const fetchAllData = useCallback(async (): Promise<CachedData> => {
    const workspaceId = getActiveChatListWorkspace()
    const requestKey = `${workspaceId ?? 'personal'}:${cacheKey}`
    const cached = mentionCache.get(requestKey)
    if (cached && Date.now() - cached.cachedAt < MENTION_CACHE_TTL_MS) return cached.data

    setLoading(true)
    const existingRequest = mentionRequests.get(requestKey)
    if (existingRequest) {
      try {
        return await existingRequest
      } finally {
        setLoading(false)
      }
    }

    const init = workspaceInit(workspaceId)
    const request = (async () => {
      try {
        const [filesRes, knowledgeRes, connectorsRes, automationsRes, skillsRes, mcpsRes, chatsRes] =
          await Promise.allSettled([
            capabilities.files
              ? overlayAppClient.files.getResponse({ limit: 100, summary: true }, init).then((r) => r.ok ? r.json() : [])
              : Promise.resolve([]),
            capabilities.knowledge
              ? overlayAppClient.knowledgeBases.list(init)
              : Promise.resolve({ knowledgeBases: [] }),
            capabilities.integrations
              ? overlayAppClient.integrations.getResponse(undefined, init).then((r) => r.ok ? r.json() : { items: [] })
              : Promise.resolve({ items: [] }),
            capabilities.automations
              ? overlayAppClient.automations.getResponse({ limit: 100 }, init).then((r) => r.ok ? r.json() : [])
              : Promise.resolve([]),
            capabilities.skills
              ? overlayAppClient.skills.getResponse({ limit: 100 }, init).then((r) => r.ok ? r.json() : [])
              : Promise.resolve([]),
            capabilities.mcpServers
              ? overlayAppClient.mcpServers.getResponse({ limit: 100 }, init).then((r) => r.ok ? r.json() : [])
              : Promise.resolve([]),
            capabilities.chat
              ? overlayAppClient.conversations.getResponse({ limit: 100 }, init).then((r) => r.ok ? r.json() : [])
              : Promise.resolve([]),
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

        const knowledgeRaw = knowledgeRes.status === 'fulfilled' ? knowledgeRes.value : { knowledgeBases: [] }
        const knowledge: MentionItem[] = (knowledgeRaw.knowledgeBases || []).map(
          (base: { id: string; title: string; description?: string; kind?: string }) => ({
            type: 'knowledge' as const,
            id: base.id,
            name: base.title,
            description: base.description || base.kind || 'Knowledge base',
            icon: 'BookOpen',
          }),
        )

        const connectorsRaw = connectorsRes.status === 'fulfilled' ? connectorsRes.value : { items: [] }
        const connectors: MentionItem[] = (connectorsRaw.items || []).map(
          (c: { slug: string; name: string; description?: string; logoUrl?: string }) => ({
            type: 'connector' as const,
            id: c.slug,
            name: c.name,
            description: c.description || '',
            icon: 'Plug',
            logoUrl: c.logoUrl,
          }),
        )

        const automations: MentionItem[] = capabilities.automations ? (
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

        const data: CachedData = { cacheKey: requestKey, files, knowledge, connectors, automations, skills, mcps, chats }
        mentionCache.set(requestKey, { data, cachedAt: Date.now() })
        return data
      } finally {
        mentionRequests.delete(requestKey)
      }
    })()
    mentionRequests.set(requestKey, request)
    try {
      return await request
    } finally {
      setLoading(false)
    }
  }, [
    cacheKey,
    capabilities.automations,
    capabilities.chat,
    capabilities.files,
    capabilities.knowledge,
    capabilities.integrations,
    capabilities.mcpServers,
    capabilities.skills,
  ])

  const search = useCallback(
    async (query: string): Promise<MentionCategory[]> => {
      const data = await fetchAllData()
      const q = query.trim()

      return CATEGORY_META.filter((cat) => availableTypes.includes(cat.type)).map((cat) => {
        const items = data[mentionListKey(cat.type)]
        const filtered = q
          ? items
              .filter((item) => fuzzyMatch(item.name, q) || fuzzyMatch(item.description || '', q))
              .sort((a, b) => scoreMatch(b, q) - scoreMatch(a, q))
          : items
        return {
          type: cat.type,
          label: cat.label,
          icon: cat.icon,
          items: filtered.slice(0, 10),
        }
      }).filter((cat) => cat.items.length > 0)
    },
    [availableTypes, fetchAllData]
  )

  const invalidateCache = useCallback(() => {
    mentionCache.clear()
  }, [])

  return { availableTypes, search, loading, invalidateCache, fetchAllData }
}

function mentionListKey(type: MentionType): MentionListKey {
  if (type === 'connector') return 'connectors'
  if (type === 'knowledge') return 'knowledge'
  return `${type}s` as MentionListKey
}
