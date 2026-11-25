'use client'

import { useState, type ReactNode } from 'react'
import { Check, KeyRound } from 'lucide-react'
import {
  Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label,
} from '@overlay/ui/primitives'
import type { ScopedResourceKind } from '@overlay/app-core'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { AgentCreature } from '@/components/orb/Creature'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAgentDirectory } from '@/hooks/use-agent-directory'
import type { ScopedItem } from '@/hooks/use-scope-item-actions'

/** One thing the move depends on or changes, shown as a row under the description. */
type Requirement = { key: string; icon: ReactNode; title: string; detail: string; resolved?: boolean; action?: ReactNode }

function RequirementRow({ item }: { item: Requirement }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-(--border) px-3 py-2.5">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">{item.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-(--foreground)">{item.title}</span>
        <span className="block text-xs leading-5 text-(--muted)">{item.detail}</span>
        {item.action ? <span className="mt-2 block">{item.action}</span> : null}
      </span>
      {item.resolved ? <Check size={14} aria-label="Ready" className="mt-1 shrink-0 text-(--muted)" /> : null}
    </li>
  )
}

type Named = ScopedItem & { name?: string; title?: string; agentId?: string; hasAuth?: boolean }

const itemName = (item: Named) => item.name || item.title || 'this item'

function describe(resource: ScopedResourceKind, items: readonly Named[], workspace: string): string {
  const one = items.length === 1
  const what = one ? `“${itemName(items[0]!)}”` : `These ${items.length} items`
  switch (resource) {
    case 'automations':
      return `Everyone in ${workspace} will be able to see ${one ? what : 'them'}.`
    case 'mcp-servers':
    case 'skills':
      return `Everyone in ${workspace} will be able to use ${one ? what : 'them'}.`
    case 'work':
      return `Everyone in ${workspace} will be able to see and work on ${one ? what : 'them'}.`
    default:
      return `Everyone in ${workspace} will be able to open ${one ? what : 'them'}.`
  }
}

/** The agent an automation runs as, when it is one only its creator sees. */
function privateAgentOf(item: Named, agents: readonly WorkspaceAgentDirectoryItem[] | null): WorkspaceAgentDirectoryItem | null {
  if (!item.agentId || !agents) return null
  const agent = agents.find((entry) => entry.id === item.agentId)
  return agent && agent.visibility === 'creator' ? agent : null
}

/**
 * "Move to workspace?" for one or more personal items. Moves are one-way, so it says what changes and that it can't be
 * undone, and lists what the move depends on: an automation's creator-only agent (moved along when ticked), or an MCP
 * server's sign-in (left behind; the workspace connects its own).
 */
export function MoveToWorkspaceDialog({
  open,
  resource,
  items,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean
  resource: ScopedResourceKind
  items: readonly ScopedItem[]
  busy: boolean
  onCancel(): void
  onConfirm(options: { withAgent: boolean }): void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel() }}>
      {open ? <MoveToWorkspaceContent resource={resource} items={items as readonly Named[]} busy={busy} onCancel={onCancel} onConfirm={onConfirm} /> : null}
    </Dialog>
  )
}

function MoveToWorkspaceContent({ resource, items, busy, onCancel, onConfirm }: {
  resource: ScopedResourceKind
  items: readonly Named[]
  busy: boolean
  onCancel(): void
  onConfirm(options: { withAgent: boolean }): void
}) {
  const { activeWorkspace } = useWorkspace()
  const directory = useAgentDirectory({ enabled: resource === 'automations' })
  const [moveAgent, setMoveAgent] = useState(true)
  const workspace = activeWorkspace?.name || 'the workspace'

  const requirements: Requirement[] = []
  if (resource === 'automations') {
    const privateAgents = new Map<string, WorkspaceAgentDirectoryItem>()
    for (const item of items) {
      const agent = privateAgentOf(item, directory.agents)
      if (agent) privateAgents.set(agent.id, agent)
    }
    for (const agent of privateAgents.values()) {
      if (agent.agentRole === 'personal_chief') {
        requirements.push({
          key: agent.id,
          icon: <AgentCreature agent={agent} isDefault={agent.isDefault} size={18} />,
          title: `${agent.name} stays in Personal`,
          detail: 'A workspace automation needs an agent everyone can see. Choose a workspace agent for it first.',
          resolved: false,
        })
        continue
      }
      requirements.push({
        key: agent.id,
        icon: <AgentCreature agent={agent} isDefault={agent.isDefault} size={18} />,
        title: `${agent.name} is a Personal agent`,
        detail: 'A workspace automation needs an agent everyone can see. If it has a computer, everyone can use that too, including anything signed in on it.',
        resolved: moveAgent,
        action: (
          <Label className="flex items-center gap-2 text-xs font-normal text-(--foreground)">
            <Checkbox checked={moveAgent} onCheckedChange={(value) => setMoveAgent(value === true)} disabled={busy} />
            Move {agent.name} to the workspace too
          </Label>
        ),
      })
    }
  }
  if (resource === 'mcp-servers' && items.some((item) => item.hasAuth)) {
    requirements.push({
      key: 'credentials',
      icon: <KeyRound size={15} strokeWidth={1.75} aria-hidden className="text-(--muted)" />,
      title: 'Moves without your sign-in',
      detail: `Your sign-in stays with you. After the move it is off until you connect it again, with an account meant for ${workspace}, and turn it on.`,
    })
  }
  const ready = requirements.every((entry) => entry.resolved !== false)
  const title = items.length === 1 ? 'Move to workspace?' : `Move ${items.length} items to workspace?`

  return (
    // Opened from list rows that act on click: clicks inside the dialog stay inside it.
    <DialogContent onClick={(event) => event.stopPropagation()}>
      <DialogHeader className="flex-col items-start gap-1 pr-6">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{describe(resource, items, workspace)} You can’t move {items.length === 1 ? 'it' : 'them'} back to Personal.</DialogDescription>
      </DialogHeader>
      {requirements.length ? <ul className="space-y-2">{requirements.map((entry) => <RequirementRow key={entry.key} item={entry} />)}</ul> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="secondary" disabled={!ready || busy} onClick={() => onConfirm({ withAgent: moveAgent && requirements.some((entry) => entry.action) })}>
          {busy ? 'Moving…' : 'Move to workspace'}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
