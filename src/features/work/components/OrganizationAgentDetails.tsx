'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { WorkspaceAgentCreatureShape, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { RightSidebar } from '@overlay/modules-react/shell'
import { Button, Input, Textarea } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import { AgentAvatarPicker } from '@/features/agents/components/AgentAvatarPicker'
import { chiefRoleLabel } from '@/shared/agents/chief-identity'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { usePanelScope } from '@/hooks/use-panel-scope'

export function OrganizationAgentDetails({ agent, owner, onClose }: {
  agent: WorkspaceAgentDirectoryItem; owner: string; onClose(): void
}) {
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? '')
  const [color, setColor] = useState(agent.avatarColor ?? '#9a97c4')
  const [shape, setShape] = useState<WorkspaceAgentCreatureShape>(agent.avatarShape ?? 'squircle')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const editable = agent.agentRole === 'personal_chief' && agent.canEdit === true
  const href = useWorkspaceHref()
  const scope = usePanelScope()
  return <RightSidebar ariaLabel="Agent details" activeTab="details" onTabChange={() => {}} onClose={onClose}
    hero={{ avatar: editable
      ? <AgentAvatarPicker color={color} shape={shape} onColorChange={setColor} onShapeChange={setShape} size={72} />
      : <AgentCreature agent={agent} isDefault={agent.isDefault} size={72} />, title: name, titleText: name, subtitle: owner }}
    tabs={[{ id: 'details', label: 'Details', content: <div className="space-y-5 text-sm">
      <dl className="space-y-3 text-xs"><div><dt className="text-(--muted)">Role</dt><dd className="mt-1">{chiefRoleLabel(agent)}</dd></div><div><dt className="text-(--muted)">Owner</dt><dd className="mt-1">{owner}</dd></div></dl>
      {editable ? <form className="space-y-4" onSubmit={async event => {
        event.preventDefault()
        if (status === 'saving' || !name.trim()) return
        setStatus('saving')
        try {
          await overlayAppClient.agents.update(agent.workspaceId, agent.id, { name: name.trim(), description, avatarColor: color, avatarShape: shape })
          setStatus('saved')
        } catch { setStatus('error') }
      }}>
        <p className="text-xs leading-5 text-(--muted)">Your name and avatar follow you across scopes. Owner, role, and permissions stay unchanged.</p>
        <label className="block space-y-1.5 text-xs"><span>Name</span><Input value={name} onChange={e => { setName(e.target.value); setStatus('idle') }} maxLength={80} required /></label>
        <label className="block space-y-1.5 text-xs"><span>Description</span><Textarea value={description} onChange={e => { setDescription(e.target.value); setStatus('idle') }} maxLength={240} /></label>
        <Button type="submit" size="sm" disabled={status === 'saving' || !name.trim()}>{status === 'saving' ? 'Saving...' : 'Save appearance'}</Button>
        {status === 'saved' ? <p role="status" className="text-xs text-(--muted)">Appearance saved.</p> : null}
        {status === 'error' ? <p role="alert" className="text-xs text-red-600">Could not save. Your changes are still here. Try again.</p> : null}
      </form> : <><p className="text-xs leading-5 text-(--muted)">{agent.description}</p>{agent.agentRole === 'personal_chief' ? <p className="text-xs text-(--muted)">Only the owner can customize this personal Overlay.</p> : null}</>}
      <Button variant="outline" size="sm" asChild><Link href={href(agent.workspaceId, `/app/agents?agent=${encodeURIComponent(agent.id)}`, scope)}>Open agent</Link></Button>
    </div> }]} />
}
