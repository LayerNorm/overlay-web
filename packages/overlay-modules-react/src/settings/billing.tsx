'use client'

import type { ReactNode } from 'react'
import type { BillingSettings } from '@overlay/app-core'

export function BillingControlsPanel({
  panelClass,
  headingClass,
  mutedClass,
  children,
}: {
  panelClass: string
  headingClass: string
  mutedClass: string
  children: ReactNode
}) {
  return (
    <div className={panelClass}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className={`text-lg font-medium ${headingClass}`}>Extra usage</h2>
          <p className={`mt-1 text-sm ${mutedClass}`}>
            Add one-time balance or opt in to automatic top-ups. Subscription allowance and top-up balance stay separate.
          </p>
        </div>
      </div>
      {children}
    </div>
  )
}

export type { BillingSettings }
