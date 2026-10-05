'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CloudAgentStatusResource, ProviderAccountResource } from '@overlay/api-client'
import { Button } from '@overlay/ui/primitives'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { CLOUD_AGENT_STATE_LABEL, isCloudAgentStarting, type CloudAgentAction } from '@/shared/agents/cloud-agent'
import { AGENT_PROVIDER_IDS, type AgentProviderId } from '@/shared/agents/provider-accounts'
import { AccountDialog } from '@/components/agents/AgentAccountDialog'
import { CloudAgentConfig } from './CloudAgentConfig'
import { CloudAgentProgress } from './CloudAgentProgress'
import { FieldLabel } from './InfoTip'
import { OTHER_AGENT_LABEL } from './cloud-agent-draft'

const POLL_STARTING_MS = 2_000
const POLL_IDLE_MS = 15_000

const SIZE_LABEL: Record<string, string> = { small: 'Small · 2 vCPU, 4 GB', default: 'Default · 4 vCPU, 8 GB', large: 'Large · 8 vCPU, 16 GB' }

function useCloudAgentStatus(agentId: string) {
  const { activeWorkspaceId } = useWorkspace()
  const [status, setStatus] = useState<CloudAgentStatusResource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const starting = status ? isCloudAgentStarting(status.provision?.phase) : false
  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    const load = () => overlayAppClient.cloudAgents.status(activeWorkspaceId, agentId).then(
      (next) => { if (!cancelled) { setStatus(next); setError(null) } },
      (loadError: unknown) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load the machine.') },
    )
    void load()
    const timer = window.setInterval(() => void load(), starting ? POLL_STARTING_MS : POLL_IDLE_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [activeWorkspaceId, agentId, starting, tick])
  const refresh = useCallback(() => setTick((current) => current + 1), [])
  return { workspaceId: activeWorkspaceId, status, error, refresh }
}

type PanelBusy = CloudAgentAction | 'retry' | null

/** Pause/Resume, Restart, and Try again, for the states where each makes sense. */
function MachineActions({ state, busy, onRun, onRetry }: {
  state: CloudAgentStatusResource['state']
  busy: PanelBusy
  onRun(action: CloudAgentAction): void
  onRetry(): void
}) {
  const canRestart = state === 'ready' || state === 'needs_sign_in'
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {state === 'paused' ? (
        <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => onRun('resume')}>{busy === 'resume' ? 'Resuming…' : 'Resume'}</Button>
      ) : null}
      {state === 'ready' ? (
        <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => onRun('pause')}>{busy === 'pause' ? 'Pausing…' : 'Pause'}</Button>
      ) : null}
      {canRestart ? (
        <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => onRun('restart')}>{busy === 'restart' ? 'Restarting…' : 'Restart'}</Button>
      ) : null}
      {state === 'failed' ? (
        <Button variant="primary" size="sm" disabled={busy !== null} onClick={onRetry}>{busy === 'retry' ? 'Starting…' : 'Try again'}</Button>
      ) : null}
      {state === 'unavailable' ? (
        <Button variant="primary" size="sm" disabled={busy !== null} onClick={onRetry}>{busy === 'retry' ? 'Starting…' : 'Start a new machine'}</Button>
      ) : null}
    </div>
  )
}

/**
 * The agent's Overlay Cloud machine on its page: whether it is ready, the
 * account it signs in with, and pause / resume / restart. Deleting the machine
 * is archiving the agent (the danger zone below).
 */
