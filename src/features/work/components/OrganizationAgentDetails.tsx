'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import type { WorkspaceAgentCreatureShape, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { RightSidebar } from '@overlay/modules-react/shell'
import { Button, Input, Textarea } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import { AgentAvatarPicker } from '@/features/agents/components/AgentAvatarPicker'
import { useAgentDirectory } from '@/features/agents/components/AgentDirectoryProvider'
import { isAgentRevisionConflict } from '@/features/agents/lib/agent-edit-save-result'
import { chiefRoleLabel } from '@/shared/agents/chief-identity'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { usePanelScope } from '@/hooks/use-panel-scope'

type OrganizationAgent = WorkspaceAgentDirectoryItem & { revision?: string }

function appearance(agent: OrganizationAgent) {
  return {
    name: agent.name,
    description: agent.description ?? '',
    color: agent.avatarColor ?? '#9a97c4',
    shape: agent.avatarShape ?? 'squircle' as WorkspaceAgentCreatureShape,
  }
}

function hasAppearanceChanged(left: OrganizationAgent, right: OrganizationAgent) {
  const a = appearance(left)
  const b = appearance(right)
  return a.name !== b.name || a.description !== b.description || a.color !== b.color || a.shape !== b.shape
}

export function OrganizationAgentDetails({ agent, owner, onClose }: {
  agent: OrganizationAgent; owner: string; onClose(): void
}) {
  const [draft, setDraft] = useState(() => appearance(agent))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const baseRevisionRef = useRef(agent.revision)
  const latestAgentRef = useRef<OrganizationAgent>(agent)
  const staleRevisionsRef = useRef(new Set<string>())
  const editVersionRef = useRef(0)
  const directory = useAgentDirectory()
  const editable = agent.agentRole === 'personal_chief' && agent.canEdit === true
  const href = useWorkspaceHref()
  const scope = usePanelScope()

  const applyAgent = useCallback((source: OrganizationAgent) => {
    setDraft(appearance(source))
    baseRevisionRef.current = source.revision
  }, [])

  useEffect(() => {
    const previous = latestAgentRef.current
    if (previous.id !== agent.id || previous.workspaceId !== agent.workspaceId) {
      latestAgentRef.current = agent
      staleRevisionsRef.current.clear()
      editVersionRef.current += 1
      applyAgent(agent)
      setDirty(false)
      setConflict(false)
      setStatus('idle')
      return
    }
    if (!hasAppearanceChanged(previous, agent) && previous.revision === agent.revision) return
    if (
      agent.revision !== undefined
      && agent.revision !== baseRevisionRef.current
      && staleRevisionsRef.current.has(agent.revision)
    ) return
    latestAgentRef.current = agent
    if (dirty) {
      if (agent.revision !== baseRevisionRef.current) setConflict(true)
      return
    }
    applyAgent(agent)
    setConflict(false)
    setStatus('idle')
  }, [agent, applyAgent, dirty])

  const change = useCallback((field: keyof ReturnType<typeof appearance>, value: string) => {
    editVersionRef.current += 1
    setDraft((current) => ({ ...current, [field]: value }))
    setDirty(true)
    setStatus('idle')
  }, [])

  const discardAndReload = useCallback(() => {
    const current = latestAgentRef.current
    editVersionRef.current += 1
    applyAgent(current)
    setDirty(false)
    setConflict(false)
    setStatus('idle')
    if (directory.mode === 'native') directory.retry()
  }, [applyAgent, directory])

  const saveAppearance = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (status === 'saving' || !dirty || conflict || !draft.name.trim()) return
    const capturedRevision = baseRevisionRef.current
    const capturedVersion = editVersionRef.current
    const saveMode = directory.mode
    setStatus('saving')
    try {
      const patch = {
        name: draft.name.trim(),
        description: draft.description,
        avatarColor: draft.color,
        avatarShape: draft.shape,
      }
      if (saveMode === 'native' && !capturedRevision) {
        throw new Error('The agent profile revision is unavailable')
      }
      const saved = saveMode === 'native'
        ? await directory.update(agent.id, patch, capturedRevision!)
        : saveMode === 'legacy'
          ? (await overlayAppClient.agents.update(agent.workspaceId, agent.id, patch)).agent as OrganizationAgent
          : (() => { throw new Error('Native agent directory is unavailable') })()
      const savedAgent = saved as OrganizationAgent
      if (saveMode === 'legacy') dispatchAgentDirectoryChanged(agent.workspaceId)
      const observed = latestAgentRef.current
      const newerRemote = observed.revision !== capturedRevision && observed.revision !== savedAgent.revision
      if (capturedRevision) staleRevisionsRef.current.add(capturedRevision)
      if (!newerRemote) latestAgentRef.current = savedAgent
      baseRevisionRef.current = savedAgent.revision
      if (editVersionRef.current === capturedVersion) {
        setDraft(appearance(savedAgent))
        setDirty(false)
      }
      setConflict(newerRemote)
      setStatus('saved')
    } catch (error) {
      if (isAgentRevisionConflict(error) && baseRevisionRef.current === capturedRevision) setConflict(true)
      setStatus('error')
    }
  }, [agent.id, agent.workspaceId, conflict, directory, dirty, draft, status])

  return <RightSidebar ariaLabel="Agent details" activeTab="details" onTabChange={() => {}} onClose={onClose}
    hero={{ avatar: editable
      ? <AgentAvatarPicker color={draft.color} shape={draft.shape} onColorChange={color => change('color', color)} onShapeChange={shape => change('shape', shape)} size={72} />
      : <AgentCreature agent={agent} isDefault={agent.isDefault} size={72} />, title: draft.name, titleText: draft.name, subtitle: owner }}
    tabs={[{ id: 'details', label: 'Details', content: <div className="space-y-5 text-sm">
      <dl className="space-y-3 text-xs"><div><dt className="text-(--muted)">Role</dt><dd className="mt-1">{chiefRoleLabel(agent)}</dd></div><div><dt className="text-(--muted)">Owner</dt><dd className="mt-1">{owner}</dd></div></dl>
      {editable ? <form className="space-y-4" onSubmit={saveAppearance}>
        <p className="text-xs leading-5 text-(--muted)">Your name and avatar follow you across scopes. Owner, role, and permissions stay unchanged.</p>
        <label className="block space-y-1.5 text-xs"><span>Name</span><Input value={draft.name} onChange={e => change('name', e.target.value)} maxLength={80} required /></label>
        <label className="block space-y-1.5 text-xs"><span>Description</span><Textarea value={draft.description} onChange={e => change('description', e.target.value)} maxLength={240} /></label>
        {conflict ? <div role="alert" className="space-y-2 rounded-lg border border-(--border) p-3 text-xs">
          <p>This agent changed elsewhere. Your draft is preserved.</p>
          <Button type="button" variant="secondary" size="sm" disabled={status === 'saving'} onClick={discardAndReload}>
            Discard draft and reload
          </Button>
        </div> : null}
        <Button type="submit" size="sm" disabled={status === 'saving' || !dirty || conflict || !draft.name.trim()}>
          {status === 'saving' ? 'Saving...' : 'Save appearance'}
        </Button>
        {status === 'saved' ? <p role="status" className="text-xs text-(--muted)">Appearance saved.</p> : null}
        {status === 'error' && !conflict ? <p role="alert" className="text-xs text-red-600">Could not save. Your changes are still here. Try again.</p> : null}
      </form> : <><p className="text-xs leading-5 text-(--muted)">{agent.description}</p>{agent.agentRole === 'personal_chief' ? <p className="text-xs text-(--muted)">Only the owner can customize this personal Overlay.</p> : null}</>}
      <Button variant="outline" size="sm" asChild><Link href={href(agent.workspaceId, `/app/agents?agent=${encodeURIComponent(agent.id)}`, scope)}>Open agent</Link></Button>
    </div> }]} />
}
