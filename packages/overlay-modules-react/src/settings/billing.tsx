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
          <h2 className={`text-lg font-medium ${headingClass}`}>Top-ups and billing controls</h2>
          <p className={`mt-1 text-sm ${mutedClass}`}>
            Use one top-up amount everywhere. Add it once now, or save it for future automatic recharges.
          </p>
        </div>
      </div>
      {children}
    </div>
  )
}

export type { BillingSettings }