export function CloudAgentPanel({ agentId }: { agentId: string }) {
  const { workspaceId, status, error, refresh } = useCloudAgentStatus(agentId)
  const [busy, setBusy] = useState<PanelBusy>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reconnect, setReconnect] = useState<ProviderAccountResource | null>(null)

  const run = async (action: CloudAgentAction) => {
    if (!workspaceId || busy) return
    setBusy(action)
    setActionError(null)
    try {
      await overlayAppClient.cloudAgents.control(workspaceId, agentId, action)
      refresh()
    } catch (controlError) {
      setActionError(controlError instanceof Error ? controlError.message : 'That did not work. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const retry = async () => {
    const adapterId = status?.machine?.adapterId ?? status?.adapterId
    if (!workspaceId || !status?.account || (!adapterId || !(AGENT_PROVIDER_IDS as readonly string[]).includes(adapterId)) || busy) return
    setBusy('retry')
    setActionError(null)
    try {
      await overlayAppClient.cloudAgents.provision(workspaceId, { agentId, adapterId: adapterId as AgentProviderId, providerAccountId: status.account.id, size: 'small' })
      refresh()
    } catch (retryError) {
      setActionError(retryError instanceof Error ? retryError.message : 'Could not start the machine.')
    } finally {
      setBusy(null)
    }
  }

  const openReconnect = async () => {
    // Only the account's owner can reconnect it; for anyone else the list will not contain it.
    const accounts = await overlayAppClient.providerAccounts.list({ cache: 'no-store' }).catch((_error) => null)
    const account = accounts?.data.find((candidate) => candidate.id === status?.account?.id)
    if (account) setReconnect(account)
    else setActionError('Only the person who connected this account can reconnect it.')
  }

  if (!status) {
    return error
      ? <p role="alert" className="text-xs text-red-500">{error}</p>
      : <p className="text-xs text-[var(--muted)]">Loading the machine…</p>
  }

  const phase = status.provision?.phase
  const adapterLabel = status.machine?.adapterId === 'codex' ? OTHER_AGENT_LABEL.codex : OTHER_AGENT_LABEL['claude-code']

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel info="This agent runs on a machine Overlay manages. It pauses itself when idle and wakes when you message it.">Machine</FieldLabel>
        <div className="rounded-xl border border-[var(--border)] p-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${status.state === 'ready' ? 'bg-emerald-500' : status.state === 'failed' || status.state === 'needs_sign_in' ? 'bg-amber-500' : 'bg-[var(--muted-light)]'}`}
            />
            <span className="text-sm font-medium" role="status">{CLOUD_AGENT_STATE_LABEL[status.state]}</span>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-[var(--muted)]">{adapterLabel}</span>
          </div>

          {phase && isCloudAgentStarting(phase) ? <CloudAgentProgress phase={phase} /> : null}

          {status.state === 'unavailable' && !isCloudAgentStarting(phase) ? (
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              This agent&rsquo;s machine is gone, usually because your credit ran low. Messages will not be answered until you start a new one (it needs at least $1 of credit).
            </p>
          ) : null}

          {status.state === 'failed' ? (
            <p role="alert" className="mt-2 text-xs text-red-500">{status.provision?.error ?? 'Could not start the machine.'}</p>
          ) : null}

          <dl className="mt-2.5 space-y-1 text-xs text-[var(--muted)]">
            {status.machine?.size ? <div className="flex justify-between gap-3"><dt>Size</dt><dd className="text-[var(--foreground)]">{SIZE_LABEL[status.machine.size] ?? status.machine.size}</dd></div> : null}
            {status.account ? <div className="flex justify-between gap-3"><dt>Account</dt><dd className="truncate text-[var(--foreground)]">{status.account.label}</dd></div> : null}
          </dl>

          {status.state === 'needs_sign_in' ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-subtle)] px-3 py-2">
              <p className="text-xs text-[var(--foreground)]">{adapterLabel} could not sign in. Reconnect the account to continue.</p>
              <Button variant="primary" size="sm" onClick={() => void openReconnect()}>Reconnect</Button>
            </div>
          ) : null}

          <MachineActions state={status.state} busy={busy} onRun={(action) => void run(action)} onRetry={() => void retry()} />
          {actionError ? <p role="alert" className="mt-2 text-xs text-red-500">{actionError}</p> : null}
        </div>
      </div>

      {status.machine?.adapterId === 'claude-code' || status.machine?.adapterId === 'codex' ? (
        <CloudAgentConfig agentId={agentId} harness={status.machine.adapterId} />
      ) : null}

      {reconnect ? (
        <AccountDialog
          target={reconnect}
          onClose={() => setReconnect(null)}
          onSaved={() => { setReconnect(null); void refresh() }}
        />
      ) : null}
    </div>
  )
}
