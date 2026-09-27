'use client'

import { Fragment, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { ToggleLeft, ToggleRight } from 'lucide-react'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const control =
    isValidElement(children) && children.type !== Fragment
      ? cloneElement(children as ReactElement<{ id?: string }>, { id })
      : children
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted-light)]">{label}</label>
      {control}
    </div>
  )
}

export function EnabledToggle({ enabled, onChange }: { enabled: boolean; onChange(): void }) {
  return (
    <button type="button" onClick={onChange} className="flex items-center gap-1.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]">
      {enabled
        ? <ToggleRight size={18} className="text-[var(--foreground)]" />
        : <ToggleLeft size={18} className="text-[var(--muted-light)]" />}
      <span>{enabled ? 'Active' : 'Disabled'}</span>
    </button>
  )
}
