'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Terminal } from 'lucide-react'
import { Button, DialogFrame, Input, Textarea } from '@overlay/ui/primitives'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { AgentCreature } from '@/components/orb/Creature'
import { ByoAgentFields } from '@/features/agents/components/AgentEditorForm'
import { useByoConnection } from '@/features/agents/components/use-byo-connection'
import { generatedByoInstructions, workspaceHarnessForByo } from '@/features/agents/lib/byo-agent-setup'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { byoModelId } from '@/shared/agents/agent-model'
import type { OnboardingEmployee, OnboardingSession } from '@/shared/onboarding/session'
import { onboardingRequestInit } from './onboarding-client'

type Harness = 'claude-code' | 'codex'

export function OnboardingEmployees({ session, disabled, onConfirm }: { session: OnboardingSession; disabled: boolean; onConfirm(indices: number[], externalIds: string[], employees: OnboardingEmployee[]): void }) {
  const [selected, setSelected] = useState<number[]>([0, 1])
  const [externalIds, setExternalIds] = useState<string[]>([])
  const [harness, setHarness] = useState<Harness | null>(null)
  const [employees, setEmployees] = useState(session.employees)
  const [editing, setEditing] = useState<number | null>(null)
  const valid = selected.every((index) => employees[index]?.name.trim() && employees[index]?.role.trim())
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {employees.map((employee, index) => (
          <div key={index} className="space-y-1"><Button variant="outline" aria-pressed={selected.includes(index)} disabled={disabled} onClick={() => setSelected((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])} className={`relative h-auto min-h-36 w-full items-start justify-start gap-3 rounded-xl p-4 text-left whitespace-normal flex-col ${selected.includes(index) ? 'border-foreground/40 bg-muted/30' : ''}`}>
            <AgentCreature agent={{ name: employee.name, avatarColor: index ? '#8b7a9b' : '#7a8b88' }} size={32} />
            {selected.includes(index) ? <Check className="absolute top-4 right-4 size-4" /> : null}
            <span>{employee.name}</span><span className="text-xs font-normal leading-5 text-muted-foreground">{employee.role}</span>
          </Button><Button variant="ghost" size="sm" disabled={disabled} onClick={() => setEditing(index)}>Edit responsibilities</Button></div>
        ))}
      </div>
      {session.flowVersion !== 2 ? <div className="space-y-2"><p className="text-xs text-muted-foreground">Already work with an agent?</p><div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={disabled} onClick={() => setHarness('claude-code')}><Terminal className="size-4" />Claude Code</Button>
        <Button variant="outline" disabled={disabled} onClick={() => setHarness('codex')}><Terminal className="size-4" />Codex</Button>
      </div></div> : null}
      {externalIds.length ? <p className="text-xs text-muted-foreground">{externalIds.length} agent connection{externalIds.length === 1 ? '' : 's'} saved. Availability depends on its machine.</p> : null}
      <p className="text-xs text-muted-foreground">Created employees are Personal and can use your authorized workspace tools. Creating them does not start paid work.</p>
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={disabled} onClick={() => onConfirm([], externalIds, employees)}>Skip for now</Button><Button disabled={disabled || !valid} onClick={() => onConfirm(selected, externalIds, employees)}>{selected.length ? 'Create selected employees' : 'Continue'}</Button></div>
      {editing !== null ? <DialogFrame open onOpenChange={(open) => { if (!open) setEditing(null) }} title="Employee responsibilities" className="w-[min(460px,94vw)]">
        <div className="space-y-4"><label className="block space-y-2 text-sm"><span>Name</span><Input value={employees[editing].name} maxLength={60} onChange={(event) => setEmployees((current) => current.map((employee, index) => index === editing ? { ...employee, name: event.target.value } : employee))} /></label><label className="block space-y-2 text-sm"><span>Responsibilities</span><Textarea value={employees[editing].role} maxLength={240} onChange={(event) => setEmployees((current) => current.map((employee, index) => index === editing ? { ...employee, role: event.target.value } : employee))} /></label><div className="flex justify-end"><Button disabled={!employees[editing].name.trim() || !employees[editing].role.trim()} onClick={() => setEditing(null)}>Done</Button></div></div>
      </DialogFrame> : null}
      {harness ? <ExternalAgentConnection key={harness} session={session} harness={harness} onClose={() => setHarness(null)} onSaved={(id) => { setExternalIds((current) => [...new Set([...current, id])]); setHarness(null) }} /> : null}
    </div>
  )
}

