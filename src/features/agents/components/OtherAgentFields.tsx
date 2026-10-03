'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ComputerSize } from '@overlay/workspace-contracts'
import type { ProviderAccountResource } from '@overlay/api-client'
import { ListboxSelect, SegmentedControl } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { SELECTABLE_AGENT_PROVIDER_IDS, AGENT_PROVIDERS } from '@/shared/agents/provider-accounts'
import { AccountDialog } from '@/components/agents/AgentAccountDialog'
import { OTHER_AGENT_LABEL, type OtherAgentDraft } from './cloud-agent-draft'
import { FieldLabel } from './InfoTip'

const CONNECT_VALUE = '__connect__'

const SIZE_OPTIONS = [
  { value: 'small', label: 'Small · 2 vCPU, 4 GB' },
  { value: 'default', label: 'Default · 4 vCPU, 8 GB' },
  { value: 'large', label: 'Large · 8 vCPU, 16 GB' },
] as const

const RUNS_ON_OPTIONS = [
  { value: 'cloud', label: 'Overlay Cloud' },
  { value: 'machine', label: 'Your machine' },
] as const

/** The person's Claude/OpenAI accounts, loaded while the dialog is open. */
function useProviderAccounts(enabled: boolean) {
  const [accounts, setAccounts] = useState<ProviderAccountResource[] | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void overlayAppClient.providerAccounts.list({ cache: 'no-store' })
      .then((result) => result.data, () => [] as ProviderAccountResource[])
      .then((data) => { if (!cancelled) setAccounts(data) })
    return () => { cancelled = true }
  }, [enabled, version])
  const refresh = useCallback(() => setVersion((current) => current + 1), [])
  return { accounts, refresh }
}

/** Other agent: which agent, where it runs, which account, how big. */
export function OtherAgentFields({ other, size, onChange, onSizeChange, onOpenMachineSetup, active }: {
  other: OtherAgentDraft
  size: ComputerSize
  onChange(patch: Partial<OtherAgentDraft>): void
  onSizeChange(size: ComputerSize): void
  /** "Your machine" is set up in the full agent editor (it needs a command and approval). */
  onOpenMachineSetup(): void
  active: boolean
}) {
  const { accounts, refresh } = useProviderAccounts(active)
  const [connecting, setConnecting] = useState(false)
  const matching = (accounts ?? []).filter((account) => account.provider === other.adapterId)
  // One account for this agent: use it without asking.
  const chosen = other.providerAccountId || (matching.length === 1 ? matching[0]!.id : '')
  useEffect(() => {
    if (chosen && chosen !== other.providerAccountId) onChange({ providerAccountId: chosen })
  }, [chosen, onChange, other.providerAccountId])

  return (
    <>
      <div>
        <FieldLabel info="The agent that does the work. Claude Code and Codex are fully supported; OpenCode and Cursor are experimental and run with your own key.">Agent</FieldLabel>
        <SegmentedControl
          ariaLabel="Agent"
          layout="stretch"
          value={other.adapterId}
          options={SELECTABLE_AGENT_PROVIDER_IDS.map((id) => ({ value: id, label: OTHER_AGENT_LABEL[id] }))}
          onChange={(adapterId) => onChange({ adapterId, providerAccountId: '' })}
        />
        {AGENT_PROVIDERS[other.adapterId].experimental ? (
          <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">
            Experimental: {AGENT_PROVIDERS[other.adapterId].label} runs with your own key and has not been proven with as many accounts as Claude Code and Codex.
          </p>
        ) : null}
      </div>
      <div>
        <FieldLabel info="Overlay Cloud runs it on a machine Overlay manages (paid plans). Your machine runs it on a computer you connect.">Runs on</FieldLabel>
        <SegmentedControl ariaLabel="Runs on" layout="stretch" value={other.runsOn} options={RUNS_ON_OPTIONS} onChange={(runsOn) => onChange({ runsOn })} />
      </div>
      {other.runsOn === 'cloud' ? (
        <>
          <div>
            <FieldLabel info={`The ${AGENT_PROVIDERS[other.adapterId].label} sign-in this agent uses. Stored encrypted; sent to the agent only while it works.`}>Account</FieldLabel>
            <ListboxSelect
              aria-label="Account"
              value={chosen || ''}
              options={[
                ...(chosen ? [] : [{ value: '', label: 'Choose an account' }]),
                ...matching.map((account) => ({ value: account.id, label: `${account.label}${account.status === 'needs_reauth' ? ' · needs reconnecting' : ''}` })),
                { value: CONNECT_VALUE, label: 'Connect an account…' },
              ]}
              onChange={(value) => (value === CONNECT_VALUE ? setConnecting(true) : onChange({ providerAccountId: value }))}
              portal
            />
          </div>
          <div>
            <FieldLabel info="The machine the agent runs on. Billed while it runs; it pauses when idle.">Machine</FieldLabel>
            <ListboxSelect
              aria-label="Machine size"
              value={size}
              options={[...SIZE_OPTIONS]}
              onChange={(value) => onSizeChange(value as ComputerSize)}
              portal
            />
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
          Connecting your own computer takes a short command and an approval.{' '}
          <button type="button" onClick={onOpenMachineSetup} className="font-medium text-[var(--foreground)] underline underline-offset-2">
            Set it up
          </button>
        </div>
      )}
      {connecting ? (
        <AccountDialog
          target={null}
          initialProvider={other.adapterId}
          onClose={() => setConnecting(false)}
          onSaved={(account) => {
            setConnecting(false)
            refresh()
            if (account) onChange({ providerAccountId: account.id })
          }}
        />
      ) : null}
    </>
  )
}
