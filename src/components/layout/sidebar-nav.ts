import {
  Bell,
  Hash,
  Mail,
  MessageSquare,
  Package,
  Plug,
  Server,
  Sparkles,
} from 'lucide-react'

export const resourceRowClass =
  'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

export type AgentsPanelView = 'personal' | 'workspace'

function agentViewParams(init: Record<string, string>, view?: AgentsPanelView) {
  // `scope` is the panel's scope (personal|workspace; it replaced the
  // agents-only `?view=` tab, which is still read from old links) — never the
  // chats `view` vocabulary, where a 'dms' marker would hide workspace agents.
  // Personal stays param-free.
  const params = new URLSearchParams(init)
  if (view === 'workspace') params.set('scope', view)
  return params
}

export function agentHref(baseHref: string, agentId: string, view?: AgentsPanelView) {
  const params = agentViewParams({ agent: agentId }, view)
  return `${baseHref}?${params.toString()}`
}

export function agentThreadHref(
  baseHref: string,
  agentId: string,
  conversationId: string,
  view?: AgentsPanelView,
) {
  const params = agentViewParams({ agent: agentId, id: conversationId }, view)
  return `${baseHref}?${params.toString()}`
}

export const arrayOrEmpty = <T,>(value: unknown): T[] => Array.isArray(value) ? value : []

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
] as const
