'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button, DialogFrame } from '@overlay/ui/primitives'
import { ProviderLogo } from '@overlay/ui/ai'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { ByoAgentFields } from '@/features/agents/components/AgentEditorForm'
import { useByoConnection } from '@/features/agents/components/use-byo-connection'
import { generatedByoInstructions, workspaceHarnessForByo } from '@/features/agents/lib/byo-agent-setup'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { byoModelId } from '@/shared/agents/agent-model'
import { safeHttpUrl } from '@/shared/security/safe-url'
import { ONBOARDING_TOOL_LABELS, type OnboardingSession } from '@/shared/onboarding/session'
import { onboardingRequestInit } from './onboarding-client'
import { BrandMark } from './onboarding-logos'

type ToolSlug = keyof typeof ONBOARDING_TOOL_LABELS
type Harness = 'claude-code' | 'codex'

const APPS: { slug: ToolSlug; detail: string; technical?: boolean }[] = [
  { slug: 'gmail', detail: 'Email and follow-ups' },
  { slug: 'googlecalendar', detail: 'Meetings and availability' },
  { slug: 'slack', detail: 'Team conversations' },
  { slug: 'notion', detail: 'Docs and projects' },
  { slug: 'github', detail: 'Code and issues', technical: true },
]
const AGENTS: { harness: Harness; name: string }[] = [
  { harness: 'claude-code', name: 'Claude Code' },
  { harness: 'codex', name: 'Codex' },
]

/** null while checking, false when the deployment or provider cannot connect. */
function useAvailability(workspaceId: string) {
  const { capabilities } = useOverlayCapabilities()
  const [apps, setApps] = useState<Set<string> | false | null>(capabilities.integrations ? null : false)
  const [agents, setAgents] = useState<boolean | null>(capabilities.connectedAgents ? null : false)
  const refreshApps = useCallback(async () => {
    const result = await overlayAppClient.integrations.get<{ connected?: string[] }>(undefined, { headers: { 'x-overlay-workspace-id': workspaceId }, cache: 'no-store' })
    setApps(new Set(result.connected ?? []))
  }, [workspaceId])
  useEffect(() => {
    if (!capabilities.integrations) return
    const reload = () => { void refreshApps().catch(() => setApps((current) => (current instanceof Set ? current : false))) }
    reload()
    window.addEventListener('focus', reload)
    window.addEventListener('overlay:integrations-changed', reload)
    return () => { window.removeEventListener('focus', reload); window.removeEventListener('overlay:integrations-changed', reload) }
  }, [capabilities.integrations, refreshApps])
  useEffect(() => {
    if (!capabilities.connectedAgents) return
    let alive = true
    void overlayAppClient.agentEnvironments.listBindings(workspaceId).then(() => { if (alive) setAgents(true) }, () => { if (alive) setAgents(false) })
    return () => { alive = false }
  }, [capabilities.connectedAgents, workspaceId])
  return { apps, agents, refreshApps }
}

