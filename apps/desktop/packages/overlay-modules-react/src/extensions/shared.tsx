'use client'

import { type ReactNode } from 'react'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted-light)]">{label}</label>
      {children}
    </div>
  )
}
