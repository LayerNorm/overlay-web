'use client'
import type { WorkPerson } from '@overlay/app-core/work'
export type { WorkPerson } from '@overlay/app-core/work'
export function OwnerPicker({ value, people, disabled, label = 'Owner', onChange }: { value?: string; people: readonly WorkPerson[]; disabled?: boolean; label?: string; onChange: (value: string | null) => void }) {
  return <select aria-label={label} value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value || null)} className="h-8 max-w-32 rounded-md border border-transparent bg-transparent px-2 text-xs text-(--muted) hover:border-(--border) focus:border-(--border) disabled:opacity-50">
    <option value="">Unassigned</option>{value && !people.some((person) => person.principalId === value) ? <option value={value}>Unavailable member</option> : null}
    {people.map((person) => <option key={person.principalId} value={person.principalId}>{person.name}</option>)}
  </select>
}
