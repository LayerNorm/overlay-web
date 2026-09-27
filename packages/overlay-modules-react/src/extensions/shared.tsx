'use client'

import { Fragment, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

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
