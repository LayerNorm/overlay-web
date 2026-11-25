'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, toast } from '@overlay/ui/primitives'
import { useLiveMemberSpend, type MemberSpendRow } from '@/hooks/use-billing'
import type { WorkspaceManagementClient } from '@/shared/workspaces/types'
import { DollarAmountInput } from './DollarAmountInput'

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const MAX_CAP_CENTS = 100_000_00

/**
 * What each member has spent this billing period, their automations and agents included, with an optional cap per
 * person. A cap stops that person's paid work once reached and renews every period. Owners and admins only.
 */
export function WorkspaceMemberSpendCard({ client, workspaceId }: { client: WorkspaceManagementClient; workspaceId: string }) {
  const spend = useLiveMemberSpend(workspaceId, true)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (spend === null) return null

  async function save(userId: string, capCents: number | null) {
    setBusy(true)
    try {
      await client.setMemberSpendCap(workspaceId, { userId, capCents })
      setEditing(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the spending cap.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-(--border) p-4">
      <p className="text-sm font-medium text-(--foreground)">Spend per person</p>
      <p className="mt-1 text-xs leading-5 text-(--muted)">
        This billing period, including each person’s automations and agents. A cap stops their paid work when it is
        reached and renews every period.
      </p>
      {spend === undefined ? (
        <div className="mt-4 flex items-center text-xs text-(--muted)"><Loader2 size={14} className="mr-2 animate-spin" />Loading…</div>
      ) : (
        <ul className="mt-3 divide-y divide-(--border)">
          {spend.people.map((person) => (
            <MemberRow
              key={person.userId}
              person={person}
              canCap={spend.hasBillingAccount}
              editing={editing === person.userId}
              busy={busy}
              onEdit={() => setEditing(person.userId)}
              onCancel={() => setEditing(null)}
              onSave={(capCents) => void save(person.userId, capCents)}
            />
          ))}
        </ul>
      )}
      {spend?.truncated ? (
        <p className="mt-2 text-[11px] leading-4 text-(--muted-light)">This period has more charges than can be added up here, so totals may be low.</p>
      ) : null}
    </div>
  )
}

function MemberRow({
  person,
  canCap,
  editing,
  busy,
  onEdit,
  onCancel,
  onSave,
}: {
  person: MemberSpendRow
  canCap: boolean
  editing: boolean
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (capCents: number | null) => void
}) {
  const [capCents, setCapCents] = useState(person.capCents ?? 2_000)
  const reached = person.capCents !== null && person.capUsedCents >= person.capCents
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm text-(--foreground)">{person.name}</p>
        <p className="text-xs text-(--muted)">
          {dollars(person.spentCents)} spent
          {person.capCents !== null ? ` · cap ${dollars(person.capCents)}` : ''}
          {reached ? ' · cap reached' : ''}
        </p>
      </div>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <DollarAmountInput valueCents={capCents} minCents={0} maxCents={MAX_CAP_CENTS} suffix="a month" label={`Monthly cap for ${person.name}`} onChange={setCapCents} />
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
          {person.capCents !== null ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSave(null)}>Remove cap</Button> : null}
          <Button size="sm" disabled={busy} onClick={() => onSave(capCents)}>Save</Button>
        </div>
      ) : canCap ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit}>{person.capCents === null ? 'Set cap' : 'Change cap'}</Button>
      ) : null}
    </li>
  )
}