export function OnboardingExternalAgents({ session, disabled, onContinue }: { session: OnboardingSession; disabled: boolean; onContinue(agentIds: string[]): void }) {
  const [harness, setHarness] = useState<Harness | null>(null)
  const [agentIds, setAgentIds] = useState<string[]>([])
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={disabled} onClick={() => setHarness('claude-code')}><Terminal className="size-4" />Claude Code</Button>
      <Button variant="outline" disabled={disabled} onClick={() => setHarness('codex')}><Terminal className="size-4" />Codex</Button>
    </div>
    {agentIds.length ? <p className="text-xs text-muted-foreground">{agentIds.length} agent connection{agentIds.length === 1 ? '' : 's'} saved. Availability depends on its machine.</p> : null}
    <div className="flex justify-end"><Button variant={agentIds.length ? 'primary' : 'ghost'} disabled={disabled} onClick={() => onContinue(agentIds)}>{agentIds.length ? 'Continue' : 'Not now'}</Button></div>
    {harness ? <ExternalAgentConnection key={harness} session={session} harness={harness} onClose={() => setHarness(null)} onSaved={(id) => { setAgentIds((current) => [...new Set([...current, id])]); setHarness(null) }} /> : null}
  </div>
}

function ExternalAgentConnection({ session, harness, onSaved, onClose }: { session: OnboardingSession; harness: Harness; onSaved(id: string): void; onClose(): void }) {
  const [agent, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setAgentType = useCallback(() => {}, [])
  const byo = useByoConnection({ activeWorkspaceId: session.workspaceId, showcase: false, agent, agentType: 'byo', connectedAgentsEnabled: enabled, initialAdapterId: harness, setAgentType })
  useEffect(() => {
    let alive = true
    void overlayAppClient.agentEnvironments.listBindings(session.workspaceId).then(() => { if (alive) setEnabled(true) }).catch(() => { if (alive) setError('Agent connections are unavailable. You can continue onboarding without one.') }).finally(() => { if (alive) setChecked(true) })
    return () => { alive = false }
  }, [session.workspaceId])
  const save = async () => {
    setBusy(true); setError(null)
    try {
      const name = byo.adapterId === 'claude-code' ? 'Claude Code' : 'Codex'
      const saved = agent ?? (await overlayAppClient.agents.create(session.workspaceId, {
        name, instructions: generatedByoInstructions(name), harness: workspaceHarnessForByo(byo.adapterId), modelId: byoModelId(byo.adapterId), visibility: 'creator', allowedToolIds: [],
      }, onboardingRequestInit(session, `connect-${byo.adapterId}`))).agent
      setAgent(saved)
      await overlayAppClient.agentEnvironments.upsertBinding(session.workspaceId, { agentId: saved.id, environmentId: byo.environmentId, adapterId: byo.adapterId, workingDirectory: byo.workingDirectory.trim() })
      const result = await overlayAppClient.agentEnvironments.listBindings(session.workspaceId, saved.id)
      if (!result.bindings.some((binding) => binding.environmentId === byo.environmentId)) throw new Error('Connection could not be confirmed. Your employee is saved; retry the connection.')
      onSaved(saved.id)
    } catch (value) { setError(value instanceof Error ? value.message : 'Could not save this connection.') }
    finally { setBusy(false) }
  }
  return (
    <DialogFrame open onOpenChange={(open) => { if (!open && !busy) onClose() }} title="Connect your agent" className="max-h-[85dvh] w-[min(520px,94vw)] overflow-y-auto">
      {enabled ? <ByoAgentFields adapterId={byo.adapterId} harnessOptions={byo.harnessOptions.filter((option) => option.id === 'claude-code' || option.id === 'codex')} onHarnessChange={byo.chooseHarness} choice={byo.environmentChoice} onChoiceChange={byo.setEnvironmentChoice} compatibleEnvironments={byo.compatibleEnvironments} environmentsLoading={byo.environmentsLoading} environmentId={byo.environmentId} onEnvironmentChange={byo.chooseEnvironment} workingDirectory={byo.workingDirectory} onWorkingDirectoryChange={byo.setWorkingDirectory} selectedHarnessConnectable={byo.selectedHarness.connectable} environmentBusy={byo.environmentBusy} environmentError={byo.environmentError} command={byo.command} copied={byo.copied} onCopyCommand={byo.copyCommand} onBeginConnection={byo.beginConnection} setupEnvironment={byo.setupEnvironment} setupRoots={byo.setupRoots} onSetupRootsChange={byo.setSetupRoots} onApproveSetup={byo.approveSetupEnvironment} /> : <p className="text-sm text-muted-foreground">{checked ? 'You can connect this agent later from Agents.' : 'Checking available connections...'}</p>}
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !enabled || !byo.bindingValid} onClick={() => { void save() }}>Save connection</Button></div>
    </DialogFrame>
  )
}
