import {
  Archive,
  Bell,
  Hash,
  Mail,
  MessageSquare,
  Package,
  Plug,
  Server,
  Sparkles,
  User,
  Users,
} from 'lucide-react'

export const resourceRowClass =
  'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

export type AgentsPanelView = 'personal' | 'workspace' | 'archived'

export function agentThreadHref(baseHref: string, agentId: string, conversationId: string) {
  const params = new URLSearchParams({ agent: agentId, view: 'dms', id: conversationId })
  return `${baseHref}?${params.toString()}`
}

export const arrayOrEmpty = <T,>(value: unknown): T[] => Array.isArray(value) ? value : []

export const agentsInlineItems = [
  { id: 'personal', label: 'Personal', icon: User },
  { id: 'workspace', label: 'Workspace', icon: Users },
  { id: 'archived', label: 'Archived', icon: Archive },
] as const

export const toolsInlineItems = [
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'mcps', label: 'MCPs', icon: Server },
  { id: 'apps', label: 'Apps', icon: Package, locked: true },
] as const

export const chatsInlineItems = [
  { id: 'personal', label: 'Personal', icon: MessageSquare },
  { id: 'dms', label: 'Direct Messages', icon: Mail },
  { id: 'channels', label: 'Channels', icon: Hash },
  { id: 'activity', label: 'Activity', icon: Bell },
  { id: 'archived', label: 'Archived', icon: Archive },
] as const