export function OnboardingTools({ session, disabled, onContinue }: {
  session: OnboardingSession
  disabled: boolean
  onContinue(result: { tools: ToolSlug[]; agentIds: string[] }): void
}) {
  const { apps, agents, refreshApps } = useAvailability(session.workspaceId)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [harness, setHarness] = useState<Harness | null>(null)
  const [agentIds, setAgentIds] = useState<Partial<Record<Harness, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const technical = /engineer|code|software/i.test(`${session.profile.about} ${session.profile.daily}`)
  const visibleApps = APPS.filter((app) => !app.technical || technical)
  const connectedApps = apps instanceof Set ? visibleApps.filter((app) => apps.has(app.slug)).map((app) => app.slug) : []
  const anyConnected = connectedApps.length > 0 || Object.keys(agentIds).length > 0
  const connect = async (slug: ToolSlug) => {
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    setConnecting(slug)
    setError(null)
    try {
      const response = await overlayAppClient.integrations.connectResponse({ action: 'connect', providerKey: slug }, { headers: { 'x-overlay-workspace-id': session.workspaceId } })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Could not connect ${ONBOARDING_TOOL_LABELS[slug]}.`)
      const url = safeHttpUrl(result.redirectUrl)
      if (url && tab) tab.location.href = url
      else if (url) window.open(url, '_blank', 'noopener,noreferrer')
      else { tab?.close(); if (!result.connectionId) throw new Error('No connection setup URL was returned.') }
      await refreshApps()
    } catch (value) {
      tab?.close()
      setError(value instanceof Error ? value.message : `Could not connect ${ONBOARDING_TOOL_LABELS[slug]}.`)
    } finally { setConnecting(null) }
  }
  if (apps === null || agents === null) return <p className="text-[13px] text-muted-foreground">Checking what you can connect…</p>
  return (
    <div>
      {apps === false && !agents ? <p className="text-[13px] text-muted-foreground">Connections aren&apos;t available right now. You can add them later from Settings.</p> : null}
      {apps instanceof Set ? <>
        {agents ? <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Apps</p> : null}
        <ToolRows rows={visibleApps.map((app) => ({ id: app.slug, name: ONBOARDING_TOOL_LABELS[app.slug], detail: app.detail, connected: apps.has(app.slug), busy: connecting === app.slug, onConnect: () => { void connect(app.slug) } }))} disabled={disabled || Boolean(connecting)} />
      </> : null}
      {agents ? <>
        <p className={`mb-1.5 text-[11px] font-medium text-muted-foreground ${apps instanceof Set ? 'mt-3.5' : ''}`}>Coding agents you already use</p>
        <ToolRows rows={AGENTS.map((agent) => ({ id: agent.harness, name: agent.name, detail: 'Runs on your machine', connected: Boolean(agentIds[agent.harness]), busy: false, onConnect: () => setHarness(agent.harness) }))} disabled={disabled} />
      </> : null}
      {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
      <Button variant={anyConnected ? 'primary' : 'ghost'} size="sm" className="mt-3.5" disabled={disabled} onClick={() => onContinue({ tools: connectedApps, agentIds: Object.values(agentIds) })}>
        {anyConnected ? 'Continue' : 'Not now'}
      </Button>
      {harness ? <ExternalAgentConnection key={harness} session={session} harness={harness} onClose={() => setHarness(null)} onSaved={(id) => { setAgentIds((current) => ({ ...current, [harness]: id })); setHarness(null) }} /> : null}
    </div>
  )
}

type ToolRow = { id: string; name: string; detail: string; connected: boolean; busy: boolean; onConnect(): void }

function ToolRows({ rows, disabled }: { rows: ToolRow[]; disabled: boolean }) {
  return (
    <div className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated)">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-3 px-3.5 py-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-(--border) bg-white dark:border-transparent">
            {row.id === 'codex' ? <ProviderLogo provider="openai" size={16} className="text-black" /> : <BrandMark id={row.id} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">{row.name}</span>
            <span className="block text-xs text-muted-foreground">{row.detail}</span>
          </span>
          {row.connected
            ? <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="size-3.5" aria-hidden />Connected</span>
            : <Button variant="secondary" size="xs" className="h-7 px-2.5" disabled={disabled || row.busy} onClick={row.onConnect}>{row.busy ? 'Opening…' : 'Connect'}</Button>}
        </div>
      ))}
    </div>
  )
}

function ExternalAgentConnection({ session, harness, onSaved, onClose }: { session: OnboardingSession; harness: Harness; onSaved(id: string): void; onClose(): void }) {
  const [agent, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setAgentType = useCallback(() => {}, [])
  const byo = useByoConnection({ activeWorkspaceId: session.workspaceId, showcase: false, agent, agentType: 'byo', connectedAgentsEnabled: true, initialAdapterId: harness, setAgentType })
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
      if (!result.bindings.some((binding) => binding.environmentId === byo.environmentId)) throw new Error('Connection could not be confirmed. Your agent is saved; retry the connection.')
      onSaved(saved.id)
    } catch (value) { setError(value instanceof Error ? value.message : 'Could not save this connection.') }
    finally { setBusy(false) }
  }
  return (
    <DialogFrame open onOpenChange={(open) => { if (!open && !busy) onClose() }} title={`Connect ${harness === 'codex' ? 'Codex' : 'Claude Code'}`} className="max-h-[85dvh] w-[min(520px,94vw)] overflow-y-auto">
      <ByoAgentFields adapterId={byo.adapterId} harnessOptions={byo.harnessOptions.filter((option) => option.id === 'claude-code' || option.id === 'codex')} onHarnessChange={byo.chooseHarness} choice={byo.environmentChoice} onChoiceChange={byo.setEnvironmentChoice} compatibleEnvironments={byo.compatibleEnvironments} environmentsLoading={byo.environmentsLoading} environmentId={byo.environmentId} onEnvironmentChange={byo.chooseEnvironment} workingDirectory={byo.workingDirectory} onWorkingDirectoryChange={byo.setWorkingDirectory} selectedHarnessConnectable={byo.selectedHarness.connectable} environmentBusy={byo.environmentBusy} environmentError={byo.environmentError} command={byo.command} copied={byo.copied} onCopyCommand={byo.copyCommand} onBeginConnection={byo.beginConnection} setupEnvironment={byo.setupEnvironment} setupRoots={byo.setupRoots} onSetupRootsChange={byo.setSetupRoots} onApproveSetup={byo.approveSetupEnvironment} />
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !byo.bindingValid} onClick={() => { void save() }}>Save connection</Button></div>
    </DialogFrame>
  )
}
